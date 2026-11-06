import type { Ctx } from '../context';
import { parseJson } from '../lib/json';
import { minutesSince } from '../lib/time';
import { backupStatus } from './backup';
import { codeStatus, getNode, type NodeRow } from './nodes';
import { ideaStats } from './ideas';
import { aiStatus } from './ideas-ai';
import { githubSettings, githubToken, githubWebhookSecret } from './settings';
import { rateLimit } from './github/sync';
import type { Health } from '@shared/domain';

/**
 * Project health: a transparent score from verifiable signals. Each factor is returned with its reason,
 * so the number is never a black box (§18.3 "nachvollziehbare Bewertung").
 */
export function projectHealth(ctx: Ctx, node: NodeRow) {
  const factors: { key: string; label: string; ok: boolean; weight: number; detail: string }[] = [];
  const days = (minutesSince(node.last_activity_at) ?? 0) / 1440;
  factors.push({ key: 'fresh', label: 'Aktualität', ok: days <= 30, weight: 20, detail: days <= 30 ? `Letzte Aktivität vor ${Math.round(days)} Tagen` : `Seit ${Math.round(days)} Tagen keine Aktivität` });
  factors.push({ key: 'description', label: 'Beschreibung', ok: Boolean(node.summary || node.description), weight: 15, detail: node.summary || node.description ? 'Vorhanden' : 'Fehlt' });
  factors.push({ key: 'category', label: 'Kategorie', ok: Boolean(node.category_id), weight: 10, detail: node.category_id ? 'Zugeordnet' : 'Keine Kategorie' });
  const cs = codeStatus(ctx, node);
  factors.push({ key: 'code', label: 'Codebasis', ok: cs.status === 'detected', weight: 20, detail: cs.status === 'detected' ? `Repository ${cs.repoName} erreichbar` : cs.status === 'not_linked' ? 'Kein Repository verknüpft' : `Repository-Status: ${cs.status}` });
  const conflicts = ctx.db.get<{ c: number }>(
    `WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM nodes c JOIN d ON c.parent_id = d.id WHERE c.deleted_at IS NULL)
     SELECT COUNT(*) c FROM conflicts WHERE status = 'open' AND subject_type = 'node' AND subject_id IN (SELECT id FROM d)`,
    [node.id],
  )!.c;
  factors.push({ key: 'conflicts', label: 'Konflikte', ok: conflicts === 0, weight: 20, detail: conflicts ? `${conflicts} offene Konflikte` : 'Keine offenen Konflikte' });
  const claude = ctx.db.get<{ last_seen_at: string }>(`SELECT last_seen_at FROM external_identities WHERE entity_type = 'node' AND entity_id = ? AND source = 'claude'`, [node.id]);
  factors.push({ key: 'claude', label: 'Claude-Synchronisierung', ok: Boolean(claude), weight: 15, detail: claude ? `Zuletzt übermittelt ${claude.last_seen_at.slice(0, 10)}` : 'Keine Claude-Übermittlung (manuell gepflegt)' });
  const score = factors.reduce((s, f) => s + (f.ok ? f.weight : 0), 0);
  const health: Health = score >= 75 ? 'ok' : score >= 45 ? 'attention' : 'critical';
  return { score, health, factors };
}

export interface QualityIssue { id: string; severity: 'info' | 'warning'; type: string; title: string; detail: string; link: string; entityId?: string }

/** Data-quality checks: missing descriptions, unassigned items, stale GitHub data, undocumented folders … */
export function qualityIssues(ctx: Ctx, limit = 200): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (i: QualityIssue) => { if (issues.length < limit) issues.push(i); };
  for (const n of ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE deleted_at IS NULL AND archived_at IS NULL AND kind IN ('project','subproject') AND (summary IS NULL OR summary = '') AND (description IS NULL OR description = '') LIMIT 50`)) {
    add({ id: `desc:${n.id}`, severity: 'info', type: 'missing_description', title: `„${n.name}“ hat keine Beschreibung`, detail: 'Eine Kurzbeschreibung macht Projekte auffindbar.', link: `/projects/${n.id}`, entityId: n.id });
  }
  for (const n of ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE deleted_at IS NULL AND archived_at IS NULL AND kind = 'project' AND category_id IS NULL LIMIT 50`)) {
    add({ id: `cat:${n.id}`, severity: 'info', type: 'missing_category', title: `„${n.name}“ ist keiner Kategorie zugeordnet`, detail: 'Kategorien helfen beim Filtern und für Empfehlungen.', link: `/projects/${n.id}`, entityId: n.id });
  }
  for (const n of ctx.db.all<{ id: string; name: string; review_state: string }>(`SELECT id, name, review_state FROM nodes WHERE deleted_at IS NULL AND review_state <> 'ok' LIMIT 50`)) {
    add({ id: `review:${n.id}`, severity: 'warning', type: 'needs_review', title: `„${n.name}“: ${n.review_state === 'unassigned' ? 'nicht zugeordnet' : n.review_state === 'possible_duplicate' ? 'mögliches Duplikat' : 'Prüfung nötig'}`, detail: 'Bitte prüfen und zuordnen.', link: `/projects/${n.id}`, entityId: n.id });
  }
  for (const r of ctx.db.all<{ id: string; full_name: string; last_synced_at: string | null; status: string }>(`SELECT id, full_name, last_synced_at, status FROM repositories WHERE tracked = 1`)) {
    const age = minutesSince(r.last_synced_at);
    if (r.status !== 'ok' && r.status !== 'pending') add({ id: `repo:${r.id}`, severity: 'warning', type: 'repo_unreachable', title: `${r.full_name} ist nicht erreichbar`, detail: 'Gespiegelte Daten sind veraltet, bleiben aber erhalten.', link: `/code/${r.id}` });
    else if (age === null) add({ id: `repo-new:${r.id}`, severity: 'info', type: 'repo_never_synced', title: `${r.full_name} wurde noch nie abgeglichen`, detail: 'Im Sync Center einen Abgleich starten.', link: '/sync' });
    else if (age > 7 * 1440) add({ id: `repo-stale:${r.id}`, severity: 'info', type: 'repo_stale', title: `GitHub-Daten von ${r.full_name} älter als 7 Tage`, detail: `Letzter Abgleich: ${r.last_synced_at?.slice(0, 10)}`, link: `/code/${r.id}` });
  }
  for (const r of ctx.db.all<{ id: string; full_name: string }>(`SELECT id, full_name FROM repositories r WHERE tracked = 1 AND status = 'ok' AND NOT EXISTS (SELECT 1 FROM project_repository_links l WHERE l.repository_id = r.id AND l.status = 'confirmed')`)) {
    add({ id: `unlinked:${r.id}`, severity: 'info', type: 'repo_unlinked', title: `${r.full_name} ist keinem Projekt zugeordnet`, detail: 'Verknüpfe es über das Sync Center oder die Projektseite.', link: '/sync' });
  }
  for (const n of ctx.db.all<NodeRow>(`SELECT * FROM nodes WHERE deleted_at IS NULL AND code_path IS NOT NULL LIMIT 300`)) {
    const cs = codeStatus(ctx, n);
    if (cs.status === 'missing') add({ id: `code:${n.id}`, severity: 'warning', type: 'code_missing', title: `„${n.name}“: Codepfad ${cs.detail} nicht in ${cs.repoName} gefunden`, detail: 'Beschrieben, aber (noch) nicht im Repository vorhanden – oder Pfad falsch.', link: `/projects/${n.id}`, entityId: n.id });
  }
  // GitHub folders that no module documents (top-level folders of linked repos)
  for (const link of ctx.db.all<{ node_id: string; repository_id: string; full_name: string; name: string }>(
    `SELECT l.node_id, l.repository_id, r.full_name, n.name FROM project_repository_links l JOIN repositories r ON r.id = l.repository_id JOIN nodes n ON n.id = l.node_id
     WHERE l.status = 'confirmed' AND r.status = 'ok' AND n.deleted_at IS NULL`,
  )) {
    const mapped = new Set(ctx.db.all<{ code_path: string }>(
      `WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM nodes c JOIN d ON c.parent_id = d.id WHERE c.deleted_at IS NULL)
       SELECT code_path FROM nodes WHERE id IN (SELECT id FROM d) AND code_path IS NOT NULL`, [link.node_id]).map((r) => r.code_path.replace(/^\/+|\/+$/g, '').split('/')[0]));
    if (!mapped.size) continue; // only meaningful once the owner started mapping modules
    for (const f of ctx.db.all<{ path: string }>(`SELECT path FROM repo_tree WHERE repo_id = ? AND parent_path = '' AND type = 'tree' AND path NOT LIKE '.%'`, [link.repository_id])) {
      if (!mapped.has(f.path)) add({ id: `undoc:${link.repository_id}:${f.path}`, severity: 'info', type: 'undocumented_folder', title: `Ordner „${f.path}“ in ${link.full_name} ist keinem Modul zugeordnet`, detail: `Im Projekt „${link.name}“ als Modul erfassen oder bewusst ignorieren.`, link: `/projects/${link.node_id}` });
    }
  }
  for (const a of ctx.db.all<{ id: string; name: string }>(`SELECT id, name FROM applications WHERE deleted_at IS NULL AND archived_at IS NULL AND availability IN ('unverified','unreachable') LIMIT 50`)) {
    add({ id: `app:${a.id}`, severity: 'info', type: 'app_unverified', title: `Anwendung „${a.name}“ ist nicht als verfügbar nachgewiesen`, detail: 'Erreichbarkeit prüfen oder Startpunkt korrigieren.', link: `/apps?app=${a.id}` });
  }
  return issues;
}

export function integrationsStatus(ctx: Ctx) {
  const lastIngest = ctx.db.meta('last_claude_ingest_at');
  const tokens = ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM api_tokens WHERE revoked_at IS NULL AND scopes LIKE '%ingest%'`)!.c;
  const lastRun = ctx.db.get<{ status: string; finished_at: string; stats: string }>(`SELECT status, finished_at, stats FROM sync_runs WHERE source IN ('claude','file') ORDER BY started_at DESC LIMIT 1`);
  const gh = githubToken(ctx);
  const repos = ctx.db.get<{ total: number; ok: number; bad: number }>(`SELECT COUNT(*) total, SUM(status = 'ok') ok, SUM(status NOT IN ('ok','pending')) bad FROM repositories WHERE tracked = 1`)!;
  const lastGh = ctx.db.get<{ status: string; finished_at: string; error: string | null }>(`SELECT status, finished_at, error FROM sync_runs WHERE source = 'github' ORDER BY started_at DESC LIMIT 1`);
  const ai = aiStatus(ctx);
  const backup = backupStatus(ctx);
  const claudeHealth: Health = !tokens && !lastIngest ? 'unknown' : lastRun?.status === 'failed' ? 'critical' : lastRun?.status === 'partial' ? 'attention' : lastIngest ? 'ok' : 'attention';
  const ghHealth: Health = !repos.total ? 'unknown' : (repos.bad ?? 0) > 0 || lastGh?.status === 'failed' ? 'attention' : lastGh?.status === 'succeeded' || (repos.ok ?? 0) > 0 ? 'ok' : 'attention';
  return {
    claude: {
      health: claudeHealth,
      label: 'Claude (MCP / Ingest-API)',
      description: !tokens ? 'Nicht eingerichtet: Lege unter Einstellungen → Integrationen ein Ingest-Token an und verbinde den OMEGA-MCP-Server mit Claude Code.' : lastIngest ? `Letzte Übermittlung: ${lastIngest}` : 'Token vorhanden, aber noch keine Übermittlung empfangen.',
      tokens, lastIngestAt: lastIngest, lastRun: lastRun ? { ...lastRun, stats: parseJson(lastRun.stats, {}) } : null,
      note: 'OMEGA erhält nur Daten, die aktiv über MCP, API oder Datei übermittelt werden. Ein Zugriff auf private Claude.ai-Unterhaltungen oder -Projekte besteht nicht.',
    },
    github: {
      health: ghHealth,
      label: 'GitHub (nur lesend)',
      description: !repos.total ? 'Keine Repositories verfolgt. Füge Repositories hinzu oder hinterlege ein Token für die automatische Erkennung.' : `${repos.ok ?? 0} von ${repos.total} Repositories erreichbar${lastGh ? ` · letzter Abgleich ${lastGh.finished_at ?? 'läuft'}` : ''}`,
      tokenSource: gh.source, webhookConfigured: Boolean(githubWebhookSecret(ctx)), settings: githubSettings(ctx), rateLimit: rateLimit(),
      repos, lastRun: lastGh ?? null,
    },
    ai: { health: (ai.configured ? 'ok' : 'unknown') as Health, label: 'Claude API (Ideengenerierung)', description: ai.note, model: ai.model, configured: ai.configured },
    database: { health: 'ok' as Health, label: 'Datenbank (SQLite)', description: `Schema-Version ${ctx.db.get<{ v: number }>('SELECT MAX(id) v FROM schema_migrations')!.v}, WAL-Modus, synchrones Schreiben` },
    backup: { ...backup, health: backup.health as Health, label: 'Datensicherung', description: backup.last ? `Letzte Sicherung ${backup.last.createdAt}${backup.encryption ? ' · verschlüsselt' : ' · unverschlüsselt'}${backup.external.configured ? ' · externe Kopie aktiv' : ''}` : 'Noch keine Sicherung vorhanden' },
  };
}

export function dashboard(ctx: Ctx) {
  const counts = ctx.db.get<Record<string, number>>(
    `SELECT
      (SELECT COUNT(*) FROM nodes WHERE kind = 'project' AND deleted_at IS NULL AND archived_at IS NULL) projects,
      (SELECT COUNT(*) FROM nodes WHERE kind = 'project' AND deleted_at IS NULL AND archived_at IS NULL AND lifecycle_status = 'in_development') active,
      (SELECT COUNT(*) FROM nodes WHERE kind = 'project' AND deleted_at IS NULL AND archived_at IS NULL AND lifecycle_status IN ('idea','planned','concept')) planned,
      (SELECT COUNT(*) FROM nodes WHERE kind = 'project' AND deleted_at IS NULL AND archived_at IS NOT NULL) archived,
      (SELECT COUNT(*) FROM nodes WHERE deleted_at IS NULL AND kind NOT IN ('project')) modules,
      (SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND archived_at IS NULL) apps,
      (SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND archived_at IS NULL AND availability IN ('available','manual_confirmed')) appsAvailable,
      (SELECT COUNT(*) FROM conflicts WHERE status = 'open') openConflicts,
      (SELECT COUNT(*) FROM repositories WHERE tracked = 1) repositories,
      (SELECT COUNT(*) FROM nodes WHERE favorite = 1 AND deleted_at IS NULL) favoriteNodes`,
  )!;
  const ideas = ideaStats(ctx);
  const recent = ctx.db.all<NodeRow & { category_name: string | null; category_color: string | null }>(
    `SELECT n.*, c.name category_name, c.color category_color FROM nodes n LEFT JOIN categories c ON c.id = n.category_id
     WHERE n.kind = 'project' AND n.deleted_at IS NULL AND n.archived_at IS NULL ORDER BY n.last_activity_at DESC LIMIT 6`,
  ).map((n) => ({ id: n.id, name: n.name, summary: n.summary, status: n.lifecycle_status, progress: n.progress, color: n.color ?? n.category_color, icon: n.icon, category: n.category_name, lastActivityAt: n.last_activity_at, health: projectHealth(ctx, n) }));
  const favorites = [
    ...ctx.db.all<{ id: string; name: string; kind: string }>(`SELECT id, name, kind FROM nodes WHERE favorite = 1 AND deleted_at IS NULL ORDER BY last_activity_at DESC LIMIT 8`).map((n) => ({ type: 'node', id: n.id, name: n.name, sub: n.kind, link: `/projects/${n.id}` })),
    ...ctx.db.all<{ id: string; name: string; launch_url: string | null }>(`SELECT id, name, launch_url FROM applications WHERE favorite = 1 AND deleted_at IS NULL LIMIT 6`).map((a) => ({ type: 'application', id: a.id, name: a.name, sub: 'App', link: `/apps?app=${a.id}` })),
    ...ctx.db.all<{ id: string; title: string }>(`SELECT id, title FROM ideas WHERE favorite = 1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6`).map((i) => ({ type: 'idea', id: i.id, name: i.title, sub: 'Idee', link: `/ideas/${i.id}` })),
  ];
  const activity = ctx.db.all('SELECT id, at, actor, action, entity_type, entity_id, entity_name, summary FROM activity ORDER BY id DESC LIMIT 12');
  const integrations = integrationsStatus(ctx);
  const quality = qualityIssues(ctx, 40);
  return { counts, ideas, recent, favorites, activity, integrations, quality: { total: quality.length, top: quality.slice(0, 6) }, recommendations: recommendations(ctx, counts, ideas, integrations) };
}

/** Context-based, rule-driven recommendations (no AI – each states why it appears). */
function recommendations(ctx: Ctx, counts: Record<string, number>, ideas: ReturnType<typeof ideaStats>, integrations: ReturnType<typeof integrationsStatus>) {
  const out: { id: string; title: string; reason: string; link: string; action: string }[] = [];
  if (counts.openConflicts) out.push({ id: 'conflicts', title: `${counts.openConflicts} offene Konflikte entscheiden`, reason: 'Mehrdeutige Zuordnungen warten auf deine Entscheidung.', link: '/conflicts', action: 'Konflikte öffnen' });
  if (integrations.backup.health !== 'ok') out.push({ id: 'backup', title: 'Datensicherung prüfen', reason: integrations.backup.description, link: '/backups', action: 'Backups öffnen' });
  if (integrations.claude.health === 'unknown') out.push({ id: 'claude', title: 'Claude anbinden', reason: 'Mit dem OMEGA-MCP-Server übermittelt Claude Code Projekte und Fortschritte automatisch.', link: '/settings?tab=integrations', action: 'Einrichten' });
  if (integrations.github.health === 'unknown') out.push({ id: 'github', title: 'GitHub-Repositories verbinden', reason: 'Der Code Explorer und der Code-Status benötigen mindestens ein Repository.', link: '/sync', action: 'Repository hinzufügen' });
  if ((ideas?.saved ?? 0) > 0 && counts.projects === 0) out.push({ id: 'idea-project', title: 'Erste Idee als Projekt übernehmen', reason: `${ideas?.saved} gespeicherte Ideen warten.`, link: '/ideas?status=saved', action: 'Ideen ansehen' });
  const stale = ctx.db.get<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE kind = 'project' AND deleted_at IS NULL AND archived_at IS NULL AND lifecycle_status = 'in_development' AND last_activity_at < datetime('now', '-45 days') ORDER BY last_activity_at LIMIT 1`);
  if (stale) out.push({ id: `stale:${stale.id}`, title: `„${stale.name}“ ruht seit über 45 Tagen`, reason: 'Weiterentwickeln oder archivieren, um die aktive Ansicht übersichtlich zu halten.', link: `/projects/${stale.id}`, action: 'Projekt öffnen' });
  const unlinked = ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM project_repository_links WHERE status = 'suggested'`)!.c;
  if (unlinked) out.push({ id: 'suggestions', title: `${unlinked} Repository-Zuordnungen bestätigen`, reason: 'Vorschläge basieren auf Namensähnlichkeit oder Claude-Hinweisen und brauchen deine Bestätigung.', link: '/sync', action: 'Vorschläge prüfen' });
  if ((ideas?.unseen ?? 0) > 0) out.push({ id: 'ideas', title: 'Neue Ideen entdecken', reason: `${ideas?.unseen} Ideen in der Bibliothek hast du noch nicht angesehen.`, link: '/ideas?mode=discover', action: 'Entdecken' });
  return out.slice(0, 6);
}

export { getNode };
