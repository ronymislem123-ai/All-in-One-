/**
 * Werkstatt – live development sessions (omega.live/v1).
 *
 * Claude streams research, plans, decisions, code, tests, problems, milestones, tasks, screenshots and
 * the preview address while it builds something. OMEGA stores and displays the stream; it never derives
 * project data from it (ADR-014). Writes are idempotent through (session, eventId).
 */
import type { Ctx, WriteMeta } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { logActivity } from './activity';
import { notify } from './notifications';
import {
  LIVE_IMAGE_MAX_BYTES, LIVE_STATE_LABELS, liveEventData, liveSessionUpsertData,
  type LiveEventInput, type LiveEventKind, type LiveEventResult, type LiveSessionUpsertInput, type LiveState,
} from '@shared/devlive';

const CLAUDE: WriteMeta = { actor: 'claude' };

// ── Rows & DTOs ────────────────────────────────────────────────────────────
interface SessionRow {
  id: string; external_id: string; title: string; goal: string | null; state: LiveState; phase: string | null; progress: number | null;
  now_text: string | null; preview_url: string | null; preview_note: string | null; project_id: string | null; source: string;
  started_at: string; updated_at: string; last_event_at: string | null; ended_at: string | null;
}
interface MilestoneRow { session_id: string; key: string; label: string; sort_order: number; progress: number; status: 'pending' | 'active' | 'done'; updated_at: string }
interface TaskRow { session_id: string; key: string; title: string; detail: string | null; sort_order: number; status: 'todo' | 'doing' | 'done' | 'blocked'; updated_at: string }
interface MediaRow { id: string; session_id: string; mime: string; size: number; sha256: string; width: number | null; height: number | null; created_at: string }
interface EventRow { id: number; session_id: string; event_id: string | null; at: string; kind: LiveEventKind; title: string; body: string | null; data: string | null; media_id: string | null; created_at: string }

export interface LiveSessionDto {
  id: string; externalId: string; title: string; goal: string | null; state: LiveState; stateLabel: string; phase: string | null;
  /** Explicit progress or the milestone average. */
  progress: number; progressExplicit: boolean; now: string | null; previewUrl: string | null; previewNote: string | null;
  projectId: string | null; projectName: string | null; source: string; startedAt: string; updatedAt: string; lastEventAt: string | null; endedAt: string | null;
  counts: { events: number; media: number; tasksDone: number; tasksTotal: number };
}
export interface LiveMilestoneDto { key: string; label: string; order: number; progress: number; status: MilestoneRow['status']; updatedAt: string }
export interface LiveTaskDto { key: string; title: string; detail: string | null; order: number; status: TaskRow['status']; updatedAt: string }
export interface LiveMediaDto { id: string; mime: string; size: number; width: number | null; height: number | null; createdAt: string; title: string | null; caption: string | null; eventId: number | null }
export interface LiveEventDto { id: number; eventId: string | null; at: string; kind: LiveEventKind; title: string; body: string | null; data: Record<string, unknown> | null; mediaId: string | null }

// ── In-process change feed (SSE) ───────────────────────────────────────────
type Listener = (msg: { type: 'event' | 'session' | 'deleted'; sessionId: string; eventId?: number }) => void;
const listeners = new Map<string, Set<Listener>>();
export function subscribeLive(sessionId: string, fn: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) { set = new Set(); listeners.set(sessionId, set); }
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) listeners.delete(sessionId); };
}
function emit(sessionId: string, msg: Parameters<Listener>[0]) {
  listeners.get(sessionId)?.forEach((fn) => { try { fn(msg); } catch { /* listener errors never affect writes */ } });
}
/** Number of open live subscriptions (for status display / tests). */
export const liveListenerCount = (sessionId: string) => listeners.get(sessionId)?.size ?? 0;

// ── Lookup ─────────────────────────────────────────────────────────────────
function sessionRow(ctx: Ctx, idOrExternal: string): SessionRow | undefined {
  return ctx.db.get<SessionRow>('SELECT * FROM dev_sessions WHERE id = ? OR external_id = ?', [idOrExternal, idOrExternal]);
}
export function requireLiveSession(ctx: Ctx, idOrExternal: string): SessionRow {
  const row = sessionRow(ctx, idOrExternal);
  if (!row) throw notFound('Live-Sitzung');
  return row;
}

const milestoneAverage = (ctx: Ctx, sessionId: string): number | null =>
  ctx.db.get<{ avg: number | null }>('SELECT AVG(progress) avg FROM dev_milestones WHERE session_id = ?', [sessionId])?.avg ?? null;

function serializeSession(ctx: Ctx, r: SessionRow): LiveSessionDto {
  const avg = r.progress == null ? milestoneAverage(ctx, r.id) : null;
  const counts = ctx.db.get<{ events: number; media: number; done: number; total: number }>(
    `SELECT (SELECT COUNT(*) FROM dev_events WHERE session_id = s.id) events,
            (SELECT COUNT(*) FROM dev_media WHERE session_id = s.id) media,
            (SELECT COUNT(*) FROM dev_tasks WHERE session_id = s.id AND status = 'done') done,
            (SELECT COUNT(*) FROM dev_tasks WHERE session_id = s.id) total
     FROM dev_sessions s WHERE s.id = ?`, [r.id])!;
  const projectName = r.project_id ? ctx.db.get<{ name: string }>('SELECT name FROM nodes WHERE id = ?', [r.project_id])?.name ?? null : null;
  return {
    id: r.id, externalId: r.external_id, title: r.title, goal: r.goal, state: r.state, stateLabel: LIVE_STATE_LABELS[r.state], phase: r.phase,
    progress: Math.round(r.progress ?? avg ?? 0), progressExplicit: r.progress != null, now: r.now_text, previewUrl: r.preview_url, previewNote: r.preview_note,
    projectId: r.project_id, projectName, source: r.source, startedAt: r.started_at, updatedAt: r.updated_at, lastEventAt: r.last_event_at, endedAt: r.ended_at,
    counts: { events: counts.events, media: counts.media, tasksDone: counts.done, tasksTotal: counts.total },
  };
}

export function listLiveSessions(ctx: Ctx, limit = 50): LiveSessionDto[] {
  return ctx.db.all<SessionRow>('SELECT * FROM dev_sessions ORDER BY updated_at DESC LIMIT ?', [Math.min(Math.max(limit, 1), 200)]).map((r) => serializeSession(ctx, r));
}

export function getLiveSession(ctx: Ctx, idOrExternal: string) {
  const r = requireLiveSession(ctx, idOrExternal);
  const milestones = ctx.db.all<MilestoneRow>('SELECT * FROM dev_milestones WHERE session_id = ? ORDER BY sort_order, key', [r.id])
    .map<LiveMilestoneDto>((m) => ({ key: m.key, label: m.label, order: m.sort_order, progress: Math.round(m.progress), status: m.status, updatedAt: m.updated_at }));
  const tasks = ctx.db.all<TaskRow>('SELECT * FROM dev_tasks WHERE session_id = ? ORDER BY sort_order, key', [r.id])
    .map<LiveTaskDto>((t) => ({ key: t.key, title: t.title, detail: t.detail, order: t.sort_order, status: t.status, updatedAt: t.updated_at }));
  const media = ctx.db.all<MediaRow & { title: string | null; caption: string | null; event_row: number | null }>(
    `SELECT m.id, m.session_id, m.mime, m.size, m.sha256, m.width, m.height, m.created_at,
            e.title title, json_extract(e.data, '$.caption') caption, e.id event_row
     FROM dev_media m
     LEFT JOIN dev_events e ON e.id = (SELECT MIN(x.id) FROM dev_events x WHERE x.media_id = m.id)
     WHERE m.session_id = ? ORDER BY m.created_at, m.id`, [r.id])
    .map<LiveMediaDto>((m) => ({ id: m.id, mime: m.mime, size: m.size, width: m.width, height: m.height, createdAt: m.created_at, title: m.title, caption: m.caption, eventId: m.event_row }));
  return { session: serializeSession(ctx, r), milestones, tasks, media };
}

export function listLiveEvents(ctx: Ctx, idOrExternal: string, f: { after?: number; before?: number; kind?: string; limit?: number }) {
  const r = requireLiveSession(ctx, idOrExternal);
  const where = ['session_id = ?'];
  const params: unknown[] = [r.id];
  if (f.after) { where.push('id > ?'); params.push(f.after); }
  if (f.before) { where.push('id < ?'); params.push(f.before); }
  if (f.kind) { where.push('kind = ?'); params.push(f.kind); }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  // newest first unless the client follows the stream forward (after=)
  const order = f.after ? 'ASC' : 'DESC';
  const rows = ctx.db.all<EventRow>(`SELECT * FROM dev_events WHERE ${where.join(' AND ')} ORDER BY id ${order} LIMIT ${limit + 1}`, params);
  const items = rows.slice(0, limit).map(serializeEvent);
  const nextCursor = rows.length > limit ? items[items.length - 1].id : null;
  return { items, nextCursor, latestId: ctx.db.get<{ m: number | null }>('SELECT MAX(id) m FROM dev_events WHERE session_id = ?', [r.id])?.m ?? 0 };
}

function serializeEvent(e: EventRow): LiveEventDto {
  return { id: e.id, eventId: e.event_id, at: e.at, kind: e.kind, title: e.title, body: e.body, data: parseJson<Record<string, unknown> | null>(e.data, null), mediaId: e.media_id };
}

export function getLiveMedia(ctx: Ctx, id: string): { mime: string; size: number; data: Buffer; sha256: string } {
  const m = ctx.db.get<{ mime: string; size: number; data: Buffer; sha256: string }>('SELECT mime, size, data, sha256 FROM dev_media WHERE id = ?', [id]);
  if (!m) throw notFound('Bild');
  return m;
}

// ── Writes ─────────────────────────────────────────────────────────────────
function projectIdByExternal(ctx: Ctx, externalId: string | undefined): string | null {
  if (!externalId) return null;
  return ctx.db.get<{ entity_id: string }>(
    `SELECT x.entity_id FROM external_identities x JOIN nodes n ON n.id = x.entity_id
     WHERE x.source = 'claude' AND x.entity_type = 'node' AND x.external_id = ? AND n.deleted_at IS NULL`, [externalId])?.entity_id ?? null;
}

function upsertMilestone(ctx: Ctx, sessionId: string, m: { key: string; label?: string; order?: number; progress?: number; status?: MilestoneRow['status'] }, now: string) {
  const existing = ctx.db.get<MilestoneRow>('SELECT * FROM dev_milestones WHERE session_id = ? AND key = ?', [sessionId, m.key]);
  const label = m.label ?? existing?.label;
  if (!label) throw badRequest(`Meilenstein „${m.key}“ ist unbekannt – beim ersten Mal bitte ein label mitsenden.`);
  const progress = m.progress ?? existing?.progress ?? 0;
  const status = m.status ?? (m.progress != null ? (progress >= 100 ? 'done' : progress > 0 ? 'active' : existing?.status ?? 'pending') : existing?.status ?? 'pending');
  const order = m.order ?? existing?.sort_order ?? (ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM dev_milestones WHERE session_id = ?', [sessionId])?.n ?? 0);
  ctx.db.run(
    `INSERT INTO dev_milestones(session_id, key, label, sort_order, progress, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order, progress = excluded.progress, status = excluded.status, updated_at = excluded.updated_at`,
    [sessionId, m.key, label, order, status === 'done' && m.progress == null ? 100 : progress, status, now],
  );
}

function upsertTask(ctx: Ctx, sessionId: string, t: { key: string; title?: string; detail?: string; order?: number; status?: TaskRow['status'] }, now: string) {
  const existing = ctx.db.get<TaskRow>('SELECT * FROM dev_tasks WHERE session_id = ? AND key = ?', [sessionId, t.key]);
  const title = t.title ?? existing?.title;
  if (!title) throw badRequest(`Aufgabe „${t.key}“ ist unbekannt – beim ersten Mal bitte einen title mitsenden.`);
  const order = t.order ?? existing?.sort_order ?? (ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM dev_tasks WHERE session_id = ?', [sessionId])?.n ?? 0);
  ctx.db.run(
    `INSERT INTO dev_tasks(session_id, key, title, detail, sort_order, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET title = excluded.title, detail = excluded.detail, sort_order = excluded.sort_order, status = excluded.status, updated_at = excluded.updated_at`,
    [sessionId, t.key, title, t.detail ?? existing?.detail ?? null, order, t.status ?? existing?.status ?? 'todo', now],
  );
}

/** Creates or updates a live session (addressed by externalId). Milestones/tasks given here are merged, never removed. */
export function upsertLiveSession(ctx: Ctx, raw: unknown, opts: { client: string }): { session: LiveSessionDto; created: boolean } {
  const parsed = liveSessionUpsertData.safeParse(raw);
  if (!parsed.success) throw badRequest('Eingaben sind ungültig.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const input: LiveSessionUpsertInput = parsed.data;
  const now = nowIso();
  return ctx.db.write(() => {
    const existing = sessionRow(ctx, input.externalId);
    const projectId = projectIdByExternal(ctx, input.projectExternalId) ?? existing?.project_id ?? null;
    let id: string;
    if (existing) {
      id = existing.id;
      const state = input.state ?? existing.state;
      ctx.db.run(
        `UPDATE dev_sessions SET title = ?, goal = ?, state = ?, phase = ?, progress = ?, now_text = ?, preview_url = ?, preview_note = ?, project_id = ?, updated_at = ?, ended_at = ?
         WHERE id = ?`,
        [
          input.title, input.goal ?? existing.goal, state, input.phase ?? existing.phase,
          input.progress === undefined ? existing.progress : input.progress, input.now === undefined ? existing.now_text : input.now,
          input.previewUrl === undefined ? existing.preview_url : input.previewUrl, input.previewNote === undefined ? existing.preview_note : input.previewNote,
          projectId, now, state === 'done' ? existing.ended_at ?? now : null, id,
        ],
      );
    } else {
      id = newId('live');
      const state = input.state ?? 'planning';
      ctx.db.run(
        `INSERT INTO dev_sessions(id, external_id, title, goal, state, phase, progress, now_text, preview_url, preview_note, project_id, source, started_at, updated_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.externalId, input.title, input.goal ?? null, state, input.phase ?? null, input.progress ?? null, input.now ?? null, input.previewUrl ?? null, input.previewNote ?? null, projectId, opts.client, now, now, state === 'done' ? now : null],
      );
    }
    for (const m of input.milestones ?? []) upsertMilestone(ctx, id, m, now);
    for (const t of input.tasks ?? []) upsertTask(ctx, id, t, now);
    logActivity(ctx, CLAUDE, {
      action: existing ? 'live.session.update' : 'live.session.start', entityType: 'live_session', entityId: id, entityName: input.title, projectId,
      summary: existing ? `Live-Sitzung „${input.title}“ aktualisiert` : `Live-Sitzung „${input.title}“ gestartet (${opts.client})`,
    });
    if (!existing) notify(ctx, { level: 'info', title: 'Claude baut gerade live', body: input.title, link: `/live/${id}`, dedupeKey: `live:${id}` });
    const row = requireLiveSession(ctx, id);
    emit(id, { type: 'session', sessionId: id });
    return { session: serializeSession(ctx, row), created: !existing };
  });
}

function storeImage(ctx: Ctx, sessionId: string, image: NonNullable<LiveEventInput['image']>, now: string): string {
  const data = Buffer.from(image.base64.replace(/^data:[^,]+,/, ''), 'base64');
  if (!data.length) throw badRequest('Bild ist leer oder kein gültiges Base64.');
  if (data.length > LIVE_IMAGE_MAX_BYTES) throw badRequest(`Bild ist zu groß (max. ${Math.round(LIVE_IMAGE_MAX_BYTES / 1024 / 1024)} MB).`);
  const hash = sha256(data);
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM dev_media WHERE session_id = ? AND sha256 = ?', [sessionId, hash]);
  if (existing) return existing.id;
  const id = newId('lmed');
  ctx.db.run('INSERT INTO dev_media(id, session_id, mime, size, sha256, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    id, sessionId, image.mime, data.length, hash, image.width ?? null, image.height ?? null, data, now,
  ]);
  return id;
}

/** Appends events to a session. Each event is validated and applied independently; the response mirrors the ingest API. */
export function appendLiveEvents(ctx: Ctx, idOrExternal: string, rawEvents: unknown[]): { sessionId: string; results: LiveEventResult[]; summary: Record<LiveEventResult['status'], number> } {
  const session = requireLiveSession(ctx, idOrExternal);
  const results: LiveEventResult[] = [];
  const summary = { applied: 0, duplicate: 0, rejected: 0 };
  const applied: number[] = [];
  ctx.db.write(() => {
    rawEvents.forEach((raw, index) => {
      const parsed = liveEventData.safeParse(raw);
      const rawId = (raw as { eventId?: unknown } | null)?.eventId;
      if (!parsed.success) {
        results.push({ index, eventId: typeof rawId === 'string' ? rawId : null, status: 'rejected', message: 'Ereignis ist ungültig.', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
        summary.rejected++;
        return;
      }
      const e = parsed.data;
      if (e.eventId) {
        const dup = ctx.db.get<{ id: number }>('SELECT id FROM dev_events WHERE session_id = ? AND event_id = ?', [session.id, e.eventId]);
        if (dup) { results.push({ index, eventId: e.eventId, status: 'duplicate', message: 'Bereits vorhanden – nichts geändert.', id: dup.id }); summary.duplicate++; return; }
      }
      const now = nowIso();
      const at = e.at ? new Date(e.at).toISOString() : now;
      try {
        let mediaId: string | null = null;
        const data: Record<string, unknown> = {};
        if (e.kind === 'milestone' && e.milestone) { upsertMilestone(ctx, session.id, e.milestone, now); data.milestone = e.milestone; }
        if (e.kind === 'task' && e.task) { upsertTask(ctx, session.id, e.task, now); data.task = e.task; }
        if (e.kind === 'screenshot' && e.image) { mediaId = storeImage(ctx, session.id, e.image, now); data.caption = e.image.caption ?? null; data.width = e.image.width ?? null; data.height = e.image.height ?? null; }
        if (e.kind === 'preview' && e.preview) {
          ctx.db.run('UPDATE dev_sessions SET preview_url = ?, preview_note = COALESCE(?, preview_note) WHERE id = ?', [e.preview.url, e.preview.note ?? null, session.id]);
          data.preview = e.preview;
        }
        if (e.kind === 'status' && e.status) {
          const s = e.status;
          ctx.db.run(
            `UPDATE dev_sessions SET state = COALESCE(?, state), phase = COALESCE(?, phase), progress = CASE WHEN ? THEN ? ELSE progress END, now_text = CASE WHEN ? THEN ? ELSE now_text END,
             ended_at = CASE WHEN COALESCE(?, state) = 'done' THEN COALESCE(ended_at, ?) ELSE NULL END WHERE id = ?`,
            [s.state ?? null, s.phase ?? null, s.progress !== undefined ? 1 : 0, s.progress ?? null, s.now !== undefined ? 1 : 0, s.now ?? null, s.state ?? null, now, session.id],
          );
          data.status = s;
        }
        const res = ctx.db.run(
          'INSERT INTO dev_events(session_id, event_id, at, kind, title, body, data, media_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [session.id, e.eventId ?? null, at, e.kind, e.title, e.body ?? null, Object.keys(data).length ? JSON.stringify(data) : null, mediaId, now],
        );
        const id = Number(res.lastInsertRowid);
        applied.push(id);
        results.push({ index, eventId: e.eventId ?? null, status: 'applied', message: 'Übernommen.', id });
        summary.applied++;
      } catch (err) {
        results.push({ index, eventId: e.eventId ?? null, status: 'rejected', message: (err as Error).message });
        summary.rejected++;
      }
    });
    if (applied.length) {
      const now = nowIso();
      ctx.db.run(`UPDATE dev_sessions SET updated_at = ?, last_event_at = ?, state = CASE WHEN state = 'paused' THEN 'building' ELSE state END WHERE id = ?`, [now, now, session.id]);
      const problems = rawEvents.filter((r) => (r as { kind?: string } | null)?.kind === 'problem').length;
      if (problems) notify(ctx, { level: 'warning', title: `Problem in „${session.title}“`, body: 'Claude hat ein Problem gemeldet – Details in der Werkstatt.', link: `/live/${session.id}`, dedupeKey: `live:problem:${session.id}` });
    }
  });
  for (const id of applied) emit(session.id, { type: 'event', sessionId: session.id, eventId: id });
  return { sessionId: session.id, results, summary };
}

export function deleteLiveSession(ctx: Ctx, meta: WriteMeta, id: string): void {
  const s = requireLiveSession(ctx, id);
  ctx.db.write(() => {
    ctx.db.run('DELETE FROM dev_sessions WHERE id = ?', [s.id]);
    logActivity(ctx, meta, { action: 'live.session.delete', entityType: 'live_session', entityId: s.id, entityName: s.title, summary: `Live-Sitzung „${s.title}“ gelöscht` });
  });
  emit(s.id, { type: 'deleted', sessionId: s.id });
}

/** Owner marks a session as finished (e.g. when Claude's session ended without a final status). */
export function endLiveSession(ctx: Ctx, meta: WriteMeta, id: string): LiveSessionDto {
  const s = requireLiveSession(ctx, id);
  const now = nowIso();
  ctx.db.write(() => {
    ctx.db.run(`UPDATE dev_sessions SET state = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ?, now_text = NULL WHERE id = ?`, [now, now, s.id]);
    logActivity(ctx, meta, { action: 'live.session.end', entityType: 'live_session', entityId: s.id, entityName: s.title, summary: `Live-Sitzung „${s.title}“ als abgeschlossen markiert` });
  });
  emit(s.id, { type: 'session', sessionId: s.id });
  return serializeSession(ctx, requireLiveSession(ctx, s.id));
}
