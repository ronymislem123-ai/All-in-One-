import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { badRequest, conflict as conflictErr, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { logActivity } from './activity';
import { notify } from './notifications';
import { getNode, moveNode, requireNode, trashNode, updateNode, type FieldSources, type NodeRow, fieldLabel } from './nodes';
import { CONFLICT_RESOLUTIONS, CONFLICT_TYPE_LABELS, type ConflictType } from '@shared/domain';

export interface ConflictInput {
  type: ConflictType;
  severity?: 'info' | 'warning' | 'critical';
  source: string;
  subjectType: 'node' | 'idea' | 'repository';
  subjectId: string;
  title: string;
  description?: string;
  details?: Record<string, unknown>;
  candidates?: { id: string; name: string; score?: number; reason?: string }[];
  waitKey?: string;
  syncEventId?: string;
}

export interface ConflictRow {
  id: string; type: ConflictType; status: string; severity: string; source: string; subject_type: string; subject_id: string;
  title: string; description: string | null; details: string; candidates: string; wait_key: string | null; resolution: string | null;
  resolution_note: string | null; resolved_at: string | null; resolved_by: string | null; sync_event_id: string | null;
  created_at: string; updated_at: string;
}

/** Records a conflict. Both data states are kept; nothing is overwritten silently (§11.2). */
export function createConflict(ctx: Ctx, c: ConflictInput): string {
  // de-duplicate: same open conflict for same subject/type/key → refresh instead of piling up
  const existing = ctx.db.get<{ id: string }>(
    `SELECT id FROM conflicts WHERE status = 'open' AND type = ? AND subject_type = ? AND subject_id = ? AND COALESCE(json_extract(details, '$.field'), '') = ?`,
    [c.type, c.subjectType, c.subjectId, String((c.details as { field?: string } | undefined)?.field ?? '')],
  );
  const now = nowIso();
  if (existing) {
    ctx.db.run('UPDATE conflicts SET details = ?, candidates = ?, description = ?, updated_at = ?, sync_event_id = COALESCE(?, sync_event_id) WHERE id = ?', [
      JSON.stringify(c.details ?? {}), JSON.stringify(c.candidates ?? []), c.description ?? null, now, c.syncEventId ?? null, existing.id,
    ]);
    return existing.id;
  }
  const id = newId('cfl');
  ctx.db.run(
    `INSERT INTO conflicts(id, type, status, severity, source, subject_type, subject_id, title, description, details, candidates, wait_key, sync_event_id, created_at, updated_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, c.type, c.severity ?? 'warning', c.source, c.subjectType, c.subjectId, c.title, c.description ?? null,
      JSON.stringify(c.details ?? {}), JSON.stringify(c.candidates ?? []), c.waitKey ?? null, c.syncEventId ?? null, now, now,
    ],
  );
  notify(ctx, { level: 'warning', title: `Konflikt: ${CONFLICT_TYPE_LABELS[c.type]}`, body: c.title, link: `/conflicts/${id}`, dedupeKey: `conflict:${id}` });
  return id;
}

export function serializeConflict(ctx: Ctx, r: ConflictRow) {
  let subject: Record<string, unknown> | null = null;
  if (r.subject_type === 'node') {
    const n = getNode(ctx, r.subject_id, true);
    subject = n ? { id: n.id, name: n.name, kind: n.kind, deleted: Boolean(n.deleted_at), parentId: n.parent_id } : null;
  } else if (r.subject_type === 'repository') {
    const repo = ctx.db.get<{ id: string; full_name: string; status: string }>('SELECT id, full_name, status FROM repositories WHERE id = ?', [r.subject_id]);
    subject = repo ? { id: repo.id, name: repo.full_name, status: repo.status } : null;
  } else if (r.subject_type === 'idea') {
    const i = ctx.db.get<{ id: string; title: string }>('SELECT id, title FROM ideas WHERE id = ?', [r.subject_id]);
    subject = i ? { id: i.id, name: i.title } : null;
  }
  return {
    id: r.id, type: r.type, typeLabel: CONFLICT_TYPE_LABELS[r.type], status: r.status, severity: r.severity, source: r.source,
    subjectType: r.subject_type, subjectId: r.subject_id, subject, title: r.title, description: r.description,
    details: parseJson<Record<string, unknown>>(r.details, {}),
    candidates: parseJson<{ id: string; name: string; score?: number; reason?: string }[]>(r.candidates, []),
    resolution: r.resolution, resolutionNote: r.resolution_note, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
    syncEventId: r.sync_event_id, createdAt: r.created_at, updatedAt: r.updated_at,
    options: CONFLICT_RESOLUTIONS[r.type] ?? [],
  };
}

export function listConflicts(ctx: Ctx, f: { status?: string; type?: string; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status && f.status !== 'all') { where.push('status = ?'); params.push(f.status); }
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  const rows = ctx.db.all<ConflictRow>(
    `SELECT * FROM conflicts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status = 'open' DESC, created_at DESC LIMIT ?`,
    [...params, Math.min(f.limit ?? 100, 500)],
  );
  return rows.map((r) => serializeConflict(ctx, r));
}

export function getConflict(ctx: Ctx, id: string) {
  const r = ctx.db.get<ConflictRow>('SELECT * FROM conflicts WHERE id = ?', [id]);
  if (!r) throw notFound('Konflikt');
  return serializeConflict(ctx, r);
}

function close(ctx: Ctx, meta: WriteMeta, r: ConflictRow, resolution: string, note: string | undefined, status: 'resolved' | 'dismissed' = 'resolved') {
  ctx.db.run('UPDATE conflicts SET status = ?, resolution = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?', [
    status, resolution, note ?? null, nowIso(), meta.actor, nowIso(), r.id,
  ]);
  const option = CONFLICT_RESOLUTIONS[r.type]?.find((o) => o.id === resolution);
  logActivity(ctx, meta, {
    action: 'conflict.resolved',
    summary: `Konflikt „${r.title}“ ${status === 'dismissed' ? 'verworfen' : `gelöst: ${option?.label ?? resolution}`}${note ? ` – ${note}` : ''}`,
    entityType: r.subject_type, entityId: r.subject_id, data: { conflictId: r.id, resolution },
  });
  ctx.db.run(`UPDATE notifications SET read_at = ? WHERE dedupe_key = ? AND read_at IS NULL`, [nowIso(), `conflict:${r.id}`]);
}

export const resolveSchema = z.object({
  resolution: z.string(),
  targetId: z.string().optional(),
  note: z.string().max(2000).optional(),
});

/** Copies Claude-provided content from a provisional node into an existing one without touching website-owned data. */
function mergeClaudeContent(ctx: Ctx, meta: WriteMeta, from: NodeRow, into: NodeRow) {
  const sources = parseJson<FieldSources>(into.field_sources, {});
  const patch: Record<string, unknown> = {};
  const maybe = (col: keyof NodeRow, key: string) => {
    const v = from[col];
    if (v === null || v === undefined) return;
    if (into[col] === null || into[col] === undefined || sources[col as string]?.src === 'claude') patch[key] = v;
  };
  maybe('summary', 'summary');
  maybe('description', 'description');
  maybe('progress', 'progress');
  if (sources.lifecycle_status?.src !== 'website') patch.lifecycleStatus = from.lifecycle_status;
  if (Object.keys(patch).length) updateNode(ctx, { ...meta, actor: 'claude' }, into.id, patch as never, { summary: `Claude-Inhalte aus Duplikat übernommen in „${into.name}“` });
}

export function resolveConflict(ctx: Ctx, meta: WriteMeta, id: string, raw: z.input<typeof resolveSchema>) {
  const p = resolveSchema.parse(raw);
  const r = ctx.db.get<ConflictRow>('SELECT * FROM conflicts WHERE id = ?', [id]);
  if (!r) throw notFound('Konflikt');
  if (r.status !== 'open') throw conflictErr('Dieser Konflikt ist bereits abgeschlossen.');
  const options = CONFLICT_RESOLUTIONS[r.type]?.map((o) => o.id) ?? [];
  if (p.resolution !== 'dismiss' && !options.includes(p.resolution)) throw badRequest('Unbekannte Entscheidung für diesen Konflikttyp.');
  const details = parseJson<Record<string, unknown>>(r.details, {});

  ctx.db.write(() => {
    if (p.resolution === 'dismiss') return close(ctx, meta, r, 'dismiss', p.note, 'dismissed');
    switch (r.type) {
      case 'possible_duplicate': {
        const subject = requireNode(ctx, r.subject_id, true);
        if (p.resolution === 'use_existing') {
          if (!p.targetId) throw badRequest('Bitte das bestehende Objekt wählen.');
          const target = requireNode(ctx, p.targetId);
          if (target.id === subject.id) throw badRequest('Ziel und Duplikat sind identisch.');
          // transfer identities, move children, merge Claude content, then trash the provisional node
          ctx.db.run(`UPDATE external_identities SET entity_id = ? WHERE entity_type = 'node' AND entity_id = ?`, [target.id, subject.id]);
          for (const child of ctx.db.all<{ id: string }>('SELECT id FROM nodes WHERE parent_id = ? AND deleted_at IS NULL', [subject.id])) {
            moveNode(ctx, meta, child.id, target.id);
          }
          mergeClaudeContent(ctx, meta, subject, target);
          if (!subject.deleted_at) trashNode(ctx, meta, subject.id, true);
        } else if (p.resolution === 'as_submodule') {
          if (!p.targetId) throw badRequest('Bitte das übergeordnete Objekt wählen.');
          moveNode(ctx, meta, subject.id, p.targetId);
          updateNode(ctx, meta, subject.id, { reviewState: 'ok' });
        } else if (p.resolution === 'create_new') {
          updateNode(ctx, meta, subject.id, { reviewState: 'ok' });
        } else if (p.resolution === 'mark_duplicate') {
          updateNode(ctx, meta, subject.id, { reviewState: 'possible_duplicate' });
        } else if (p.resolution === 'keep_separate') {
          updateNode(ctx, meta, subject.id, { reviewState: 'needs_review' });
        }
        break;
      }
      case 'unresolved_parent': {
        const subject = requireNode(ctx, r.subject_id);
        if (p.resolution === 'assign_parent') {
          if (!p.targetId) throw badRequest('Bitte ein Elternobjekt wählen.');
          moveNode(ctx, meta, subject.id, p.targetId);
        }
        updateNode(ctx, meta, subject.id, { reviewState: 'ok' });
        break;
      }
      case 'field_conflict': {
        const subject = requireNode(ctx, r.subject_id);
        const field = String(details.field);
        if (p.resolution === 'accept_claude') {
          if (field === 'parent') {
            const parentId = (details.claudeParentId as string | null) ?? null;
            if (parentId && !getNode(ctx, parentId)) throw badRequest('Das von Claude genannte Elternobjekt existiert nicht mehr.');
            moveNode(ctx, { ...meta, actor: 'claude' }, subject.id, parentId);
          } else {
            const map: Record<string, string> = { name: 'name', summary: 'summary', description: 'description', lifecycle_status: 'lifecycleStatus', progress: 'progress', code_path: 'codePath' };
            updateNode(ctx, { ...meta, actor: 'claude' }, subject.id, { [map[field] ?? field]: details.claudeValue } as never, {
              summary: `Claude-Stand für ${fieldLabel(field)} von „${subject.name}“ übernommen`,
            });
          }
        } else {
          const sources = parseJson<FieldSources>(subject.field_sources, {});
          sources[field] = { ...(sources[field] ?? { src: 'website', at: nowIso() }), rejected: String(details.claudeHash ?? '') };
          ctx.db.run('UPDATE nodes SET field_sources = ? WHERE id = ?', [JSON.stringify(sources), subject.id]);
        }
        break;
      }
      case 'repo_ambiguous': {
        if (p.resolution === 'link_candidate') {
          if (!p.targetId) throw badRequest('Bitte das Projekt wählen.');
          confirmLinkInternal(ctx, meta, p.targetId, r.subject_id, 'Konfliktentscheidung');
        } else {
          ctx.db.run(`UPDATE project_repository_links SET status = 'rejected', decided_at = ? WHERE repository_id = ? AND status = 'suggested'`, [nowIso(), r.subject_id]);
        }
        break;
      }
      case 'repo_unreachable': {
        if (p.resolution === 'unlink') {
          ctx.db.run(`DELETE FROM project_repository_links WHERE repository_id = ? AND status = 'confirmed'`, [r.subject_id]);
        }
        break;
      }
    }
    close(ctx, meta, r, p.resolution, p.note);
  });
  if (r.subject_type === 'node') ctx.hooks.onChange?.('node', r.subject_id);
  return getConflict(ctx, id);
}

/** Confirms a project ↔ repository link by stable IDs (shared by conflicts and the GitHub module). */
export function confirmLinkInternal(ctx: Ctx, meta: WriteMeta, nodeId: string, repositoryId: string, reason: string) {
  const node = requireNode(ctx, nodeId);
  const repo = ctx.db.get<{ id: string; full_name: string }>('SELECT id, full_name FROM repositories WHERE id = ?', [repositoryId]);
  if (!repo) throw notFound('Repository');
  const now = nowIso();
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM project_repository_links WHERE node_id = ? AND repository_id = ?', [nodeId, repositoryId]);
  if (existing) {
    ctx.db.run(`UPDATE project_repository_links SET status = 'confirmed', decided_at = ?, reason = ? WHERE id = ?`, [now, reason, existing.id]);
  } else {
    ctx.db.run(
      `INSERT INTO project_repository_links(id, node_id, repository_id, status, score, reason, created_by, created_at, decided_at)
       VALUES (?, ?, ?, 'confirmed', NULL, ?, ?, ?, ?)`,
      [newId('lnk'), nodeId, repositoryId, reason, meta.actor, now, now],
    );
  }
  // other suggestions for this repo are now obsolete
  ctx.db.run(`UPDATE project_repository_links SET status = 'rejected', decided_at = ? WHERE repository_id = ? AND status = 'suggested' AND node_id <> ?`, [now, repositoryId, nodeId]);
  logActivity(ctx, meta, {
    action: 'repo.linked', summary: `Repository ${repo.full_name} mit „${node.name}“ verknüpft (bestätigt)`,
    entityType: 'node', entityId: nodeId, entityName: node.name, data: { repositoryId, reason },
  });
}

/**
 * Called whenever a new external identity appears: conflicts that were waiting for exactly this
 * identity (unknown parent) are resolved deterministically – this is identity matching, not name guessing.
 */
export function resolveWaiting(ctx: Ctx, waitKey: string, parentNodeId: string): number {
  const waiting = ctx.db.all<ConflictRow>(`SELECT * FROM conflicts WHERE status = 'open' AND wait_key = ?`, [waitKey]);
  for (const w of waiting) {
    const node = getNode(ctx, w.subject_id);
    if (node && node.parent_id === null) {
      moveNode(ctx, { actor: 'system' }, node.id, parentNodeId);
      ctx.db.run(`UPDATE nodes SET review_state = 'ok' WHERE id = ?`, [node.id]);
    }
    close(ctx, { actor: 'system' }, w, 'auto_parent_arrived', 'Elternobjekt wurde übermittelt – automatisch über die externe ID zugeordnet.');
  }
  return waiting.length;
}
