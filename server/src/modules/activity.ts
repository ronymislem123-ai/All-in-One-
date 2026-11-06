import type { Ctx, WriteMeta } from '../context';
import { nowIso } from '../lib/time';
import { parseJson } from '../lib/json';

export interface ActivityInput {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  projectId?: string | null;
  data?: unknown;
}

export function logActivity(ctx: Ctx, meta: WriteMeta, input: ActivityInput): number {
  const res = ctx.db.run(
    `INSERT INTO activity(at, actor, action, entity_type, entity_id, entity_name, project_id, summary, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nowIso(),
      meta.actor,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.entityName ?? null,
      input.projectId ?? null,
      input.summary,
      input.data === undefined && !meta.eventId ? null : JSON.stringify({ ...(input.data as object), ...(meta.eventId ? { eventId: meta.eventId } : {}) }),
    ],
  );
  return Number(res.lastInsertRowid);
}

export function recordVersion(
  ctx: Ctx,
  meta: WriteMeta,
  entityType: string,
  entityId: string,
  version: number,
  changeKind: 'create' | 'update' | 'delete' | 'restore' | 'archive' | 'move',
  snapshot: unknown,
): void {
  ctx.db.run(
    `INSERT INTO entity_versions(entity_type, entity_id, version, change_kind, actor, snapshot, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entityType, entityId, version, changeKind, meta.actor, JSON.stringify(snapshot), nowIso()],
  );
}

export interface ActivityRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  project_id: string | null;
  summary: string;
  data: unknown;
}

export interface ActivityFilter {
  actor?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  q?: string;
  before?: number;
  limit?: number;
}

export function listActivity(ctx: Ctx, f: ActivityFilter): { items: ActivityRow[]; nextCursor: number | null } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.actor) { where.push('actor = ?'); params.push(f.actor); }
  if (f.entityType) { where.push('entity_type = ?'); params.push(f.entityType); }
  if (f.entityId) { where.push('entity_id = ?'); params.push(f.entityId); }
  if (f.projectId) { where.push('(project_id = ? OR entity_id = ?)'); params.push(f.projectId, f.projectId); }
  if (f.q) { where.push('(summary LIKE ? OR entity_name LIKE ? OR action LIKE ?)'); const like = `%${f.q}%`; params.push(like, like, like); }
  if (f.before) { where.push('id < ?'); params.push(f.before); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = ctx.db.all<ActivityRow & { data: string | null }>(
    `SELECT * FROM activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit + 1}`,
    params,
  );
  const items = rows.slice(0, limit).map((r) => ({ ...r, data: parseJson(r.data as string | null, null) }));
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

export function listVersions(ctx: Ctx, entityType: string, entityId: string) {
  return ctx.db
    .all<{ id: number; version: number; change_kind: string; actor: string; snapshot: string; at: string }>(
      'SELECT * FROM entity_versions WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 200',
      [entityType, entityId],
    )
    .map((v) => ({ ...v, snapshot: parseJson<Record<string, unknown>>(v.snapshot, {}) }));
}
