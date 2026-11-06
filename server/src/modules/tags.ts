import type { Ctx } from '../context';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

export function setTags(ctx: Ctx, entityType: string, entityId: string, names: string[]): void {
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
  ctx.db.run('DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  for (const name of clean) {
    let tag = ctx.db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', [name]);
    if (!tag) {
      tag = { id: newId('tag') };
      ctx.db.run('INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)', [tag.id, name, nowIso()]);
    }
    ctx.db.run('INSERT OR IGNORE INTO entity_tags(tag_id, entity_type, entity_id) VALUES (?, ?, ?)', [tag.id, entityType, entityId]);
  }
}

export function getTags(ctx: Ctx, entityType: string, entityId: string): string[] {
  return ctx.db
    .all<{ name: string }>(
      'SELECT t.name FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = ? AND et.entity_id = ? ORDER BY t.name',
      [entityType, entityId],
    )
    .map((r) => r.name);
}

export function getTagsBulk(ctx: Ctx, entityType: string, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const rows = ctx.db.all<{ entity_id: string; name: string }>(
    `SELECT et.entity_id, t.name FROM entity_tags et JOIN tags t ON t.id = et.tag_id
     WHERE et.entity_type = ? AND et.entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`,
    [entityType, ...ids],
  );
  for (const r of rows) {
    const list = map.get(r.entity_id) ?? [];
    list.push(r.name);
    map.set(r.entity_id, list);
  }
  return map;
}

export function listTags(ctx: Ctx) {
  return ctx.db.all<{ name: string; count: number }>(
    'SELECT t.name, COUNT(et.entity_id) count FROM tags t LEFT JOIN entity_tags et ON et.tag_id = t.id GROUP BY t.id HAVING count > 0 ORDER BY count DESC, t.name LIMIT 300',
  );
}
