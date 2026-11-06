import type { Ctx } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId, slugify } from '../lib/ids';
import { nowIso } from '../lib/time';
import seed from '../seed/categories.json';

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  system: number;
}

/** Seeds / tops up system categories. Existing user edits (name/colour) are never overwritten. */
export function seedCategories(ctx: Ctx): number {
  let created = 0;
  const now = nowIso();
  ctx.db.tx(() => {
    seed.categories.forEach((c, i) => {
      let row = ctx.db.get<{ id: string }>('SELECT id FROM categories WHERE slug = ?', [c.slug]);
      if (!row) {
        row = { id: newId('cat') };
        ctx.db.run(
          `INSERT INTO categories(id, parent_id, slug, name, icon, color, sort_order, system, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [row.id, c.slug, c.name, c.icon, c.color, i * 10, now, now],
        );
        created++;
      }
      c.subcategories.forEach((s, j) => {
        if (!ctx.db.get('SELECT 1 FROM categories WHERE slug = ?', [s.slug])) {
          ctx.db.run(
            `INSERT INTO categories(id, parent_id, slug, name, icon, color, sort_order, system, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
            [newId('cat'), row!.id, s.slug, s.name, c.color, j * 10, now, now],
          );
          created++;
        }
      });
    });
  });
  return created;
}

export function listCategories(ctx: Ctx) {
  const rows = ctx.db.all<CategoryRow & { idea_count: number; node_count: number; app_count: number }>(
    `SELECT c.*,
      (SELECT COUNT(*) FROM ideas i WHERE (i.category_id = c.id OR i.subcategory_id = c.id) AND i.deleted_at IS NULL) idea_count,
      (SELECT COUNT(*) FROM nodes n WHERE n.category_id = c.id AND n.deleted_at IS NULL) node_count,
      (SELECT COUNT(*) FROM applications a WHERE a.category_id = c.id AND a.deleted_at IS NULL) app_count
     FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name`,
  );
  const top = rows.filter((r) => !r.parent_id);
  return top.map((t) => ({ ...t, children: rows.filter((r) => r.parent_id === t.id) }));
}

export function categoryIdBySlug(ctx: Ctx, slug: string | undefined | null): string | null {
  if (!slug) return null;
  return ctx.db.get<{ id: string }>('SELECT id FROM categories WHERE slug = ? AND deleted_at IS NULL', [slug])?.id ?? null;
}

export function createCategory(ctx: Ctx, input: { name: string; parentId?: string | null; icon?: string; color?: string; description?: string }) {
  const slugBase = slugify(input.name);
  let slug = slugBase;
  for (let i = 2; ctx.db.get('SELECT 1 FROM categories WHERE slug = ?', [slug]); i++) slug = `${slugBase}-${i}`;
  if (input.parentId && !ctx.db.get('SELECT 1 FROM categories WHERE id = ? AND parent_id IS NULL', [input.parentId])) {
    throw badRequest('Unterkategorien sind nur unter Hauptkategorien möglich.');
  }
  const id = newId('cat');
  const now = nowIso();
  const order = ctx.db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) + 10 m FROM categories')!.m;
  ctx.db.write(() =>
    ctx.db.run(
      `INSERT INTO categories(id, parent_id, slug, name, description, icon, color, sort_order, system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, input.parentId ?? null, slug, input.name, input.description ?? null, input.icon ?? 'tag', input.color ?? '#8b93ff', order, now, now],
    ),
  );
  ctx.hooks.onChange?.('category', id);
  return ctx.db.get<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id])!;
}

export function updateCategory(ctx: Ctx, id: string, patch: { name?: string; icon?: string; color?: string; description?: string; sortOrder?: number }) {
  const row = ctx.db.get<CategoryRow>('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) throw notFound('Kategorie');
  ctx.db.write(() =>
    ctx.db.run('UPDATE categories SET name = ?, icon = ?, color = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?', [
      patch.name ?? row.name, patch.icon ?? row.icon, patch.color ?? row.color, patch.description ?? row.description,
      patch.sortOrder ?? row.sort_order, nowIso(), id,
    ]),
  );
  ctx.hooks.onChange?.('category', id);
  return ctx.db.get<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id])!;
}

/** Soft delete; refuses while still in use so that nothing silently loses its category. */
export function deleteCategory(ctx: Ctx, id: string) {
  const used = ctx.db.get<{ c: number }>(
    `SELECT (SELECT COUNT(*) FROM nodes WHERE category_id = ? AND deleted_at IS NULL)
          + (SELECT COUNT(*) FROM ideas WHERE (category_id = ? OR subcategory_id = ?) AND deleted_at IS NULL)
          + (SELECT COUNT(*) FROM applications WHERE category_id = ? AND deleted_at IS NULL)
          + (SELECT COUNT(*) FROM categories WHERE parent_id = ? AND deleted_at IS NULL) c`,
    [id, id, id, id, id],
  )!.c;
  if (used > 0) throw conflict(`Kategorie wird noch von ${used} Einträgen verwendet.`);
  ctx.db.write(() => ctx.db.run('UPDATE categories SET deleted_at = ? WHERE id = ?', [nowIso(), id]));
  ctx.hooks.onChange?.('category', id);
}
