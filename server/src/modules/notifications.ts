import type { Ctx } from '../context';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * Creates a notification. With a dedupeKey, an unread notification with the same key is refreshed
 * instead of duplicated (e.g. a repeatedly failing sync produces one entry, not hundreds).
 */
export function notify(
  ctx: Ctx,
  n: { level: NotificationLevel; title: string; body?: string; link?: string; dedupeKey?: string },
): string {
  if (n.dedupeKey) {
    const existing = ctx.db.get<{ id: string }>('SELECT id FROM notifications WHERE dedupe_key = ? AND read_at IS NULL', [n.dedupeKey]);
    if (existing) {
      ctx.db.run('UPDATE notifications SET level = ?, title = ?, body = ?, link = ?, created_at = ? WHERE id = ?', [
        n.level, n.title, n.body ?? null, n.link ?? null, nowIso(), existing.id,
      ]);
      return existing.id;
    }
  }
  const id = newId('ntf');
  ctx.db.run(
    'INSERT INTO notifications(id, level, title, body, link, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, n.level, n.title, n.body ?? null, n.link ?? null, n.dedupeKey ?? null, nowIso()],
  );
  // keep the table bounded
  ctx.db.run(`DELETE FROM notifications WHERE read_at IS NOT NULL AND id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 500)`);
  return id;
}

export function listNotifications(ctx: Ctx, limit = 50) {
  const items = ctx.db.all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?', [Math.min(limit, 200)]);
  const unread = ctx.db.get<{ c: number }>('SELECT COUNT(*) c FROM notifications WHERE read_at IS NULL')!.c;
  return { items, unread };
}

export function markRead(ctx: Ctx, id?: string): void {
  if (id) ctx.db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL', [nowIso(), id]);
  else ctx.db.run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', [nowIso()]);
}
