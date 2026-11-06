import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { notFound } from '../lib/errors';
import { newId, slugify } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { logActivity } from './activity';
import { SEED_ARTICLES, SEED_ARTICLES_VERSION } from '../seed/knowledge';

interface ArticleRow {
  id: string; slug: string; title: string; topic: string; difficulty: string; summary: string; body: string;
  sources: string; verification: string; verified_at: string | null; origin: string; created_at: string; updated_at: string;
}

/** Articles older than this are flagged as "re-check recommended" (Claude features change quickly). */
const STALE_DAYS = 120;

export function serializeArticle(a: ArticleRow) {
  const ageDays = a.verified_at ? (Date.now() - new Date(a.verified_at).getTime()) / 86_400_000 : null;
  return {
    id: a.id, slug: a.slug, title: a.title, topic: a.topic, difficulty: a.difficulty, summary: a.summary, body: a.body,
    sources: parseJson<{ title: string; url: string }[]>(a.sources, []),
    verification: a.verification, verifiedAt: a.verified_at, origin: a.origin, updatedAt: a.updated_at,
    stale: a.verification === 'verified' && ageDays !== null && ageDays > STALE_DAYS,
  };
}

export function seedKnowledge(ctx: Ctx): number {
  const applied = Number(ctx.db.meta('seed_knowledge_version') ?? '0');
  if (applied >= SEED_ARTICLES_VERSION && SEED_ARTICLES_VERSION > 0) return 0;
  let n = 0;
  const now = nowIso();
  ctx.db.tx(() => {
    for (const a of SEED_ARTICLES) {
      if (ctx.db.get('SELECT 1 FROM knowledge_articles WHERE slug = ?', [a.slug])) continue;
      ctx.db.run(
        `INSERT INTO knowledge_articles(id, slug, title, topic, difficulty, summary, body, sources, verification, verified_at, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?, ?)`,
        [newId('kb'), a.slug, a.title, a.topic, a.difficulty, a.summary, a.body, JSON.stringify(a.sources), a.verification, a.verifiedAt, now, now],
      );
      n++;
    }
    ctx.db.setMeta('seed_knowledge_version', String(SEED_ARTICLES_VERSION));
  });
  return n;
}

export function listArticles(ctx: Ctx, f: { topic?: string; q?: string }) {
  const where = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (f.topic) { where.push('topic = ?'); params.push(f.topic); }
  if (f.q) { where.push('(title LIKE ? OR summary LIKE ? OR body LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  return ctx.db.all<ArticleRow>(`SELECT * FROM knowledge_articles WHERE ${where.join(' AND ')} ORDER BY topic, title`, params).map(serializeArticle);
}

export function getArticle(ctx: Ctx, slug: string) {
  const a = ctx.db.get<ArticleRow>('SELECT * FROM knowledge_articles WHERE (slug = ? OR id = ?) AND deleted_at IS NULL', [slug, slug]);
  if (!a) throw notFound('Artikel');
  return serializeArticle(a);
}

export const articleInput = z.object({
  title: z.string().trim().min(1).max(200),
  topic: z.enum(['claude-code', 'mcp', 'api', 'prompting', 'workflows', 'claude-apps']),
  difficulty: z.enum(['einsteiger', 'fortgeschritten', 'experte']).default('einsteiger'),
  summary: z.string().trim().min(1).max(500),
  body: z.string().max(50000),
  sources: z.array(z.object({ title: z.string().max(200), url: z.string().url() })).max(10).default([]),
});

export function createArticle(ctx: Ctx, meta: WriteMeta, raw: z.input<typeof articleInput>) {
  const a = articleInput.parse(raw);
  const id = newId('kb');
  let slug = slugify(a.title);
  for (let i = 2; ctx.db.get('SELECT 1 FROM knowledge_articles WHERE slug = ?', [slug]); i++) slug = `${slugify(a.title)}-${i}`;
  const now = nowIso();
  ctx.db.write(() => {
    ctx.db.run(
      `INSERT INTO knowledge_articles(id, slug, title, topic, difficulty, summary, body, sources, verification, verified_at, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified', NULL, 'manual', ?, ?)`,
      [id, slug, a.title, a.topic, a.difficulty, a.summary, a.body, JSON.stringify(a.sources), now, now],
    );
    logActivity(ctx, meta, { action: 'knowledge.created', summary: `Wissensartikel „${a.title}“ angelegt`, entityType: 'knowledge', entityId: id, entityName: a.title });
  });
  ctx.hooks.onChange?.('knowledge', id);
  return getArticle(ctx, id);
}

/** Owner marks an article as checked against the official docs today, or as outdated. */
export function setVerification(ctx: Ctx, meta: WriteMeta, slug: string, state: 'verified' | 'outdated' | 'unverified') {
  const a = getArticle(ctx, slug);
  ctx.db.write(() => {
    ctx.db.run('UPDATE knowledge_articles SET verification = ?, verified_at = ?, updated_at = ? WHERE id = ?', [
      state, state === 'verified' ? nowIso() : a.verifiedAt, nowIso(), a.id,
    ]);
    logActivity(ctx, meta, {
      action: 'knowledge.verification', entityType: 'knowledge', entityId: a.id, entityName: a.title,
      summary: `Wissensartikel „${a.title}“: ${state === 'verified' ? 'gegen offizielle Doku geprüft' : state === 'outdated' ? 'als veraltet markiert' : 'Prüfstatus zurückgesetzt'}`,
    });
  });
  return getArticle(ctx, a.id);
}
