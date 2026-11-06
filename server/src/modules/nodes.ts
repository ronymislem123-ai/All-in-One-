import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId, slugify } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { logActivity, recordVersion } from './activity';
import { getTags, getTagsBulk, setTags } from './tags';
import {
  LIFECYCLE_STATUSES, NODE_KINDS, NODE_KIND_LABELS, NODE_NATURES, VERIFICATION_STATUSES,
  type CodeStatus, type NodeKind,
} from '@shared/domain';

export interface NodeRow {
  id: string;
  kind: NodeKind;
  parent_id: string | null;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  body: string | null;
  icon: string | null;
  color: string | null;
  url: string | null;
  category_id: string | null;
  lifecycle_status: string;
  verification_status: string;
  verification_note: string | null;
  verified_at: string | null;
  priority: number;
  progress: number | null;
  nature: string;
  code_path: string | null;
  notes: string | null;
  favorite: number;
  review_state: string;
  origin: string;
  field_sources: string;
  claude_project_url: string | null;
  sort_order: number;
  version: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export type FieldSources = Record<string, { src: string; at: string; rejected?: string }>;

/** Fields that can be edited through the generic update path. */
export const EDITABLE_FIELDS = [
  'name', 'summary', 'description', 'body', 'icon', 'color', 'url', 'category_id', 'lifecycle_status',
  'verification_status', 'verification_note', 'priority', 'progress', 'nature', 'code_path', 'notes',
  'favorite', 'review_state', 'claude_project_url', 'kind', 'sort_order',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const nodeCreateSchema = z.object({
  kind: z.enum(NODE_KINDS).default('project'),
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(400).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  body: z.string().max(200000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional().or(z.literal('').transform(() => null)),
  categoryId: z.string().nullable().optional(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  nature: z.enum(NODE_NATURES).optional(),
  codePath: z.string().trim().max(500).nullable().optional(),
  notes: z.string().max(50000).nullable().optional(),
  favorite: z.boolean().optional(),
  claudeProjectUrl: z.string().url().max(2000).nullable().optional().or(z.literal('').transform(() => null)),
  tags: z.array(z.string().max(40)).max(30).optional(),
});
export type NodeCreateInput = z.input<typeof nodeCreateSchema>;

export const nodeUpdateSchema = z.object({
  version: z.number().int().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(400).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  body: z.string().max(200000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional().or(z.literal('').transform(() => null)),
  categoryId: z.string().nullable().optional(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  verificationNote: z.string().max(4000).nullable().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  nature: z.enum(NODE_NATURES).optional(),
  codePath: z.string().trim().max(500).nullable().optional(),
  notes: z.string().max(50000).nullable().optional(),
  favorite: z.boolean().optional(),
  reviewState: z.enum(['ok', 'needs_review', 'possible_duplicate', 'unassigned']).optional(),
  claudeProjectUrl: z.string().url().max(2000).nullable().optional().or(z.literal('').transform(() => null)),
  tags: z.array(z.string().max(40)).max(30).optional(),
});
export type NodeUpdateInput = z.input<typeof nodeUpdateSchema>;

const CAMEL_TO_COLUMN: Record<string, EditableField> = {
  name: 'name', summary: 'summary', description: 'description', body: 'body', icon: 'icon', color: 'color', url: 'url',
  categoryId: 'category_id', lifecycleStatus: 'lifecycle_status', verificationStatus: 'verification_status',
  verificationNote: 'verification_note', priority: 'priority', progress: 'progress', nature: 'nature', codePath: 'code_path',
  notes: 'notes', favorite: 'favorite', reviewState: 'review_state', claudeProjectUrl: 'claude_project_url',
};

// ── Reads ──────────────────────────────────────────────────────────────────
export function getNode(ctx: Ctx, id: string, includeDeleted = false): NodeRow | undefined {
  return ctx.db.get<NodeRow>(`SELECT * FROM nodes WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [id]);
}

export function requireNode(ctx: Ctx, id: string, includeDeleted = false): NodeRow {
  const n = getNode(ctx, id, includeDeleted);
  if (!n) throw notFound('Projekt/Modul');
  return n;
}

export function ancestors(ctx: Ctx, id: string): { id: string; name: string; kind: NodeKind }[] {
  return ctx.db
    .all<{ id: string; name: string; kind: NodeKind; lvl: number }>(
      `WITH RECURSIVE up(id, parent_id, name, kind, lvl) AS (
         SELECT id, parent_id, name, kind, 0 FROM nodes WHERE id = ?
         UNION ALL SELECT n.id, n.parent_id, n.name, n.kind, up.lvl + 1 FROM nodes n JOIN up ON n.id = up.parent_id WHERE up.lvl < 1000)
       SELECT id, name, kind, lvl FROM up WHERE lvl > 0 ORDER BY lvl DESC`,
      [id],
    )
    .map(({ id: aid, name, kind }) => ({ id: aid, name, kind }));
}

export function rootProjectId(ctx: Ctx, id: string): string {
  const a = ancestors(ctx, id);
  return a.length ? a[0].id : id;
}

/** All descendant ids (excluding the node itself). */
export function descendantIds(ctx: Ctx, id: string, opts: { includeDeleted?: boolean } = {}): string[] {
  return ctx.db
    .all<{ id: string }>(
      `WITH RECURSIVE down(id, lvl) AS (
         SELECT id, 0 FROM nodes WHERE id = ?
         UNION ALL SELECT n.id, down.lvl + 1 FROM nodes n JOIN down ON n.parent_id = down.id
           WHERE down.lvl < 1000 ${opts.includeDeleted ? '' : 'AND n.deleted_at IS NULL'})
       SELECT id FROM down WHERE lvl > 0`,
      [id],
    )
    .map((r) => r.id);
}

export function serializeNode(n: NodeRow) {
  return {
    id: n.id,
    kind: n.kind,
    kindLabel: NODE_KIND_LABELS[n.kind],
    parentId: n.parent_id,
    name: n.name,
    summary: n.summary,
    description: n.description,
    body: n.body,
    icon: n.icon,
    color: n.color,
    url: n.url,
    categoryId: n.category_id,
    lifecycleStatus: n.lifecycle_status,
    verificationStatus: n.verification_status,
    verificationNote: n.verification_note,
    verifiedAt: n.verified_at,
    priority: n.priority,
    progress: n.progress,
    nature: n.nature,
    codePath: n.code_path,
    notes: n.notes,
    favorite: Boolean(n.favorite),
    reviewState: n.review_state,
    origin: n.origin,
    fieldSources: parseJson<FieldSources>(n.field_sources, {}),
    claudeProjectUrl: n.claude_project_url,
    version: n.version,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    lastActivityAt: n.last_activity_at,
    archivedAt: n.archived_at,
    deletedAt: n.deleted_at,
  };
}
export type NodeDto = ReturnType<typeof serializeNode>;

// ── Code status (derived from GitHub data, never set manually) ─────────────
export function codeStatus(ctx: Ctx, node: NodeRow): { status: CodeStatus; repoId?: string; repoName?: string; detail?: string } {
  const chain = [node.id, ...ancestors(ctx, node.id).map((a) => a.id).reverse()];
  for (const nid of chain) {
    const link = ctx.db.get<{ repository_id: string; full_name: string; status: string; head_sha: string | null }>(
      `SELECT l.repository_id, r.full_name, r.status, r.head_sha FROM project_repository_links l
       JOIN repositories r ON r.id = l.repository_id WHERE l.node_id = ? AND l.status = 'confirmed' ORDER BY l.created_at LIMIT 1`,
      [nid],
    );
    if (!link) continue;
    const base = { repoId: link.repository_id, repoName: link.full_name };
    if (link.status === 'pending') return { status: 'pending', ...base };
    if (link.status !== 'ok') return { status: 'unreachable', ...base, detail: link.status };
    if (!link.head_sha) return { status: 'pending', ...base };
    if (node.code_path) {
      const p = node.code_path.replace(/^\/+|\/+$/g, '');
      const hit = ctx.db.get('SELECT 1 FROM repo_tree WHERE repo_id = ? AND path = ?', [link.repository_id, p]);
      return hit ? { status: 'detected', ...base, detail: p } : { status: 'missing', ...base, detail: p };
    }
    // project-level node with a reachable linked repo → code exists; deeper nodes without code path → not mapped
    if (nid === node.id) return { status: 'detected', ...base };
    return { status: 'not_linked', ...base, detail: 'Kein Codepfad zugeordnet' };
  }
  return { status: 'not_linked' };
}

// ── Writes ─────────────────────────────────────────────────────────────────
function assertParent(ctx: Ctx, nodeId: string | null, parentId: string | null | undefined): void {
  if (!parentId) return;
  const p = getNode(ctx, parentId);
  if (!p) throw badRequest('Elternobjekt existiert nicht (oder liegt im Papierkorb).');
  if (nodeId) {
    if (parentId === nodeId) throw badRequest('Ein Objekt kann nicht sein eigenes Elternobjekt sein.');
    if (descendantIds(ctx, nodeId, { includeDeleted: true }).includes(parentId)) {
      throw badRequest('Zirkuläre Elternbeziehung: Das Ziel liegt innerhalb dieses Objekts.');
    }
  }
}

/** project ↔ subproject kind follows the position in the hierarchy. */
function normalizeKind(kind: NodeKind, parentId: string | null | undefined): NodeKind {
  if (kind === 'project' && parentId) return 'subproject';
  if (kind === 'subproject' && !parentId) return 'project';
  return kind;
}

export function createNode(ctx: Ctx, meta: WriteMeta, raw: NodeCreateInput, extra: { origin?: string; reviewState?: string; id?: string } = {}): NodeRow {
  const input = nodeCreateSchema.parse(raw);
  assertParent(ctx, null, input.parentId);
  const id = extra.id ?? newId('nd');
  const now = nowIso();
  const kind = normalizeKind(input.kind, input.parentId);
  const sources: FieldSources = {};
  const src = meta.actor === 'user' ? 'website' : meta.actor;
  for (const [k, v] of Object.entries(input)) {
    const col = CAMEL_TO_COLUMN[k];
    if (col && v !== undefined && v !== null) sources[col] = { src, at: now };
  }
  sources.parent = { src, at: now };
  const order = ctx.db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) + 10 m FROM nodes WHERE parent_id IS ?', [input.parentId ?? null])!.m;
  ctx.db.write(() => {
    ctx.db.run(
      `INSERT INTO nodes(id, kind, parent_id, name, slug, summary, description, body, icon, color, url, category_id,
        lifecycle_status, priority, progress, nature, code_path, notes, favorite, review_state, origin, field_sources,
        claude_project_url, sort_order, version, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id, kind, input.parentId ?? null, input.name, slugify(input.name), input.summary ?? null, input.description ?? null,
        input.body ?? null, input.icon ?? null, input.color ?? null, input.url ?? null, input.categoryId ?? null,
        input.lifecycleStatus ?? (kind === 'documentation' ? 'concept' : 'planned'), input.priority ?? 2, input.progress ?? null,
        input.nature ?? (['component'].includes(kind) ? 'technical' : 'organizational'), input.codePath ?? null,
        input.notes ?? null, input.favorite ? 1 : 0, extra.reviewState ?? 'ok', extra.origin ?? (src === 'website' ? 'website' : src),
        JSON.stringify(sources), input.claudeProjectUrl ?? null, order, now, now, now,
      ],
    );
    if (input.tags?.length) setTags(ctx, 'node', id, input.tags);
    const row = getNode(ctx, id)!;
    recordVersion(ctx, meta, 'node', id, 1, 'create', row);
    logActivity(ctx, meta, {
      action: 'node.created',
      summary: `${NODE_KIND_LABELS[kind]} „${input.name}“ angelegt`,
      entityType: 'node', entityId: id, entityName: input.name,
      projectId: input.parentId ? rootProjectId(ctx, id) : id,
    });
    touchAncestors(ctx, id, now);
  });
  ctx.hooks.onChange?.('node', id);
  return getNode(ctx, id)!;
}

function touchAncestors(ctx: Ctx, id: string, at: string): void {
  const ids = ancestors(ctx, id).map((a) => a.id);
  if (ids.length) ctx.db.run(`UPDATE nodes SET last_activity_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [at, ...ids]);
}

export interface UpdateOptions {
  /** Optimistic concurrency check – rejects stale edits from another tab/session. */
  expectedVersion?: number;
  /** Activity summary override */
  summary?: string;
  action?: string;
}

/**
 * Generic field update with provenance tracking. Records a version snapshot and an activity entry.
 * Callers that apply external data (Claude) must check authority rules before calling (see ingest).
 */
export function updateNode(ctx: Ctx, meta: WriteMeta, id: string, raw: NodeUpdateInput, opts: UpdateOptions = {}): NodeRow {
  const input = nodeUpdateSchema.parse(raw);
  const current = requireNode(ctx, id);
  const expected = opts.expectedVersion ?? input.version;
  if (expected !== undefined && expected !== current.version) {
    throw conflict('Der Eintrag wurde inzwischen geändert. Bitte neu laden – deine Eingaben wurden nicht gespeichert.', { currentVersion: current.version });
  }
  const now = nowIso();
  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: string[] = [];
  const sources = parseJson<FieldSources>(current.field_sources, {});
  const src = meta.actor === 'user' ? 'website' : meta.actor;
  for (const [k, v] of Object.entries(input)) {
    if (k === 'version' || k === 'tags' || v === undefined) continue;
    const col = CAMEL_TO_COLUMN[k];
    if (!col) continue;
    const value = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    if ((current as unknown as Record<string, unknown>)[col] === value) continue;
    sets.push(`${col} = ?`);
    params.push(value);
    changed.push(col);
    sources[col] = { src, at: now };
    if (col === 'name') { sets.push('slug = ?'); params.push(slugify(String(value))); }
    if (col === 'verification_status') { sets.push('verified_at = ?'); params.push(value === 'unverified' ? null : now); }
  }
  if (input.categoryId && !ctx.db.get('SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL', [input.categoryId])) {
    throw badRequest('Unbekannte Kategorie.');
  }
  const tagsChanged = input.tags !== undefined && JSON.stringify(getTags(ctx, 'node', id)) !== JSON.stringify([...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort());
  if (!changed.length && !tagsChanged) return current;
  ctx.db.write(() => {
    if (changed.length) {
      ctx.db.run(
        `UPDATE nodes SET ${sets.join(', ')}, field_sources = ?, version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?`,
        [...params, JSON.stringify(sources), now, now, id],
      );
    } else {
      ctx.db.run('UPDATE nodes SET version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?', [now, now, id]);
    }
    if (tagsChanged) setTags(ctx, 'node', id, input.tags!);
    const row = getNode(ctx, id)!;
    recordVersion(ctx, meta, 'node', id, row.version, 'update', row);
    logActivity(ctx, meta, {
      action: opts.action ?? 'node.updated',
      summary: opts.summary ?? `„${row.name}“ aktualisiert (${[...changed, ...(tagsChanged ? ['tags'] : [])].map(fieldLabel).join(', ')})`,
      entityType: 'node', entityId: id, entityName: row.name, projectId: rootProjectId(ctx, id),
      data: { fields: changed },
    });
    touchAncestors(ctx, id, now);
  });
  ctx.hooks.onChange?.('node', id);
  return getNode(ctx, id)!;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', summary: 'Kurzbeschreibung', description: 'Beschreibung', body: 'Inhalt', icon: 'Icon', color: 'Farbe', url: 'URL',
  category_id: 'Kategorie', lifecycle_status: 'Status', verification_status: 'Prüfstatus', verification_note: 'Prüfnotiz',
  priority: 'Priorität', progress: 'Fortschritt', nature: 'Art', code_path: 'Codepfad', notes: 'Notizen', favorite: 'Favorit',
  review_state: 'Prüfzustand', claude_project_url: 'Claude-Referenz', tags: 'Tags', parent: 'Position', kind: 'Typ',
};
export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;

export function moveNode(ctx: Ctx, meta: WriteMeta, id: string, parentId: string | null, opts: { expectedVersion?: number } = {}): NodeRow {
  const current = requireNode(ctx, id);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== current.version) throw conflict('Der Eintrag wurde inzwischen geändert.');
  if (current.parent_id === parentId) return current;
  assertParent(ctx, id, parentId);
  const now = nowIso();
  const kind = normalizeKind(current.kind, parentId);
  const sources = parseJson<FieldSources>(current.field_sources, {});
  sources.parent = { src: meta.actor === 'user' ? 'website' : meta.actor, at: now };
  const order = ctx.db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) + 10 m FROM nodes WHERE parent_id IS ?', [parentId])!.m;
  const from = current.parent_id ? getNode(ctx, current.parent_id, true)?.name : 'oberste Ebene';
  const to = parentId ? getNode(ctx, parentId)?.name : 'oberste Ebene';
  ctx.db.write(() => {
    ctx.db.run(
      `UPDATE nodes SET parent_id = ?, kind = ?, sort_order = ?, field_sources = ?, review_state = CASE WHEN review_state = 'unassigned' THEN 'ok' ELSE review_state END,
       version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      [parentId, kind, order, JSON.stringify(sources), now, now, id],
    );
    const row = getNode(ctx, id)!;
    recordVersion(ctx, meta, 'node', id, row.version, 'move', row);
    logActivity(ctx, meta, {
      action: 'node.moved', summary: `„${row.name}“ verschoben: ${from} → ${to}`,
      entityType: 'node', entityId: id, entityName: row.name, projectId: rootProjectId(ctx, id),
      data: { from: current.parent_id, to: parentId },
    });
    touchAncestors(ctx, id, now);
  });
  ctx.hooks.onChange?.('node', id);
  return getNode(ctx, id)!;
}

export function setArchived(ctx: Ctx, meta: WriteMeta, id: string, archived: boolean): NodeRow {
  const current = requireNode(ctx, id);
  if (Boolean(current.archived_at) === archived) return current;
  const now = nowIso();
  ctx.db.write(() => {
    ctx.db.run('UPDATE nodes SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ?', [archived ? now : null, now, id]);
    const row = getNode(ctx, id)!;
    recordVersion(ctx, meta, 'node', id, row.version, 'archive', row);
    logActivity(ctx, meta, {
      action: archived ? 'node.archived' : 'node.unarchived',
      summary: archived ? `„${row.name}“ archiviert (Daten bleiben vollständig erhalten)` : `„${row.name}“ aus dem Archiv geholt`,
      entityType: 'node', entityId: id, entityName: row.name, projectId: rootProjectId(ctx, id),
    });
  });
  ctx.hooks.onChange?.('node', id);
  return getNode(ctx, id)!;
}

/**
 * Moves a node (and, with cascade, its subtree) to the trash. Without cascade a node that still has
 * children is refused – sub-objects must never disappear unintentionally (§12.2).
 * GitHub repositories are never touched (§9.6).
 */
export function trashNode(ctx: Ctx, meta: WriteMeta, id: string, cascade = false): { trashed: string[] } {
  const node = requireNode(ctx, id);
  const children = descendantIds(ctx, id);
  if (children.length && !cascade) {
    throw conflict(`„${node.name}“ enthält ${children.length} Unterobjekte. Bitte zuerst verschieben oder ausdrücklich mitsamt Unterobjekten in den Papierkorb legen.`, { children: children.length });
  }
  const stamp = nowIso();
  const ids = [id, ...children];
  ctx.db.write(() => {
    for (const nid of ids) {
      ctx.db.run('UPDATE nodes SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?', [stamp, stamp, nid]);
      const row = getNode(ctx, nid, true)!;
      recordVersion(ctx, meta, 'node', nid, row.version, 'delete', row);
    }
    logActivity(ctx, meta, {
      action: 'node.trashed',
      summary: `„${node.name}“${children.length ? ` mit ${children.length} Unterobjekten` : ''} in den Papierkorb gelegt (wiederherstellbar)`,
      entityType: 'node', entityId: id, entityName: node.name, projectId: node.parent_id ? rootProjectId(ctx, id) : id,
      data: { ids },
    });
  });
  for (const nid of ids) ctx.hooks.onChange?.('node', nid);
  return { trashed: ids };
}

export function restoreFromTrash(ctx: Ctx, meta: WriteMeta, id: string): NodeRow {
  const node = requireNode(ctx, id, true);
  if (!node.deleted_at) return node;
  const batch = ctx.db
    .all<{ id: string }>(
      `WITH RECURSIVE down(id) AS (SELECT id FROM nodes WHERE id = ?
        UNION ALL SELECT n.id FROM nodes n JOIN down ON n.parent_id = down.id WHERE n.deleted_at = ?)
       SELECT id FROM down`,
      [id, node.deleted_at],
    )
    .map((r) => r.id);
  const parentGone = node.parent_id ? !getNode(ctx, node.parent_id) : false;
  const now = nowIso();
  ctx.db.write(() => {
    for (const nid of batch) {
      ctx.db.run('UPDATE nodes SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ?', [now, nid]);
    }
    if (parentGone) {
      ctx.db.run(`UPDATE nodes SET parent_id = NULL, kind = CASE WHEN kind = 'subproject' THEN 'project' ELSE kind END, review_state = 'unassigned' WHERE id = ?`, [id]);
    }
    for (const nid of batch) {
      const row = getNode(ctx, nid)!;
      recordVersion(ctx, meta, 'node', nid, row.version, 'restore', row);
    }
    logActivity(ctx, meta, {
      action: 'node.restored',
      summary: `„${node.name}“ aus dem Papierkorb wiederhergestellt${batch.length > 1 ? ` (inkl. ${batch.length - 1} Unterobjekte)` : ''}${parentGone ? ' – Elternobjekt fehlt, daher auf oberster Ebene' : ''}`,
      entityType: 'node', entityId: id, entityName: node.name,
    });
  });
  for (const nid of batch) ctx.hooks.onChange?.('node', nid);
  return getNode(ctx, id)!;
}

/** Permanent deletion – only for items already in the trash. Repository data is untouched. */
export function purgeNode(ctx: Ctx, meta: WriteMeta, id: string): number {
  const node = requireNode(ctx, id, true);
  if (!node.deleted_at) throw badRequest('Nur Einträge im Papierkorb können endgültig gelöscht werden.');
  const all = [id, ...descendantIds(ctx, id, { includeDeleted: true })];
  const live = all.filter((nid) => getNode(ctx, nid));
  if (live.length) throw conflict('Unterobjekte sind nicht im Papierkorb. Bitte zuerst verschieben oder ebenfalls löschen.');
  ctx.db.write(() => {
    for (const nid of [...all].reverse()) {
      ctx.db.run('UPDATE ideas SET project_node_id = NULL WHERE project_node_id = ?', [nid]);
      ctx.db.run('UPDATE applications SET node_id = NULL WHERE node_id = ?', [nid]);
      ctx.db.run(`DELETE FROM external_identities WHERE entity_type = 'node' AND entity_id = ?`, [nid]);
      ctx.db.run(`DELETE FROM entity_tags WHERE entity_type = 'node' AND entity_id = ?`, [nid]);
      ctx.db.run(`DELETE FROM attachments WHERE entity_type = 'node' AND entity_id = ?`, [nid]);
      ctx.db.run('DELETE FROM nodes WHERE id = ?', [nid]);
    }
    logActivity(ctx, meta, {
      action: 'node.purged', summary: `„${node.name}“ endgültig gelöscht (${all.length} Objekte; Versionshistorie bleibt erhalten)`,
      entityType: 'node', entityId: id, entityName: node.name,
    });
  });
  for (const nid of all) ctx.hooks.onChange?.('node', nid);
  return all.length;
}

export function restoreVersion(ctx: Ctx, meta: WriteMeta, id: string, version: number): NodeRow {
  const snap = ctx.db.get<{ snapshot: string }>(
    `SELECT snapshot FROM entity_versions WHERE entity_type = 'node' AND entity_id = ? AND version = ? ORDER BY id DESC LIMIT 1`,
    [id, version],
  );
  if (!snap) throw notFound('Version');
  const s = parseJson<NodeRow>(snap.snapshot, {} as NodeRow);
  const current = requireNode(ctx, id);
  const restored = updateNode(
    ctx, meta, id,
    {
      name: s.name, summary: s.summary, description: s.description, body: s.body, icon: s.icon, color: s.color, url: s.url,
      categoryId: s.category_id && ctx.db.get('SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL', [s.category_id]) ? s.category_id : null,
      lifecycleStatus: s.lifecycle_status as never, priority: s.priority, progress: s.progress, nature: s.nature as never,
      codePath: s.code_path, notes: s.notes, favorite: Boolean(s.favorite), claudeProjectUrl: s.claude_project_url,
    },
    { summary: `„${current.name}“ auf Version ${version} zurückgesetzt`, action: 'node.version_restored' },
  );
  if (s.parent_id !== current.parent_id && (s.parent_id === null || getNode(ctx, s.parent_id))) {
    try { moveNode(ctx, meta, id, s.parent_id); } catch { /* keep current position if impossible (e.g. cycle) */ }
  }
  return restored;
}

// ── Listing ────────────────────────────────────────────────────────────────
export const nodeListSchema = z.object({
  kinds: z.string().optional(),
  parent: z.string().optional(),
  q: z.string().max(200).optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  favorite: z.enum(['1', '0']).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  review: z.string().optional(),
  sort: z.enum(['activity', 'name', 'priority', 'created', 'progress']).default('activity'),
  limit: z.coerce.number().int().min(1).max(500).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NodeListQuery = z.infer<typeof nodeListSchema>;

export function listNodes(ctx: Ctx, f: NodeListQuery) {
  const where = ['n.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (f.kinds) {
    const kinds = f.kinds.split(',').filter((k) => (NODE_KINDS as readonly string[]).includes(k));
    if (kinds.length) { where.push(`n.kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
  }
  if (f.parent === 'root') where.push('n.parent_id IS NULL');
  else if (f.parent) { where.push('n.parent_id = ?'); params.push(f.parent); }
  if (f.q) {
    where.push('(n.name LIKE ? OR n.summary LIKE ? OR n.description LIKE ?)');
    const like = `%${f.q}%`;
    params.push(like, like, like);
  }
  if (f.status) {
    const st = f.status.split(',');
    where.push(`n.lifecycle_status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (f.category) { where.push('n.category_id = ?'); params.push(f.category); }
  if (f.favorite === '1') where.push('n.favorite = 1');
  if (f.archived === 'exclude') where.push('n.archived_at IS NULL');
  if (f.archived === 'only') where.push('n.archived_at IS NOT NULL');
  if (f.review) { where.push('n.review_state = ?'); params.push(f.review); }
  const order = {
    activity: 'n.last_activity_at DESC',
    name: 'n.name COLLATE NOCASE ASC',
    priority: 'n.priority ASC, n.last_activity_at DESC',
    created: 'n.created_at DESC',
    progress: 'COALESCE(n.progress, -1) DESC',
  }[f.sort];
  const whereSql = where.join(' AND ');
  const total = ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM nodes n WHERE ${whereSql}`, params)!.c;
  const rows = ctx.db.all<NodeRow & { child_count: number; repo_count: number; app_count: number; category_name: string | null; category_color: string | null; category_icon: string | null; open_conflicts: number }>(
    `SELECT n.*,
      (SELECT COUNT(*) FROM nodes c WHERE c.parent_id = n.id AND c.deleted_at IS NULL) child_count,
      (SELECT COUNT(*) FROM project_repository_links l WHERE l.node_id = n.id AND l.status = 'confirmed') repo_count,
      (SELECT COUNT(*) FROM applications a WHERE a.node_id = n.id AND a.deleted_at IS NULL) app_count,
      (SELECT COUNT(*) FROM conflicts k WHERE k.subject_type = 'node' AND k.subject_id = n.id AND k.status = 'open') open_conflicts,
      c.name category_name, c.color category_color, c.icon category_icon
     FROM nodes n LEFT JOIN categories c ON c.id = n.category_id
     WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, f.limit, f.offset],
  );
  const tags = getTagsBulk(ctx, 'node', rows.map((r) => r.id));
  return {
    total,
    items: rows.map((r) => ({
      ...serializeNode(r),
      body: undefined,
      childCount: r.child_count,
      repoCount: r.repo_count,
      appCount: r.app_count,
      openConflicts: r.open_conflicts,
      category: r.category_id ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon } : null,
      tags: tags.get(r.id) ?? [],
    })),
  };
}

export function childrenOf(ctx: Ctx, parentId: string | null, includeArchived = true) {
  const rows = ctx.db.all<NodeRow & { child_count: number }>(
    `SELECT n.*, (SELECT COUNT(*) FROM nodes c WHERE c.parent_id = n.id AND c.deleted_at IS NULL) child_count
     FROM nodes n WHERE n.parent_id IS ? AND n.deleted_at IS NULL ${includeArchived ? '' : 'AND n.archived_at IS NULL'}
     ORDER BY n.sort_order, n.name COLLATE NOCASE LIMIT 2000`,
    [parentId],
  );
  return rows.map((r) => ({ ...serializeNode(r), body: undefined, description: undefined, notes: undefined, childCount: r.child_count, codeStatus: codeStatus(ctx, r) }));
}

export function nodeDetail(ctx: Ctx, id: string) {
  const n = requireNode(ctx, id);
  const identities = ctx.db.all(`SELECT source, external_id, confirmed, first_seen_at, last_seen_at FROM external_identities WHERE entity_type = 'node' AND entity_id = ?`, [id]);
  const repoLinks = ctx.db.all(
    `SELECT l.id, l.status, l.score, l.reason, l.created_by, l.created_at, l.decided_at,
            r.id repo_id, r.full_name, r.html_url, r.status repo_status, r.primary_language, r.last_synced_at, r.pushed_at, r.default_branch, r.private
     FROM project_repository_links l JOIN repositories r ON r.id = l.repository_id
     WHERE l.node_id = ? AND l.status <> 'rejected' ORDER BY l.status, l.created_at`,
    [id],
  );
  const apps = ctx.db.all('SELECT id, name, kind, availability, launch_url, icon, color FROM applications WHERE node_id = ? AND deleted_at IS NULL', [id]);
  const category = n.category_id ? ctx.db.get('SELECT id, name, color, icon, slug FROM categories WHERE id = ?', [n.category_id]) : null;
  const sourceIdea = ctx.db.get('SELECT id, title FROM ideas WHERE project_node_id = ? AND deleted_at IS NULL', [id]);
  const openConflicts = ctx.db.all(`SELECT id, type, title, severity, created_at FROM conflicts WHERE subject_type = 'node' AND subject_id = ? AND status = 'open'`, [id]);
  const counts = ctx.db.get<{ descendants: number }>(
    `WITH RECURSIVE down(id) AS (SELECT id FROM nodes WHERE id = ? UNION ALL SELECT c.id FROM nodes c JOIN down ON c.parent_id = down.id WHERE c.deleted_at IS NULL)
     SELECT COUNT(*) - 1 descendants FROM down`,
    [id],
  )!;
  const attachments = ctx.db.all('SELECT id, kind, filename, mime, size, created_at FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['node', id]);
  return {
    node: serializeNode(n),
    ancestors: ancestors(ctx, id),
    children: childrenOf(ctx, id),
    descendants: counts.descendants,
    identities,
    repoLinks,
    apps,
    category,
    tags: getTags(ctx, 'node', id),
    sourceIdea: sourceIdea ?? null,
    openConflicts,
    codeStatus: codeStatus(ctx, n),
    attachments,
  };
}

export function listTrash(ctx: Ctx) {
  const nodes = ctx.db.all<{ id: string; name: string; kind: string; deleted_at: string; parent_id: string | null }>(
    `SELECT n.id, n.name, n.kind, n.deleted_at, n.parent_id FROM nodes n
     WHERE n.deleted_at IS NOT NULL AND (n.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM nodes p WHERE p.id = n.parent_id AND p.deleted_at = n.deleted_at))
     ORDER BY n.deleted_at DESC LIMIT 500`,
  );
  const ideas = ctx.db.all(`SELECT id, title name, 'idea' kind, deleted_at FROM ideas WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`);
  const apps = ctx.db.all(`SELECT id, name, 'application' kind, deleted_at FROM applications WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`);
  return { nodes, ideas, apps };
}
