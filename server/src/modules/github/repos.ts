import type { Ctx, WriteMeta } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { parseJson } from '../../lib/json';
import { nowIso } from '../../lib/time';
import { nameSimilarity } from '../../lib/similarity';
import { logActivity } from '../activity';
import { confirmLinkInternal, createConflict } from '../conflicts';
import { requireNode } from '../nodes';

export interface RepoRow {
  id: string; github_id: number | null; owner: string; name: string; full_name: string; description: string | null;
  html_url: string | null; default_branch: string | null; private: number; fork: number; archived: number;
  primary_language: string | null; languages: string; topics: string; size_kb: number | null; stars: number | null;
  open_issues: number | null; pushed_at: string | null; gh_created_at: string | null; gh_updated_at: string | null;
  head_sha: string | null; tracked_branch: string | null; tree_truncated: number; file_count: number | null; tracked: number; status: string;
  status_detail: string | null; last_synced_at: string | null; last_checked_at: string | null; added_via: string;
  created_at: string; updated_at: string;
}

export const FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function serializeRepo(r: RepoRow) {
  return {
    id: r.id, githubId: r.github_id, owner: r.owner, name: r.name, fullName: r.full_name, description: r.description,
    htmlUrl: r.html_url, defaultBranch: r.default_branch, trackedBranch: r.tracked_branch, branch: r.tracked_branch ?? r.default_branch, private: Boolean(r.private), fork: Boolean(r.fork), archived: Boolean(r.archived),
    primaryLanguage: r.primary_language, languages: parseJson<Record<string, number>>(r.languages, {}), topics: parseJson<string[]>(r.topics, []),
    sizeKb: r.size_kb, stars: r.stars, openIssues: r.open_issues, pushedAt: r.pushed_at, headSha: r.head_sha,
    treeTruncated: Boolean(r.tree_truncated), fileCount: r.file_count, tracked: Boolean(r.tracked), status: r.status,
    statusDetail: r.status_detail, lastSyncedAt: r.last_synced_at, lastCheckedAt: r.last_checked_at, addedVia: r.added_via,
  };
}

export function requireRepo(ctx: Ctx, id: string): RepoRow {
  const r = ctx.db.get<RepoRow>('SELECT * FROM repositories WHERE id = ?', [id]);
  if (!r) throw notFound('Repository');
  return r;
}

/** Registers a repository for read-only tracking (data is fetched by the next sync). */
export function ensureRepository(ctx: Ctx, fullName: string, addedVia: string): RepoRow {
  if (!FULL_NAME_RE.test(fullName)) throw badRequest('Repository bitte im Format "owner/name" angeben.');
  const existing = ctx.db.get<RepoRow>('SELECT * FROM repositories WHERE full_name = ?', [fullName]);
  if (existing) return existing;
  const [owner, name] = fullName.split('/');
  const id = newId('repo');
  const now = nowIso();
  ctx.db.run(
    `INSERT INTO repositories(id, owner, name, full_name, status, tracked, added_via, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?)`,
    [id, owner, name, fullName, addedVia, now, now],
  );
  ctx.hooks.onChange?.('repository', id);
  return requireRepo(ctx, id);
}

/** A suggestion never becomes a link by itself – the owner must confirm (§10.4). */
export function suggestLink(ctx: Ctx, nodeId: string, repositoryId: string, createdBy: string, score: number | null, reason: string): void {
  const existing = ctx.db.get<{ status: string }>('SELECT status FROM project_repository_links WHERE node_id = ? AND repository_id = ?', [nodeId, repositoryId]);
  if (existing) return; // confirmed stays confirmed, rejected stays rejected
  ctx.db.run(
    `INSERT INTO project_repository_links(id, node_id, repository_id, status, score, reason, created_by, created_at) VALUES (?, ?, ?, 'suggested', ?, ?, ?, ?)`,
    [newId('lnk'), nodeId, repositoryId, score, reason, createdBy, nowIso()],
  );
}

export function confirmLink(ctx: Ctx, meta: WriteMeta, nodeId: string, repositoryId: string) {
  ctx.db.write(() => confirmLinkInternal(ctx, meta, nodeId, repositoryId, 'Manuell bestätigt'));
  ctx.hooks.onChange?.('node', nodeId);
}

export function rejectLink(ctx: Ctx, meta: WriteMeta, nodeId: string, repositoryId: string) {
  const node = requireNode(ctx, nodeId);
  const repo = requireRepo(ctx, repositoryId);
  ctx.db.write(() => {
    ctx.db.run(`UPDATE project_repository_links SET status = 'rejected', decided_at = ? WHERE node_id = ? AND repository_id = ?`, [nowIso(), nodeId, repositoryId]);
    logActivity(ctx, meta, { action: 'repo.link_rejected', summary: `Vorschlag ${repo.full_name} ↔ „${node.name}“ abgelehnt`, entityType: 'node', entityId: nodeId, entityName: node.name });
  });
}

/** Removes only the link. Neither the project nor the repository data is deleted (§9.6). */
export function unlink(ctx: Ctx, meta: WriteMeta, nodeId: string, repositoryId: string) {
  const node = requireNode(ctx, nodeId);
  const repo = requireRepo(ctx, repositoryId);
  ctx.db.write(() => {
    ctx.db.run('DELETE FROM project_repository_links WHERE node_id = ? AND repository_id = ?', [nodeId, repositoryId]);
    logActivity(ctx, meta, { action: 'repo.unlinked', summary: `Verknüpfung ${repo.full_name} ↔ „${node.name}“ gelöst (Daten bleiben erhalten)`, entityType: 'node', entityId: nodeId, entityName: node.name });
  });
  ctx.hooks.onChange?.('node', nodeId);
}

/**
 * Name-based suggestions for unlinked repositories. Similarity only produces suggestions; a repository
 * matching several projects becomes a "repo_ambiguous" conflict for the owner to decide (§10.4, §11).
 */
export function generateLinkSuggestions(ctx: Ctx): { suggested: number; ambiguous: number } {
  const repos = ctx.db.all<RepoRow>(
    `SELECT * FROM repositories r WHERE r.tracked = 1 AND NOT EXISTS (SELECT 1 FROM project_repository_links l WHERE l.repository_id = r.id AND l.status = 'confirmed')`,
  );
  const projects = ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE kind IN ('project','subproject') AND deleted_at IS NULL`);
  let suggested = 0;
  let ambiguous = 0;
  for (const r of repos) {
    const matches = projects
      .map((p) => ({ ...p, score: Math.max(nameSimilarity(p.name, r.name), nameSimilarity(p.name, r.name.replace(/[-_]/g, ' '))) }))
      .filter((m) => m.score >= 0.72)
      .sort((a, b) => b.score - a.score);
    for (const m of matches.slice(0, 3)) {
      const before = ctx.db.get('SELECT 1 FROM project_repository_links WHERE node_id = ? AND repository_id = ?', [m.id, r.id]);
      suggestLink(ctx, m.id, r.id, 'suggestion', Number(m.score.toFixed(2)), `Namensähnlichkeit „${m.name}“ ↔ ${r.full_name}`);
      if (!before) suggested++;
    }
    if (matches.length >= 2) {
      createConflict(ctx, {
        type: 'repo_ambiguous', severity: 'info', source: 'github', subjectType: 'repository', subjectId: r.id,
        title: `${r.full_name} passt zu mehreren Projekten`,
        description: 'Namensähnlichkeit allein reicht nicht für eine Zuordnung. Bitte wähle das richtige Projekt oder verwirf die Vorschläge.',
        candidates: matches.slice(0, 5).map((m) => ({ id: m.id, name: m.name, score: Number(m.score.toFixed(2)), reason: 'Namensähnlichkeit' })),
      });
      ambiguous++;
    }
  }
  return { suggested, ambiguous };
}

export function listLinkSuggestions(ctx: Ctx) {
  return ctx.db.all(
    `SELECT l.id, l.node_id, n.name node_name, l.repository_id, r.full_name, l.score, l.reason, l.created_by, l.created_at
     FROM project_repository_links l JOIN nodes n ON n.id = l.node_id AND n.deleted_at IS NULL JOIN repositories r ON r.id = l.repository_id
     WHERE l.status = 'suggested' ORDER BY l.score DESC, l.created_at DESC LIMIT 200`,
  );
}
