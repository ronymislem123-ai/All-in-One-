import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId, slugify } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { probeUrl } from '../lib/safe-fetch';
import { logActivity, recordVersion } from './activity';
import { getTagsBulk, setTags } from './tags';
import { APP_KINDS, APP_KIND_LABELS, type AppKind } from '@shared/domain';
import { getNode, rootProjectId } from './nodes';

/** Internal routes that count as launchable internal applications. */
export const INTERNAL_ROUTES = ['/', '/projects', '/apps', '/ideas', '/knowledge', '/sync', '/conflicts', '/code', '/activity', '/backups', '/settings'];

export interface AppRow {
  id: string;
  node_id: string | null;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  category_id: string | null;
  kind: AppKind;
  launch_url: string | null;
  launch_hint: string | null;
  features: string;
  availability: string;
  availability_note: string | null;
  last_check_at: string | null;
  last_check_status: number | null;
  last_check_ms: number | null;
  last_check_error: string | null;
  favorite: number;
  last_opened_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

const urlOrPath = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || v.startsWith('/') || /^(https?:)\/\//i.test(v) || /^[a-z][a-z0-9+.-]*:/i.test(v), 'Bitte eine http(s)-URL, einen internen Pfad (/…) oder ein App-Protokoll angeben')
  .refine((v) => !/^(javascript|data|vbscript):/i.test(v), 'Dieses URL-Schema ist nicht erlaubt');

export const appInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(APP_KINDS),
  nodeId: z.string().nullable().optional(),
  summary: z.string().trim().max(300).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  launchUrl: urlOrPath.nullable().optional(),
  launchHint: z.string().max(1000).nullable().optional(),
  features: z.array(z.string().trim().max(200)).max(30).optional(),
  favorite: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  version: z.number().int().optional(),
});

export function serializeApp(a: AppRow, extra: { tags?: string[]; project?: { id: string; name: string } | null } = {}) {
  return {
    id: a.id,
    nodeId: a.node_id,
    project: extra.project ?? null,
    name: a.name,
    summary: a.summary,
    description: a.description,
    icon: a.icon,
    color: a.color,
    categoryId: a.category_id,
    kind: a.kind,
    kindLabel: APP_KIND_LABELS[a.kind],
    launchUrl: a.launch_url,
    launchHint: a.launch_hint,
    features: parseJson<string[]>(a.features, []),
    availability: a.availability,
    availabilityNote: a.availability_note,
    lastCheck: a.last_check_at ? { at: a.last_check_at, status: a.last_check_status, ms: a.last_check_ms, error: a.last_check_error } : null,
    favorite: Boolean(a.favorite),
    lastOpenedAt: a.last_opened_at,
    version: a.version,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    archivedAt: a.archived_at,
    tags: extra.tags ?? [],
  };
}

export function requireApp(ctx: Ctx, id: string): AppRow {
  const a = ctx.db.get<AppRow>('SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!a) throw notFound('Anwendung');
  return a;
}

export function listApps(ctx: Ctx, f: { q?: string; kind?: string; availability?: string; category?: string; favorite?: boolean; archived?: boolean; nodeId?: string }) {
  const where = ['a.deleted_at IS NULL', f.archived ? 'a.archived_at IS NOT NULL' : 'a.archived_at IS NULL'];
  const params: unknown[] = [];
  if (f.q) { where.push('(a.name LIKE ? OR a.summary LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  if (f.kind) { where.push('a.kind = ?'); params.push(f.kind); }
  if (f.availability) { where.push('a.availability = ?'); params.push(f.availability); }
  if (f.category) { where.push('a.category_id = ?'); params.push(f.category); }
  if (f.favorite) where.push('a.favorite = 1');
  if (f.nodeId) { where.push('a.node_id = ?'); params.push(f.nodeId); }
  const rows = ctx.db.all<AppRow & { project_name: string | null }>(
    `SELECT a.*, n.name project_name FROM applications a LEFT JOIN nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
     WHERE ${where.join(' AND ')} ORDER BY a.favorite DESC, COALESCE(a.last_opened_at, a.updated_at) DESC LIMIT 500`,
    params,
  );
  const tags = getTagsBulk(ctx, 'application', rows.map((r) => r.id));
  return rows.map((r) => serializeApp(r, { tags: tags.get(r.id), project: r.node_id && r.project_name ? { id: r.node_id, name: r.project_name } : null }));
}

function checkNode(ctx: Ctx, nodeId: string | null | undefined) {
  if (nodeId && !getNode(ctx, nodeId)) throw badRequest('Zugehöriges Projekt existiert nicht.');
}

export function createApp(ctx: Ctx, meta: WriteMeta, raw: z.input<typeof appInputSchema>): AppRow {
  const input = appInputSchema.parse(raw);
  checkNode(ctx, input.nodeId);
  const id = newId('app');
  const now = nowIso();
  ctx.db.write(() => {
    ctx.db.run(
      `INSERT INTO applications(id, node_id, name, slug, summary, description, icon, color, category_id, kind, launch_url, launch_hint,
        features, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.nodeId ?? null, input.name, slugify(input.name), input.summary ?? null, input.description ?? null,
        input.icon ?? null, input.color ?? null, input.categoryId ?? null, input.kind, input.launchUrl || null,
        input.launchHint ?? null, JSON.stringify(input.features ?? []), input.favorite ? 1 : 0, now, now,
      ],
    );
    if (input.tags?.length) setTags(ctx, 'application', id, input.tags);
    const row = requireApp(ctx, id);
    recordVersion(ctx, meta, 'application', id, 1, 'create', row);
    logActivity(ctx, meta, {
      action: 'app.created', summary: `Anwendung „${input.name}“ angelegt (${APP_KIND_LABELS[input.kind]}) – Verfügbarkeit noch nicht geprüft`,
      entityType: 'application', entityId: id, entityName: input.name, projectId: input.nodeId ? rootProjectId(ctx, input.nodeId) : null,
    });
  });
  ctx.hooks.onChange?.('application', id);
  return requireApp(ctx, id);
}

export function updateApp(ctx: Ctx, meta: WriteMeta, id: string, raw: Partial<z.input<typeof appInputSchema>>): AppRow {
  const input = appInputSchema.partial().parse(raw);
  const cur = requireApp(ctx, id);
  if (input.version !== undefined && input.version !== cur.version) throw conflict('Die Anwendung wurde inzwischen geändert. Bitte neu laden.');
  checkNode(ctx, input.nodeId);
  const launchChanged = input.launchUrl !== undefined && (input.launchUrl || null) !== cur.launch_url;
  const kindChanged = input.kind !== undefined && input.kind !== cur.kind;
  const now = nowIso();
  ctx.db.write(() => {
    ctx.db.run(
      `UPDATE applications SET node_id = ?, name = ?, slug = ?, summary = ?, description = ?, icon = ?, color = ?, category_id = ?, kind = ?,
        launch_url = ?, launch_hint = ?, features = ?, favorite = ?,
        availability = ?, availability_note = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [
        input.nodeId !== undefined ? input.nodeId : cur.node_id,
        input.name ?? cur.name, slugify(input.name ?? cur.name),
        input.summary !== undefined ? input.summary : cur.summary,
        input.description !== undefined ? input.description : cur.description,
        input.icon !== undefined ? input.icon : cur.icon,
        input.color !== undefined ? input.color : cur.color,
        input.categoryId !== undefined ? input.categoryId : cur.category_id,
        input.kind ?? cur.kind,
        input.launchUrl !== undefined ? input.launchUrl || null : cur.launch_url,
        input.launchHint !== undefined ? input.launchHint : cur.launch_hint,
        input.features ? JSON.stringify(input.features) : cur.features,
        input.favorite !== undefined ? (input.favorite ? 1 : 0) : cur.favorite,
        // a changed launch target invalidates a previous availability proof
        launchChanged || kindChanged ? 'unverified' : cur.availability,
        launchChanged || kindChanged ? 'Startpunkt geändert – erneute Prüfung nötig' : cur.availability_note,
        now, id,
      ],
    );
    if (input.tags) setTags(ctx, 'application', id, input.tags);
    const row = requireApp(ctx, id);
    recordVersion(ctx, meta, 'application', id, row.version, 'update', row);
    logActivity(ctx, meta, {
      action: 'app.updated', summary: `Anwendung „${row.name}“ aktualisiert${launchChanged ? ' (Startpunkt geändert)' : ''}`,
      entityType: 'application', entityId: id, entityName: row.name,
      projectId: row.node_id ? rootProjectId(ctx, row.node_id) : null,
    });
  });
  ctx.hooks.onChange?.('application', id);
  return requireApp(ctx, id);
}

/**
 * Availability proof. "available" is only ever set from a successful technical check (§5.3).
 * Desktop apps without an http(s) start point can only be confirmed manually – shown distinctly.
 */
export async function checkApp(ctx: Ctx, meta: WriteMeta, id: string) {
  const app = requireApp(ctx, id);
  const now = nowIso();
  let availability: string;
  let status: number | null = null;
  let ms: number | null = null;
  let error: string | null = null;
  let note: string | null = null;
  const url = app.launch_url;
  if (!url) {
    availability = 'unverified';
    error = 'Kein Startpunkt hinterlegt';
  } else if (url.startsWith('/')) {
    const path = url.split(/[?#]/)[0].replace(/\/$/, '') || '/';
    const ok = INTERNAL_ROUTES.some((r) => path === r || (r !== '/' && path.startsWith(r + '/')));
    availability = ok ? 'available' : 'unreachable';
    note = ok ? 'Interne Route vorhanden' : null;
    error = ok ? null : 'Interne Route existiert nicht';
    ms = 0;
  } else if (/^https?:\/\//i.test(url)) {
    const res = await probeUrl(url, { allowPrivate: ctx.config.appCheck.allowPrivateHosts });
    availability = res.ok ? 'available' : 'unreachable';
    status = res.status;
    ms = res.ms;
    error = res.error ?? null;
    note = res.note ?? (res.ok ? `Antwort HTTP ${res.status}` : null);
  } else {
    availability = app.availability === 'manual_confirmed' ? 'manual_confirmed' : 'unverified';
    error = 'App-Protokoll kann technisch nicht geprüft werden – bitte manuell bestätigen';
  }
  ctx.db.write(() => {
    ctx.db.run(
      `UPDATE applications SET availability = ?, availability_note = ?, last_check_at = ?, last_check_status = ?, last_check_ms = ?, last_check_error = ? WHERE id = ?`,
      [availability, note, now, status, ms, error, id],
    );
    logActivity(ctx, meta, {
      action: 'app.checked',
      summary: `Verfügbarkeit von „${app.name}“ geprüft: ${availability === 'available' ? 'erreichbar' : availability === 'unreachable' ? `nicht erreichbar (${error})` : 'nicht prüfbar'}`,
      entityType: 'application', entityId: id, entityName: app.name, data: { status, ms, error },
    });
  });
  return serializeApp(requireApp(ctx, id));
}

export function confirmManually(ctx: Ctx, meta: WriteMeta, id: string, note: string) {
  const app = requireApp(ctx, id);
  if (!note.trim()) throw badRequest('Bitte kurz beschreiben, wie die Anwendung gestartet wurde.');
  ctx.db.write(() => {
    ctx.db.run(`UPDATE applications SET availability = 'manual_confirmed', availability_note = ?, last_check_at = ? WHERE id = ?`, [note.trim(), nowIso(), id]);
    logActivity(ctx, meta, {
      action: 'app.confirmed', summary: `Start von „${app.name}“ manuell bestätigt: ${note.trim()}`,
      entityType: 'application', entityId: id, entityName: app.name,
    });
  });
  return serializeApp(requireApp(ctx, id));
}

export function markOpened(ctx: Ctx, id: string): void {
  requireApp(ctx, id);
  ctx.db.run('UPDATE applications SET last_opened_at = ? WHERE id = ?', [nowIso(), id]);
}

export function trashApp(ctx: Ctx, meta: WriteMeta, id: string): void {
  const app = requireApp(ctx, id);
  ctx.db.write(() => {
    ctx.db.run('UPDATE applications SET deleted_at = ?, version = version + 1 WHERE id = ?', [nowIso(), id]);
    logActivity(ctx, meta, { action: 'app.trashed', summary: `Anwendung „${app.name}“ in den Papierkorb gelegt`, entityType: 'application', entityId: id, entityName: app.name });
  });
  ctx.hooks.onChange?.('application', id);
}

export function restoreApp(ctx: Ctx, meta: WriteMeta, id: string): void {
  const app = ctx.db.get<AppRow>('SELECT * FROM applications WHERE id = ?', [id]);
  if (!app) throw notFound('Anwendung');
  ctx.db.write(() => {
    ctx.db.run('UPDATE applications SET deleted_at = NULL, version = version + 1 WHERE id = ?', [id]);
    logActivity(ctx, meta, { action: 'app.restored', summary: `Anwendung „${app.name}“ wiederhergestellt`, entityType: 'application', entityId: id, entityName: app.name });
  });
  ctx.hooks.onChange?.('application', id);
}

export function purgeApp(ctx: Ctx, meta: WriteMeta, id: string): void {
  const app = ctx.db.get<AppRow>('SELECT * FROM applications WHERE id = ? AND deleted_at IS NOT NULL', [id]);
  if (!app) throw badRequest('Nur Anwendungen im Papierkorb können endgültig gelöscht werden.');
  ctx.db.write(() => {
    ctx.db.run(`DELETE FROM entity_tags WHERE entity_type = 'application' AND entity_id = ?`, [id]);
    ctx.db.run(`DELETE FROM attachments WHERE entity_type = 'application' AND entity_id = ?`, [id]);
    ctx.db.run('DELETE FROM applications WHERE id = ?', [id]);
    logActivity(ctx, meta, { action: 'app.purged', summary: `Anwendung „${app.name}“ endgültig gelöscht`, entityType: 'application', entityId: id, entityName: app.name });
  });
  ctx.hooks.onChange?.('application', id);
}

export function setAppArchived(ctx: Ctx, meta: WriteMeta, id: string, archived: boolean) {
  const app = requireApp(ctx, id);
  ctx.db.write(() => {
    ctx.db.run('UPDATE applications SET archived_at = ? WHERE id = ?', [archived ? nowIso() : null, id]);
    logActivity(ctx, meta, { action: archived ? 'app.archived' : 'app.unarchived', summary: `Anwendung „${app.name}“ ${archived ? 'archiviert' : 'reaktiviert'}`, entityType: 'application', entityId: id, entityName: app.name });
  });
  return serializeApp(requireApp(ctx, id));
}
