import { posix } from 'node:path';
import type { Ctx } from '../../context';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { isSecretPath, redactSecrets } from '../../lib/redact';
import { githubToken } from '../settings';
import { GitHubClient } from './client';
import { ROLE_LABELS, classifyRole, languageOf, type Role } from './analyzer';
import { requireRepo, serializeRepo } from './repos';

/** Plain-language metaphors for the "einfach erklärt" mode (§14.3). */
export const SIMPLE_EXPLANATIONS: Record<Role | 'repository' | 'folder', { metaphor: string; text: string }> = {
  repository: { metaphor: 'Die Werkzeugkiste', text: 'Das Repository enthält alles, was zu dieser Anwendung gehört: Code, Einstellungen, Tests und Dokumentation.' },
  folder: { metaphor: 'Eine Schublade', text: 'Ein Ordner sortiert zusammengehörige Dateien.' },
  frontend: { metaphor: 'Das Gesicht', text: 'Das Frontend ist alles, was du siehst und anklickst – Seiten, Knöpfe, Farben.' },
  backend: { metaphor: 'Das Gehirn', text: 'Das Backend arbeitet im Hintergrund: Es rechnet, prüft und entscheidet, was mit Daten passiert.' },
  api: { metaphor: 'Die Telefonleitung', text: 'Die API verbindet Systeme miteinander – hier kommen Anfragen an und Antworten gehen raus.' },
  database: { metaphor: 'Das Gedächtnis', text: 'Hier wird festgelegt, wie Daten dauerhaft gespeichert und wiedergefunden werden.' },
  shared: { metaphor: 'Die gemeinsame Sprache', text: 'Bausteine, die mehrere Teile gemeinsam nutzen – etwa Begriffe, Typen und Regeln –, damit alle dasselbe meinen.' },
  tests: { metaphor: 'Die Qualitätskontrolle', text: 'Tests prüfen automatisch, ob alles so funktioniert wie geplant.' },
  config: { metaphor: 'Die Bedienungsanleitung für Werkzeuge', text: 'Konfigurationsdateien sagen den Werkzeugen, wie sie das Projekt bauen und starten sollen.' },
  docs: { metaphor: 'Das Handbuch', text: 'Dokumentation erklärt Menschen, wie das Projekt funktioniert.' },
  scripts: { metaphor: 'Die Helferlein', text: 'Skripte automatisieren wiederkehrende Handgriffe wie Bauen oder Prüfen.' },
  assets: { metaphor: 'Der Fundus', text: 'Bilder, Schriften und andere Dateien, die die Oberfläche verwendet.' },
  other: { metaphor: 'Sonstiges', text: 'Dateien, die keiner klaren Rolle zugeordnet werden konnten.' },
};

interface TreeRow { path: string; parent_path: string; name: string; type: string; size: number | null; depth: number }
interface CodeFileRow { path: string; language: string | null; lines: number | null; size: number | null; imports: string; external_imports: string; exports: string; role: string | null; excluded_reason: string | null }

function latestAnalysis(ctx: Ctx, repoId: string) {
  const a = ctx.db.get<{ id: string; commit_sha: string; status: string; started_at: string; finished_at: string | null; stats: string; error: string | null }>(
    'SELECT * FROM code_analyses WHERE repo_id = ? ORDER BY started_at DESC LIMIT 1',
    [repoId],
  );
  return a ? { ...a, stats: parseJson<Record<string, unknown>>(a.stats, {}) } : null;
}

export function repoOverview(ctx: Ctx, repoId: string) {
  const repo = requireRepo(ctx, repoId);
  const links = ctx.db.all(
    `SELECT l.node_id, n.name, l.status FROM project_repository_links l JOIN nodes n ON n.id = l.node_id AND n.deleted_at IS NULL WHERE l.repository_id = ? AND l.status <> 'rejected'`,
    [repoId],
  );
  const branches = ctx.db.all('SELECT name, sha, protected FROM repo_branches WHERE repo_id = ? ORDER BY name LIMIT 100', [repoId]);
  const commits = ctx.db.all('SELECT sha, message, author_name, author_login, committed_at, html_url FROM repo_commits WHERE repo_id = ? ORDER BY committed_at DESC LIMIT 30', [repoId]);
  const deps = ctx.db.all('SELECT manifest_path, ecosystem, name, version_spec, dev FROM repo_dependencies WHERE repo_id = ? ORDER BY dev, name LIMIT 500', [repoId]);
  return { repo: serializeRepo(repo), links, branches, commits, dependencies: deps, analysis: latestAnalysis(ctx, repoId) };
}

/** Immediate children of a folder (lazy loading for big repositories). */
export function treeChildren(ctx: Ctx, repoId: string, path: string) {
  requireRepo(ctx, repoId);
  const rows = ctx.db.all<TreeRow & { child_count: number; language: string | null; lines: number | null; role: string | null; excluded_reason: string | null }>(
    `SELECT t.path, t.parent_path, t.name, t.type, t.size, t.depth,
       (SELECT COUNT(*) FROM repo_tree c WHERE c.repo_id = t.repo_id AND c.parent_path = t.path) child_count,
       f.language, f.lines, f.role, f.excluded_reason
     FROM repo_tree t LEFT JOIN code_files f ON f.repo_id = t.repo_id AND f.path = t.path
     WHERE t.repo_id = ? AND t.parent_path = ? ORDER BY t.type DESC, t.name COLLATE NOCASE LIMIT 2000`,
    [repoId, path],
  );
  return rows.map((r) => ({
    path: r.path, name: r.name, type: r.type === 'tree' ? 'folder' : r.type === 'commit' ? 'submodule' : 'file', size: r.size,
    childCount: r.child_count, language: r.language ?? (r.type === 'blob' ? languageOf(r.path) : null), lines: r.lines,
    role: (r.role ?? (r.type === 'blob' ? classifyRole(r.path) : null)) as Role | null, protected: isSecretPath(r.path) || r.excluded_reason === 'secret',
  }));
}

function folderRole(ctx: Ctx, repoId: string, path: string): { role: Role; share: number } {
  const rows = ctx.db.all<{ role: string; c: number }>(
    `SELECT role, COUNT(*) c FROM code_files WHERE repo_id = ? AND (path LIKE ? ESCAPE '\\') AND role IS NOT NULL GROUP BY role ORDER BY c DESC`,
    [repoId, `${path.replace(/[%_\\]/g, (m) => '\\' + m)}/%`],
  );
  const total = rows.reduce((s, r) => s + r.c, 0);
  if (!total) return { role: classifyRole(path + '/'), share: 0 };
  return { role: rows[0].role as Role, share: rows[0].c / total };
}

/**
 * Graph for the explorer: visible nodes = root children + children of expanded folders.
 * Dependency edges come only from analysed imports and are aggregated onto the nearest visible ancestor.
 */
export function repoGraph(ctx: Ctx, repoId: string, expanded: string[], opts: { includeTests?: boolean } = {}) {
  const repo = requireRepo(ctx, repoId);
  const exp = new Set(expanded.filter((p) => p && !p.includes('..')).slice(0, 60));
  const visible = new Map<string, ReturnType<typeof treeChildren>[number] & { parent: string }>();
  const addChildren = (parent: string) => {
    for (const c of treeChildren(ctx, repoId, parent)) {
      if (!opts.includeTests && c.role === 'tests' && c.type === 'file') continue;
      visible.set(c.path, { ...c, parent });
    }
  };
  addChildren('');
  // expand in depth order so parents are present first
  for (const p of [...exp].sort((a, b) => a.split('/').length - b.split('/').length)) if (visible.has(p)) addChildren(p);
  if (visible.size > 600) throw badRequest('Zu viele sichtbare Elemente – bitte weniger Ordner gleichzeitig aufklappen.');

  const nearestVisible = (path: string): string | null => {
    for (let p = path; p && p !== '.'; p = posix.dirname(p)) if (visible.has(p)) return p;
    return null;
  };
  const files = ctx.db.all<{ path: string; imports: string }>(`SELECT path, imports FROM code_files WHERE repo_id = ? AND imports <> '[]'`, [repoId]);
  const edgeMap = new Map<string, number>();
  for (const f of files) {
    const from = nearestVisible(f.path);
    if (!from) continue;
    for (const target of parseJson<string[]>(f.imports, [])) {
      const to = nearestVisible(target);
      if (!to || to === from) continue;
      // skip edges between a folder and its own descendants (containment, not dependency)
      if (to.startsWith(from + '/') || from.startsWith(to + '/')) continue;
      const key = `${from}→${to}`;
      edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
    }
  }
  const nodes = [...visible.values()].map((v) => ({
    ...v,
    role: v.type === 'folder' ? folderRole(ctx, repoId, v.path).role : v.role,
    expanded: exp.has(v.path),
  }));
  return {
    repo: { id: repo.id, fullName: repo.full_name, headSha: repo.head_sha },
    nodes,
    edges: [...edgeMap.entries()].map(([k, count]) => {
      const [from, to] = k.split('→');
      return { from, to, count, basis: 'erkannt' as const };
    }),
    analysis: latestAnalysis(ctx, repoId),
  };
}

/** Finds files/folders by path fragment (for the explorer search; ranks exact name matches first). */
export function findPaths(ctx: Ctx, repoId: string, q: string) {
  requireRepo(ctx, repoId);
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return ctx.db.all<{ path: string; type: string }>(
    `SELECT path, type FROM repo_tree WHERE repo_id = ? AND lower(path) LIKE ? ESCAPE '\\'
     ORDER BY (lower(name) = ?) DESC, (lower(path) = ?) DESC, length(path) LIMIT 20`,
    [repoId, `%${needle.replace(/[%_\\]/g, (m) => '\\' + m)}%`, needle.split('/').pop(), needle],
  ).map((r) => ({ path: r.path, type: r.type === 'tree' ? 'folder' : 'file' }));
}

/** Architecture summary by (heuristic) role – used by the robot tour. */
export function architecture(ctx: Ctx, repoId: string) {
  const repo = requireRepo(ctx, repoId);
  const rows = ctx.db.all<{ role: string; files: number; lines: number }>(
    `SELECT role, COUNT(*) files, COALESCE(SUM(lines), 0) lines FROM code_files WHERE repo_id = ? AND excluded_reason IS NULL GROUP BY role ORDER BY files DESC`,
    [repoId],
  );
  const top = ctx.db.all<{ path: string; type: string }>(`SELECT path, type FROM repo_tree WHERE repo_id = ? AND parent_path = '' ORDER BY type DESC, path`, [repoId]);
  const topFolders = top.filter((t) => t.type === 'tree').map((t) => ({ path: t.path, ...folderRole(ctx, repoId, t.path) }));
  const langs = parseJson<Record<string, number>>(repo.languages, {});
  const deps = ctx.db.get<{ prod: number; dev: number }>('SELECT SUM(dev = 0) prod, SUM(dev = 1) dev FROM repo_dependencies WHERE repo_id = ?', [repoId]);
  const hubs = ctx.db.all<{ path: string; imports: string }>(`SELECT path, imports FROM code_files WHERE repo_id = ?`, [repoId]);
  const inbound = new Map<string, number>();
  for (const h of hubs) for (const t of parseJson<string[]>(h.imports, [])) inbound.set(t, (inbound.get(t) ?? 0) + 1);
  const mostUsed = [...inbound.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, count]) => ({ path, importedBy: count }));
  return {
    repo: serializeRepo(repo),
    roles: rows.map((r) => ({ role: r.role, label: ROLE_LABELS[r.role as Role] ?? r.role, files: r.files, lines: r.lines, simple: SIMPLE_EXPLANATIONS[r.role as Role] ?? null })),
    topFolders: topFolders.map((f) => ({ ...f, label: ROLE_LABELS[f.role], simple: SIMPLE_EXPLANATIONS[f.role], basis: 'vermutet' as const })),
    languages: langs,
    dependencies: { production: deps?.prod ?? 0, development: deps?.dev ?? 0 },
    mostUsed,
    analysis: latestAnalysis(ctx, repoId),
  };
}

/** Facts about one file or folder: what it imports, who imports it, exports, role. */
export function pathDetail(ctx: Ctx, repoId: string, path: string) {
  requireRepo(ctx, repoId);
  const entry = ctx.db.get<TreeRow>('SELECT * FROM repo_tree WHERE repo_id = ? AND path = ?', [repoId, path]);
  if (!entry && path !== '') throw notFound('Pfad');
  const isFolder = path === '' || entry?.type === 'tree';
  const prefix = path ? `${path}/` : '';
  if (isFolder) {
    const stats = ctx.db.get<{ files: number; lines: number }>(
      `SELECT COUNT(*) files, COALESCE(SUM(lines), 0) lines FROM code_files WHERE repo_id = ? AND path LIKE ? ESCAPE '\\'`,
      [repoId, `${prefix.replace(/[%_\\]/g, (m) => '\\' + m)}%`],
    )!;
    const inside = ctx.db.all<{ path: string; imports: string; external_imports: string }>(
      `SELECT path, imports, external_imports FROM code_files WHERE repo_id = ? AND path LIKE ? ESCAPE '\\'`,
      [repoId, `${prefix.replace(/[%_\\]/g, (m) => '\\' + m)}%`],
    );
    const outgoing = new Map<string, number>();
    const externals = new Map<string, number>();
    for (const f of inside) {
      for (const t of parseJson<string[]>(f.imports, [])) if (!t.startsWith(prefix)) outgoing.set(t.split('/').slice(0, 2).join('/'), (outgoing.get(t.split('/').slice(0, 2).join('/')) ?? 0) + 1);
      for (const x of parseJson<string[]>(f.external_imports, [])) externals.set(x, (externals.get(x) ?? 0) + 1);
    }
    const incoming = new Map<string, number>();
    for (const f of ctx.db.all<{ path: string; imports: string }>(`SELECT path, imports FROM code_files WHERE repo_id = ? AND path NOT LIKE ? ESCAPE '\\'`, [repoId, `${prefix.replace(/[%_\\]/g, (m) => '\\' + m)}%`])) {
      if (parseJson<string[]>(f.imports, []).some((t) => t.startsWith(prefix))) incoming.set(f.path.split('/').slice(0, 2).join('/'), (incoming.get(f.path.split('/').slice(0, 2).join('/')) ?? 0) + 1);
    }
    const role = path ? folderRole(ctx, repoId, path) : { role: 'other' as Role, share: 0 };
    return {
      path, type: 'folder' as const, name: path ? posix.basename(path) : '(Wurzel)', files: stats.files, lines: stats.lines,
      role: role.role, roleLabel: ROLE_LABELS[role.role], roleBasis: 'vermutet' as const, roleShare: role.share,
      simple: path ? SIMPLE_EXPLANATIONS[role.role] : SIMPLE_EXPLANATIONS.repository,
      dependsOn: [...outgoing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, c]) => ({ path: p, count: c })),
      usedBy: [...incoming.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, c]) => ({ path: p, count: c })),
      externalPackages: [...externals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, c]) => ({ name, count: c })),
    };
  }
  const f = ctx.db.get<CodeFileRow>('SELECT * FROM code_files WHERE repo_id = ? AND path = ?', [repoId, path]);
  const importedBy = ctx.db
    .all<{ path: string }>(`SELECT path FROM code_files WHERE repo_id = ? AND EXISTS (SELECT 1 FROM json_each(code_files.imports) WHERE json_each.value = ?) LIMIT 50`, [repoId, path])
    .map((r) => r.path);
  const role = (f?.role ?? classifyRole(path)) as Role;
  return {
    path, type: 'file' as const, name: posix.basename(path), size: entry?.size ?? f?.size ?? null, lines: f?.lines ?? null,
    language: f?.language ?? languageOf(path), role, roleLabel: ROLE_LABELS[role], roleBasis: 'vermutet' as const, simple: SIMPLE_EXPLANATIONS[role],
    imports: parseJson<string[]>(f?.imports, []), externalImports: parseJson<string[]>(f?.external_imports, []), exports: parseJson<string[]>(f?.exports, []),
    importedBy, analyzed: Boolean(f && !f.excluded_reason), excludedReason: f?.excluded_reason ?? (isSecretPath(path) ? 'secret' : null),
    protected: isSecretPath(path) || f?.excluded_reason === 'secret',
  };
}

const contentCache = new Map<string, { text: string; redactions: number; at: number }>();

/** Read-only file viewer with secret protection. Content is fetched on demand and cached in memory only. */
export async function fileContent(ctx: Ctx, repoId: string, path: string) {
  const repo = requireRepo(ctx, repoId);
  if (isSecretPath(path)) throw forbidden('Diese Datei kann Zugangsdaten enthalten und wird aus Sicherheitsgründen nie angezeigt.');
  const entry = ctx.db.get<{ type: string; size: number | null; sha: string }>('SELECT type, size, sha FROM repo_tree WHERE repo_id = ? AND path = ?', [repoId, path]);
  if (!entry || entry.type !== 'blob') throw notFound('Datei');
  if ((entry.size ?? 0) > 1024 * 1024) throw badRequest('Datei ist größer als 1 MB und wird nicht angezeigt.');
  const key = `${repoId}:${entry.sha}`;
  let cached = contentCache.get(key);
  if (!cached) {
    const raw = await new GitHubClient(ctx, githubToken(ctx).token).getRawFile(repo.full_name, path, repo.head_sha ?? repo.default_branch ?? 'HEAD');
    if (!raw) throw notFound('Datei');
    if (raw.text.slice(0, 8000).includes('\u0000')) throw badRequest('Binärdatei – keine Textansicht möglich.');
    const red = redactSecrets(raw.text);
    cached = { text: red.text, redactions: red.redactions, at: Date.now() };
    contentCache.set(key, cached);
    if (contentCache.size > 200) contentCache.delete(contentCache.keys().next().value!);
  }
  return { path, language: languageOf(path), sha: entry.sha, text: cached.text, redactions: cached.redactions, readOnly: true };
}
