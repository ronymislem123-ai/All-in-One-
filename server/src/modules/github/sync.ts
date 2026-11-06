import { posix } from 'node:path';
import type { Ctx } from '../../context';
import { badRequest } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { logActivity } from '../activity';
import { createConflict } from '../conflicts';
import { notify } from '../notifications';
import { reindex, reindexRepoFiles } from '../search';
import { githubSettings, githubToken } from '../settings';
import { finishRun, startRun } from '../sync-log';
import { analyzeTarball } from './analyzer';
import { GitHubClient, GitHubError } from './client';
import { ensureRepository, generateLinkSuggestions, requireRepo, type RepoRow } from './repos';

interface GhRepo {
  id: number; name: string; full_name: string; owner: { login: string }; description: string | null; html_url: string;
  default_branch: string; private: boolean; fork: boolean; archived: boolean; language: string | null; topics?: string[];
  size: number; stargazers_count: number; open_issues_count: number; pushed_at: string | null; created_at: string; updated_at: string;
}
interface GhBranch { name: string; commit: { sha: string }; protected: boolean }
interface GhCommit { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; author: { login: string } | null }
interface GhTree { sha: string; truncated: boolean; tree: { path: string; type: 'blob' | 'tree' | 'commit'; size?: number; sha: string }[] }

const MAX_TARBALL = 80 * 1024 * 1024;
const running = new Set<string>();

function client(ctx: Ctx) {
  return new GitHubClient(ctx, githubToken(ctx).token);
}

function linkedProjectIds(ctx: Ctx, repoId: string): string[] {
  return ctx.db.all<{ node_id: string }>(`SELECT node_id FROM project_repository_links WHERE repository_id = ? AND status = 'confirmed'`, [repoId]).map((r) => r.node_id);
}

/** Marks a repository unreachable WITHOUT deleting any data or links (§9.6, §10.2). */
function markUnreachable(ctx: Ctx, repo: RepoRow, status: 'not_found' | 'unreachable' | 'error', detail: string) {
  const changed = repo.status !== status;
  ctx.db.run('UPDATE repositories SET status = ?, status_detail = ?, last_checked_at = ?, updated_at = ? WHERE id = ?', [status, detail, nowIso(), nowIso(), repo.id]);
  if (!changed) return;
  const projects = linkedProjectIds(ctx, repo.id);
  if (projects.length && status !== 'error') {
    createConflict(ctx, {
      type: 'repo_unreachable', severity: status === 'not_found' ? 'critical' : 'warning', source: 'github', subjectType: 'repository', subjectId: repo.id,
      title: `${repo.full_name} ist ${status === 'not_found' ? 'nicht mehr auffindbar (gelöscht, umbenannt oder Zugriff entzogen)' : 'nicht erreichbar'}`,
      description: 'Alle bisher gespiegelten Daten und das verknüpfte Projekt bleiben erhalten. Entscheide, ob die Verknüpfung bestehen bleiben soll.',
      details: { status, detail },
    });
  }
  notify(ctx, { level: status === 'error' ? 'warning' : 'error', title: `GitHub: ${repo.full_name} ${status === 'not_found' ? 'nicht gefunden' : 'nicht erreichbar'}`, body: detail, link: `/code/${repo.id}`, dedupeKey: `repo-status:${repo.id}` });
  logActivity(ctx, { actor: 'github' }, { action: 'repo.unreachable', summary: `${repo.full_name}: ${detail} – vorhandene Daten bleiben erhalten`, entityType: 'repository', entityId: repo.id, entityName: repo.full_name });
}

export interface RepoSyncResult { repoId: string; fullName: string; status: string; headChanged: boolean; newCommits: number; analyzed: boolean; message: string }

/** Fetches metadata, languages, branches, recent commits and (if the head moved) the file tree of one repository. */
export async function syncRepository(ctx: Ctx, repoId: string, opts: { analyze?: boolean; force?: boolean } = {}): Promise<RepoSyncResult> {
  const repo = requireRepo(ctx, repoId);
  if (running.has(repoId)) return { repoId, fullName: repo.full_name, status: repo.status, headChanged: false, newCommits: 0, analyzed: false, message: 'Abgleich läuft bereits' };
  running.add(repoId);
  const gh = client(ctx);
  try {
    let meta: GhRepo;
    try {
      try {
        meta = (await gh.get<GhRepo>(`/repos/${repo.full_name}`, { cache: true })).data;
      } catch (e) {
        // renamed/transferred without redirect: fall back to the stable numeric id
        if ((e as GitHubError).status === 404 && repo.github_id) meta = (await gh.get<GhRepo>(`/repositories/${repo.github_id}`)).data;
        else throw e;
      }
    } catch (e) {
      const err = e as GitHubError;
      if (err.status === 404) markUnreachable(ctx, repo, 'not_found', 'GitHub meldet 404 – Repository gelöscht, umbenannt oder kein Zugriff');
      else if (err.status === 401 || err.status === 403) markUnreachable(ctx, repo, 'unreachable', `Zugriff verweigert (${err.status}) – Token/Berechtigungen prüfen`);
      else markUnreachable(ctx, repo, err.status === 0 ? 'unreachable' : 'error', err.message);
      return { repoId, fullName: repo.full_name, status: requireRepo(ctx, repoId).status, headChanged: false, newCommits: 0, analyzed: false, message: err.message };
    }
    const now = nowIso();
    // identity is the numeric GitHub id; names may change (rename/transfer)
    const renamed = repo.github_id === meta.id && repo.full_name !== meta.full_name;
    const clash = ctx.db.get<{ id: string }>('SELECT id FROM repositories WHERE github_id = ? AND id <> ?', [meta.id, repoId]);
    if (clash) throw badRequest(`GitHub-ID ${meta.id} ist bereits einem anderen Eintrag zugeordnet (${clash.id}).`);
    const branch = repo.tracked_branch || meta.default_branch;
    const [languages, branches, commits] = await Promise.all([
      gh.get<Record<string, number>>(`/repos/${meta.full_name}/languages`, { cache: true }).then((r) => r.data).catch(() => ({})),
      gh.paginate<GhBranch>(`/repos/${meta.full_name}/branches`, 3).catch(() => [] as GhBranch[]),
      gh.get<GhCommit[]>(`/repos/${meta.full_name}/commits?sha=${encodeURIComponent(branch)}&per_page=30`, { cache: true }).then((r) => r.data).catch(() => [] as GhCommit[]),
    ]);
    if (repo.tracked_branch && branches.length && !branches.some((b) => b.name === repo.tracked_branch)) {
      throw badRequest(`Branch „${repo.tracked_branch}“ existiert in ${meta.full_name} nicht (mehr).`);
    }
    const head = branches.find((b) => b.name === branch)?.commit.sha ?? commits[0]?.sha ?? null;
    const headChanged = Boolean(head && head !== repo.head_sha);
    let tree: GhTree | null = null;
    if (head && (headChanged || opts.force || !repo.file_count)) {
      if (headChanged && repo.head_sha) ctx.db.run('DELETE FROM repo_commits WHERE repo_id = ?', [repoId]);
      tree = (await gh.get<GhTree>(`/repos/${meta.full_name}/git/trees/${head}?recursive=1`)).data;
    }
    const knownShas = new Set(ctx.db.all<{ sha: string }>('SELECT sha FROM repo_commits WHERE repo_id = ?', [repoId]).map((r) => r.sha));
    const newCommits = repo.head_sha ? commits.filter((c) => !knownShas.has(c.sha)).length : 0;

    ctx.db.tx(() => {
      ctx.db.run(
        `UPDATE repositories SET github_id = ?, owner = ?, name = ?, full_name = ?, description = ?, html_url = ?, default_branch = ?, private = ?, fork = ?,
          archived = ?, primary_language = ?, languages = ?, topics = ?, size_kb = ?, stars = ?, open_issues = ?, pushed_at = ?, gh_created_at = ?,
          gh_updated_at = ?, head_sha = COALESCE(?, head_sha), status = 'ok', status_detail = NULL, last_synced_at = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`,
        [
          meta.id, meta.owner.login, meta.name, meta.full_name, meta.description, meta.html_url, meta.default_branch, meta.private ? 1 : 0,
          meta.fork ? 1 : 0, meta.archived ? 1 : 0, meta.language, JSON.stringify(languages), JSON.stringify(meta.topics ?? []), meta.size,
          meta.stargazers_count, meta.open_issues_count, meta.pushed_at, meta.created_at, meta.updated_at, head, now, now, now, repoId,
        ],
      );
      ctx.db.run('DELETE FROM repo_branches WHERE repo_id = ?', [repoId]);
      for (const b of branches) ctx.db.run('INSERT INTO repo_branches(repo_id, name, sha, protected) VALUES (?, ?, ?, ?)', [repoId, b.name, b.commit.sha, b.protected ? 1 : 0]);
      for (const c of commits) {
        ctx.db.run(
          `INSERT INTO repo_commits(repo_id, sha, message, author_name, author_login, committed_at, html_url) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(repo_id, sha) DO NOTHING`,
          [repoId, c.sha, c.commit.message.slice(0, 2000), c.commit.author?.name ?? null, c.author?.login ?? null, c.commit.author?.date ?? null, c.html_url],
        );
      }
      // keep the commit cache bounded
      ctx.db.run(`DELETE FROM repo_commits WHERE repo_id = ? AND sha NOT IN (SELECT sha FROM repo_commits WHERE repo_id = ? ORDER BY committed_at DESC LIMIT 200)`, [repoId, repoId]);
      if (tree) {
        ctx.db.run('DELETE FROM repo_tree WHERE repo_id = ?', [repoId]);
        let files = 0;
        for (const t of tree.tree) {
          if (t.type === 'blob') files++;
          ctx.db.run('INSERT INTO repo_tree(repo_id, path, parent_path, name, type, size, sha, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
            repoId, t.path, posix.dirname(t.path) === '.' ? '' : posix.dirname(t.path), posix.basename(t.path), t.type, t.size ?? null, t.sha, t.path.split('/').length,
          ]);
        }
        ctx.db.run('UPDATE repositories SET tree_truncated = ?, file_count = ? WHERE id = ?', [tree.truncated ? 1 : 0, files, repoId]);
      }
      if (renamed) {
        logActivity(ctx, { actor: 'github' }, { action: 'repo.renamed', summary: `Repository umbenannt: ${repo.full_name} → ${meta.full_name} (Zuordnung über stabile ID erhalten)`, entityType: 'repository', entityId: repoId, entityName: meta.full_name });
      }
      if (newCommits > 0) {
        const projects = linkedProjectIds(ctx, repoId);
        logActivity(ctx, { actor: 'github' }, {
          action: 'repo.commits', summary: `${newCommits} neue Commits in ${meta.full_name}: ${commits[0]?.commit.message.split('\n')[0].slice(0, 100) ?? ''}`,
          entityType: 'repository', entityId: repoId, entityName: meta.full_name, projectId: projects[0] ?? null,
        });
        for (const p of projects) ctx.db.run('UPDATE nodes SET last_activity_at = ? WHERE id = ?', [now, p]);
      }
      if (repo.status !== 'ok') {
        ctx.db.run(`UPDATE notifications SET read_at = ? WHERE dedupe_key = ? AND read_at IS NULL`, [now, `repo-status:${repoId}`]);
      }
    });
    reindex(ctx, 'repository', repoId);
    if (tree) reindexRepoFiles(ctx, repoId);
    let analyzed = false;
    const shouldAnalyze = opts.analyze ?? githubSettings(ctx).analyzeOnSync;
    const lastAnalysis = ctx.db.get<{ commit_sha: string }>(`SELECT commit_sha FROM code_analyses WHERE repo_id = ? AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1`, [repoId]);
    if (head && shouldAnalyze && (opts.force || lastAnalysis?.commit_sha !== head)) {
      await analyzeRepository(ctx, repoId).then(() => { analyzed = true; }).catch(() => { /* recorded in code_analyses */ });
    }
    return {
      repoId, fullName: meta.full_name, status: 'ok', headChanged, newCommits, analyzed,
      message: `${meta.full_name} synchronisiert${headChanged ? ' (neuer Stand)' : ''}${newCommits ? `, ${newCommits} neue Commits` : ''}${analyzed ? ', Code analysiert' : ''}`,
    };
  } finally {
    running.delete(repoId);
  }
}

/** Downloads the archive of the current head and stores imports/exports/roles per file (no file contents). */
export async function analyzeRepository(ctx: Ctx, repoId: string) {
  const repo = requireRepo(ctx, repoId);
  if (!repo.head_sha) throw badRequest('Repository wurde noch nicht synchronisiert.');
  const id = newId('ana');
  ctx.db.run(`INSERT INTO code_analyses(id, repo_id, commit_sha, status, started_at) VALUES (?, ?, ?, 'running', ?)`, [id, repoId, repo.head_sha, nowIso()]);
  try {
    const tgz = await client(ctx).getTarball(repo.full_name, repo.head_sha, MAX_TARBALL);
    const result = await analyzeTarball(tgz);
    ctx.db.tx(() => {
      ctx.db.run('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
      ctx.db.run('DELETE FROM repo_dependencies WHERE repo_id = ?', [repoId]);
      for (const f of result.files) {
        ctx.db.run(
          `INSERT INTO code_files(repo_id, path, commit_sha, language, lines, size, imports, external_imports, exports, role, excluded_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [repoId, f.path, repo.head_sha, f.language, f.lines, f.size, JSON.stringify(f.imports), JSON.stringify(f.externalImports), JSON.stringify(f.exports), f.role, f.excludedReason],
        );
      }
      for (const d of result.dependencies) {
        ctx.db.run('INSERT OR IGNORE INTO repo_dependencies(repo_id, manifest_path, ecosystem, name, version_spec, dev) VALUES (?, ?, ?, ?, ?, ?)', [
          repoId, d.manifest, d.ecosystem, d.name, d.version, d.dev ? 1 : 0,
        ]);
      }
      ctx.db.run(`UPDATE code_analyses SET status = 'succeeded', finished_at = ?, stats = ? WHERE id = ?`, [nowIso(), JSON.stringify(result.stats), id]);
    });
    logActivity(ctx, { actor: 'github' }, {
      action: 'repo.analyzed', summary: `Codeanalyse ${repo.full_name}: ${result.stats.analyzed} Dateien, ${result.stats.edges} erkannte Abhängigkeiten, ${result.stats.secretExcluded} geschützte Dateien ausgeschlossen`,
      entityType: 'repository', entityId: repoId, entityName: repo.full_name,
    });
    return { analysisId: id, stats: result.stats };
  } catch (e) {
    ctx.db.run(`UPDATE code_analyses SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`, [nowIso(), (e as Error).message, id]);
    throw e;
  }
}

/** Lists repositories the token can see and registers them for read-only tracking. */
export async function discoverRepositories(ctx: Ctx): Promise<{ found: number; added: number }> {
  const { token } = githubToken(ctx);
  if (!token) throw badRequest('Für die automatische Erkennung wird ein GitHub-Token benötigt. Ohne Token können Repositories einzeln per "owner/name" hinzugefügt werden.');
  const repos = await client(ctx).paginate<GhRepo>('/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed', 10);
  let added = 0;
  ctx.db.tx(() => {
    for (const r of repos) {
      const existing = ctx.db.get<{ id: string }>('SELECT id FROM repositories WHERE github_id = ? OR full_name = ?', [r.id, r.full_name]);
      if (existing) continue;
      const row = ensureRepository(ctx, r.full_name, 'discovery');
      ctx.db.run('UPDATE repositories SET github_id = ?, description = ?, html_url = ?, private = ?, primary_language = ?, pushed_at = ? WHERE id = ?', [
        r.id, r.description, r.html_url, r.private ? 1 : 0, r.language, r.pushed_at, row.id,
      ]);
      added++;
    }
  });
  return { found: repos.length, added };
}

/** Full GitHub cycle: optional discovery → sync each tracked repository → link suggestions. */
export async function syncAll(ctx: Ctx, trigger: 'poll' | 'manual' | 'webhook' | 'startup') {
  const runId = startRun(ctx, 'github', trigger, 'GitHub-Abgleich');
  const stats = { repos: 0, ok: 0, failed: 0, newCommits: 0, analyzed: 0, discovered: 0, suggestions: 0 };
  let error: string | undefined;
  try {
    if (githubToken(ctx).token && githubSettings(ctx).autoDiscover) {
      try { stats.discovered = (await discoverRepositories(ctx)).added; } catch (e) { error = `Erkennung: ${(e as Error).message}`; }
    }
    const repos = ctx.db.all<{ id: string }>('SELECT id FROM repositories WHERE tracked = 1 ORDER BY last_synced_at IS NOT NULL, last_synced_at');
    for (const r of repos) {
      stats.repos++;
      try {
        const res = await syncRepository(ctx, r.id);
        if (res.status === 'ok') stats.ok++; else stats.failed++;
        stats.newCommits += res.newCommits;
        if (res.analyzed) stats.analyzed++;
      } catch (e) {
        stats.failed++;
        error = (e as Error).message;
        if (e instanceof GitHubError && e.status === 429) break; // rate limit: stop, next poll continues
      }
    }
    stats.suggestions = generateLinkSuggestions(ctx).suggested;
    finishRun(ctx, runId, stats.failed ? (stats.ok ? 'partial' : 'failed') : 'succeeded', stats, error);
    ctx.db.setMeta('last_github_sync_at', nowIso());
  } catch (e) {
    finishRun(ctx, runId, 'failed', stats, (e as Error).message);
    throw e;
  }
  return { runId, ...stats, error };
}

export function rateLimit() {
  return GitHubClient.rate;
}
