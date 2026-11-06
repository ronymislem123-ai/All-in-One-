import type { Ctx } from '../context';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { parseJson } from '../lib/json';

export function startRun(ctx: Ctx, source: string, trigger: string, label?: string): string {
  const id = newId('run');
  ctx.db.run(`INSERT INTO sync_runs(id, source, trigger, label, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')`, [id, source, trigger, label ?? null, nowIso()]);
  return id;
}

export function finishRun(ctx: Ctx, id: string, status: 'succeeded' | 'partial' | 'failed', stats: Record<string, unknown>, error?: string): void {
  ctx.db.run('UPDATE sync_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?', [nowIso(), status, JSON.stringify(stats), error ?? null, id]);
}

export function listRuns(ctx: Ctx, f: { source?: string; limit?: number }) {
  return ctx.db
    .all<Record<string, string>>(
      `SELECT * FROM sync_runs ${f.source ? 'WHERE source = ?' : ''} ORDER BY started_at DESC LIMIT ?`,
      f.source ? [f.source, f.limit ?? 50] : [f.limit ?? 50],
    )
    .map((r) => ({ ...r, stats: parseJson(r.stats, {}) }));
}

export function listEvents(ctx: Ctx, f: { status?: string; source?: string; q?: string; runId?: string; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.source) { where.push('source = ?'); params.push(f.source); }
  if (f.runId) { where.push('run_id = ?'); params.push(f.runId); }
  if (f.q) { where.push('(event_id LIKE ? OR type LIKE ? OR message LIKE ? OR payload LIKE ?)'); const l = `%${f.q}%`; params.push(l, l, l, l); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM sync_events ${w}`, params)!.c;
  const items = ctx.db
    .all<Record<string, string>>(`SELECT * FROM sync_events ${w} ORDER BY received_at DESC LIMIT ? OFFSET ?`, [...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0])
    .map((e) => ({ ...e, payload: parseJson(e.payload, null) }));
  return { total, items };
}
