import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId, slugify } from '../lib/ids';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';
import { fingerprint, nameSimilarity, tokens } from '../lib/similarity';
import { logActivity, recordVersion } from './activity';
import { getTags, getTagsBulk, setTags } from './tags';
import { categoryIdBySlug } from './categories';
import { createNode, getNode } from './nodes';
import { search } from './search';
import { SEED_IDEAS, SEED_IDEAS_VERSION } from '../seed/ideas';
import {
  EFFORTS, EFFORT_LABELS, IDEA_SOURCE_LABELS, IDEA_STATUSES, MONETIZATION_CONFIDENCE,
  type IdeaDiscoveryMode, type IdeaSource,
} from '@shared/domain';

export interface IdeaRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string | null;
  problem: string | null;
  goal: string | null;
  benefit: string | null;
  audience: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  features: string;
  highlights: string;
  technologies: string;
  prerequisites: string;
  extensions: string;
  risks: string;
  complexity: number | null;
  effort: string | null;
  monetization_assessment: string | null;
  monetization_confidence: string | null;
  score_originality: number | null;
  score_usefulness: number | null;
  score_feasibility: number | null;
  status: string;
  favorite: number;
  source: IdeaSource;
  source_detail: string | null;
  parent_idea_id: string | null;
  variant_note: string | null;
  project_node_id: string | null;
  fingerprint: string;
  notes: string | null;
  seen_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const ideaInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(400),
  description: z.string().max(8000).nullable().optional(),
  problem: z.string().max(2000).nullable().optional(),
  goal: z.string().max(2000).nullable().optional(),
  benefit: z.string().max(2000).nullable().optional(),
  audience: z.string().max(400).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  subcategoryId: z.string().nullable().optional(),
  features: z.array(z.string().max(300)).max(30).optional(),
  highlights: z.array(z.string().max(300)).max(10).optional(),
  technologies: z.array(z.string().max(80)).max(30).optional(),
  prerequisites: z.array(z.string().max(300)).max(20).optional(),
  extensions: z.array(z.string().max(300)).max(20).optional(),
  risks: z.array(z.string().max(300)).max(20).optional(),
  complexity: z.number().int().min(1).max(5).nullable().optional(),
  effort: z.enum(EFFORTS).nullable().optional(),
  monetizationAssessment: z.string().max(2000).nullable().optional(),
  monetizationConfidence: z.enum(MONETIZATION_CONFIDENCE).nullable().optional(),
  scoreOriginality: z.number().int().min(1).max(5).nullable().optional(),
  scoreUsefulness: z.number().int().min(1).max(5).nullable().optional(),
  scoreFeasibility: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(IDEA_STATUSES).optional(),
  favorite: z.boolean().optional(),
  notes: z.string().max(20000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  parentIdeaId: z.string().nullable().optional(),
  variantNote: z.string().max(1000).nullable().optional(),
});
export type IdeaInput = z.input<typeof ideaInputSchema>;

const COLS: Record<string, string> = {
  title: 'title', summary: 'summary', description: 'description', problem: 'problem', goal: 'goal', benefit: 'benefit',
  audience: 'audience', categoryId: 'category_id', subcategoryId: 'subcategory_id', features: 'features', highlights: 'highlights',
  technologies: 'technologies', prerequisites: 'prerequisites', extensions: 'extensions', risks: 'risks', complexity: 'complexity',
  effort: 'effort', monetizationAssessment: 'monetization_assessment', monetizationConfidence: 'monetization_confidence',
  scoreOriginality: 'score_originality', scoreUsefulness: 'score_usefulness', scoreFeasibility: 'score_feasibility',
  status: 'status', favorite: 'favorite', notes: 'notes', parentIdeaId: 'parent_idea_id', variantNote: 'variant_note',
};

export function serializeIdea(i: IdeaRow & { category_name?: string | null; category_color?: string | null; category_icon?: string | null; category_slug?: string | null; subcategory_name?: string | null; project_name?: string | null }, tags: string[] = []) {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    description: i.description,
    problem: i.problem,
    goal: i.goal,
    benefit: i.benefit,
    audience: i.audience,
    categoryId: i.category_id,
    subcategoryId: i.subcategory_id,
    category: i.category_id ? { id: i.category_id, name: i.category_name ?? null, color: i.category_color ?? null, icon: i.category_icon ?? null, slug: i.category_slug ?? null } : null,
    subcategoryName: i.subcategory_name ?? null,
    features: parseJson<string[]>(i.features, []),
    highlights: parseJson<string[]>(i.highlights, []),
    technologies: parseJson<string[]>(i.technologies, []),
    prerequisites: parseJson<string[]>(i.prerequisites, []),
    extensions: parseJson<string[]>(i.extensions, []),
    risks: parseJson<string[]>(i.risks, []),
    complexity: i.complexity,
    effort: i.effort,
    monetization: { assessment: i.monetization_assessment, confidence: i.monetization_confidence },
    scores: { originality: i.score_originality, usefulness: i.score_usefulness, feasibility: i.score_feasibility },
    status: i.status,
    favorite: Boolean(i.favorite),
    source: i.source,
    sourceLabel: IDEA_SOURCE_LABELS[i.source],
    sourceDetail: i.source_detail,
    parentIdeaId: i.parent_idea_id,
    variantNote: i.variant_note,
    projectNodeId: i.project_node_id,
    projectName: i.project_name ?? null,
    notes: i.notes,
    seenAt: i.seen_at,
    version: i.version,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    tags,
  };
}
export type IdeaDto = ReturnType<typeof serializeIdea>;

const SELECT = `SELECT i.*, c.name category_name, c.color category_color, c.icon category_icon, c.slug category_slug,
  sc.name subcategory_name, n.name project_name
  FROM ideas i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN categories sc ON sc.id = i.subcategory_id
  LEFT JOIN nodes n ON n.id = i.project_node_id AND n.deleted_at IS NULL`;

function hydrate(ctx: Ctx, rows: IdeaRow[]) {
  const tags = getTagsBulk(ctx, 'idea', rows.map((r) => r.id));
  return rows.map((r) => serializeIdea(r, tags.get(r.id) ?? []));
}

export function requireIdea(ctx: Ctx, id: string): IdeaRow {
  const r = ctx.db.get<IdeaRow>(`${SELECT} WHERE i.id = ? AND i.deleted_at IS NULL`, [id]);
  if (!r) throw notFound('Idee');
  return r;
}

// ── Seeding ────────────────────────────────────────────────────────────────
export function seedIdeas(ctx: Ctx): number {
  const applied = Number(ctx.db.meta('seed_ideas_version') ?? '0');
  if (applied >= SEED_IDEAS_VERSION && ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM ideas WHERE source = 'library'`)!.c >= SEED_IDEAS.length) return 0;
  let created = 0;
  const now = nowIso();
  ctx.db.tx(() => {
    for (const s of SEED_IDEAS) {
      if (ctx.db.get('SELECT 1 FROM ideas WHERE slug = ?', [s.slug])) continue; // never overwrite user changes
      const id = newId('idea');
      ctx.db.run(
        `INSERT INTO ideas(id, slug, title, summary, description, problem, goal, benefit, audience, category_id, subcategory_id,
          features, highlights, technologies, prerequisites, extensions, risks, complexity, effort, monetization_assessment,
          monetization_confidence, score_originality, score_usefulness, score_feasibility, status, source, fingerprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', 'library', ?, ?, ?)`,
        [
          id, s.slug, s.title, s.summary, s.description, s.problem, s.goal, s.benefit, s.audience,
          categoryIdBySlug(ctx, s.category), categoryIdBySlug(ctx, s.subcategory),
          JSON.stringify(s.features), JSON.stringify(s.highlights), JSON.stringify(s.technologies), JSON.stringify(s.prerequisites),
          JSON.stringify(s.extensions), JSON.stringify(s.risks), s.complexity, s.effort, s.monetization.assessment,
          s.monetization.confidence, s.scores.originality, s.scores.usefulness, s.scores.feasibility, fingerprint(s.title), now, now,
        ],
      );
      setTags(ctx, 'idea', id, s.tags);
      created++;
    }
    ctx.db.setMeta('seed_ideas_version', String(SEED_IDEAS_VERSION));
  });
  return created;
}

// ── Listing & discovery ────────────────────────────────────────────────────
export const ideaListSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  complexity: z.string().optional(),
  effort: z.string().optional(),
  minUsefulness: z.coerce.number().int().min(1).max(5).optional(),
  minOriginality: z.coerce.number().int().min(1).max(5).optional(),
  favorite: z.enum(['1']).optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  sort: z.enum(['recent', 'usefulness', 'originality', 'feasibility', 'title', 'effort', 'score']).default('score'),
  limit: z.coerce.number().int().min(1).max(200).default(48),
  offset: z.coerce.number().int().min(0).default(0),
});

export function listIdeas(ctx: Ctx, f: z.infer<typeof ideaListSchema>) {
  const where = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (f.q) {
    const hits = search(ctx, f.q, { types: ['idea'], limit: 100 }).hits.map((h) => h.id);
    if (!hits.length) return { total: 0, items: [] };
    where.push(`i.id IN (${hits.map(() => '?').join(',')})`);
    params.push(...hits);
  }
  if (f.category) { where.push('(i.category_id = ? OR c.slug = ?)'); params.push(f.category, f.category); }
  if (f.subcategory) { where.push('(i.subcategory_id = ? OR sc.slug = ?)'); params.push(f.subcategory, f.subcategory); }
  if (f.complexity) { const v = f.complexity.split(',').map(Number); where.push(`i.complexity IN (${v.map(() => '?').join(',')})`); params.push(...v); }
  if (f.effort) { const v = f.effort.split(','); where.push(`i.effort IN (${v.map(() => '?').join(',')})`); params.push(...v); }
  if (f.minUsefulness) { where.push('i.score_usefulness >= ?'); params.push(f.minUsefulness); }
  if (f.minOriginality) { where.push('i.score_originality >= ?'); params.push(f.minOriginality); }
  if (f.favorite) where.push('i.favorite = 1');
  if (f.status) { const v = f.status.split(','); where.push(`i.status IN (${v.map(() => '?').join(',')})`); params.push(...v); }
  else where.push(`i.status <> 'discarded'`);
  if (f.source) { where.push('i.source = ?'); params.push(f.source); }
  const order = {
    recent: 'i.created_at DESC',
    usefulness: 'i.score_usefulness DESC, i.title',
    originality: 'i.score_originality DESC, i.title',
    feasibility: 'i.score_feasibility DESC, i.title',
    title: 'i.title COLLATE NOCASE',
    effort: `CASE i.effort WHEN 'xs' THEN 1 WHEN 's' THEN 2 WHEN 'm' THEN 3 WHEN 'l' THEN 4 WHEN 'xl' THEN 5 ELSE 6 END, i.title`,
    score: '(COALESCE(i.score_usefulness,0) + COALESCE(i.score_originality,0) + COALESCE(i.score_feasibility,0)) DESC, i.title',
  }[f.sort];
  const from = SELECT.slice(SELECT.indexOf('FROM'));
  const total = ctx.db.get<{ c: number }>(`SELECT COUNT(*) c ${from} WHERE ${where.join(' AND ')}`, params)!.c;
  const rows = ctx.db.all<IdeaRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
  return { total, items: hydrate(ctx, rows) };
}

export function ideaStats(ctx: Ctx) {
  return ctx.db.get<{ total: number; saved: number; favorites: number; converted: number; ai: number; library: number; unseen: number }>(
    `SELECT COUNT(*) total,
      SUM(status IN ('saved','evaluating')) saved, SUM(favorite) favorites, SUM(status = 'converted') converted,
      SUM(source = 'ai') ai, SUM(source = 'library') library, SUM(seen_at IS NULL) unseen
     FROM ideas WHERE deleted_at IS NULL AND status <> 'discarded'`,
  );
}

export const discoverSchema = z.object({
  mode: z.string(),
  category: z.string().optional(),
  q: z.string().max(300).optional(),
  projectId: z.string().optional(),
  ideaIds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(24).default(6),
});

/**
 * Local discovery modes over the curated library. This is transparent rule-based selection –
 * the response states `engine: 'local-library'` so the UI never presents it as AI output.
 */
export function discover(ctx: Ctx, p: z.infer<typeof discoverSchema>) {
  const mode = p.mode as IdeaDiscoveryMode;
  const base = `${SELECT} WHERE i.deleted_at IS NULL AND i.status NOT IN ('discarded')`;
  const lim = p.limit;
  let rows: IdeaRow[] = [];
  let explanation = '';
  switch (mode) {
    case 'discover':
      rows = ctx.db.all<IdeaRow>(`${base} ORDER BY (i.seen_at IS NULL) DESC, random() LIMIT ?`, [lim]);
      explanation = 'Zufällige Auswahl aus der Bibliothek – noch nicht angesehene Ideen zuerst.';
      break;
    case 'category': {
      if (!p.category) throw badRequest('Bitte eine Kategorie wählen.');
      rows = ctx.db.all<IdeaRow>(`${base} AND (i.category_id = ? OR c.slug = ? OR i.subcategory_id = ?) ORDER BY (i.seen_at IS NULL) DESC, random() LIMIT ?`, [p.category, p.category, p.category, lim]);
      explanation = 'Ideen aus der gewählten Kategorie.';
      break;
    }
    case 'problem':
    case 'audience': {
      if (!p.q) throw badRequest(mode === 'problem' ? 'Bitte das Problem beschreiben.' : 'Bitte eine Zielgruppe angeben.');
      const ids = search(ctx, p.q, { types: ['idea'], limit: lim * 2 }).hits.map((h) => h.id);
      rows = ids.length ? ctx.db.all<IdeaRow>(`${base} AND i.id IN (${ids.map(() => '?').join(',')})`, ids) : [];
      rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      rows = rows.slice(0, lim);
      explanation = `Volltextsuche nach „${p.q}“ in Problemstellung, Nutzen, Funktionen und Zielgruppe.`;
      break;
    }
    case 'unusual':
      rows = ctx.db.all<IdeaRow>(`${base} ORDER BY i.score_originality DESC, random() LIMIT ?`, [lim]);
      explanation = 'Höchste Originalitätsbewertung zuerst.';
      break;
    case 'quick-wins':
      rows = ctx.db.all<IdeaRow>(`${base} AND i.effort IN ('xs','s') ORDER BY i.score_feasibility DESC, i.score_usefulness DESC, random() LIMIT ?`, [lim]);
      explanation = 'Geringer Aufwand (XS/S) und hohe Umsetzbarkeit.';
      break;
    case 'big-projects':
      rows = ctx.db.all<IdeaRow>(`${base} AND i.effort IN ('l','xl') ORDER BY i.score_usefulness DESC, random() LIMIT ?`, [lim]);
      explanation = 'Größere Vorhaben (Aufwand L/XL).';
      break;
    case 'business':
      rows = ctx.db.all<IdeaRow>(`${base} AND i.monetization_confidence = 'plausibel' ORDER BY i.score_usefulness DESC, random() LIMIT ?`, [lim]);
      explanation = 'Ideen mit plausibler (nicht garantierter) wirtschaftlicher Verwertbarkeit.';
      break;
    case 'high-impact':
      rows = ctx.db.all<IdeaRow>(`${base} ORDER BY i.score_usefulness DESC, i.score_feasibility DESC, random() LIMIT ?`, [lim]);
      explanation = 'Höchster praktischer Nutzen zuerst.';
      break;
    case 'automation':
      rows = ctx.db.all<IdeaRow>(`${base} AND (c.slug IN ('ai-automation','ai-agents','dev-tools') OR i.technologies LIKE '%Automat%') ORDER BY random() LIMIT ?`, [lim]);
      explanation = 'Automatisierungs-, Agenten- und Entwickler-Workflows.';
      break;
    case 'claude':
      rows = ctx.db.all<IdeaRow>(`${base} AND (c.slug = 'claude-workflows' OR i.technologies LIKE '%Claude%' OR i.technologies LIKE '%MCP%') ORDER BY (c.slug = 'claude-workflows') DESC, random() LIMIT ?`, [lim]);
      explanation = 'Ideen, die Claude, Claude Code oder MCP nutzen.';
      break;
    case 'extend-project': {
      if (!p.projectId) throw badRequest('Bitte ein Projekt wählen.');
      const node = getNode(ctx, p.projectId);
      if (!node) throw notFound('Projekt');
      const words = [...tokens(`${node.name} ${node.summary ?? ''}`)].slice(0, 6).join(' ');
      const ftsIds = words ? search(ctx, words, { types: ['idea'], limit: lim * 2 }).hits.map((h) => h.id) : [];
      rows = ctx.db.all<IdeaRow>(
        `${base} AND (i.category_id = ? ${ftsIds.length ? `OR i.id IN (${ftsIds.map(() => '?').join(',')})` : ''}) ORDER BY random() LIMIT ?`,
        [node.category_id, ...ftsIds, lim],
      );
      explanation = `Ideen aus derselben Kategorie bzw. mit ähnlichen Begriffen wie „${node.name}“.`;
      break;
    }
    case 'improve': {
      const own = ctx.db.all<IdeaRow>(`${base} AND (i.status IN ('saved','evaluating','converted') OR i.favorite = 1) ORDER BY i.updated_at DESC LIMIT 12`);
      const suggestions = own.flatMap((i) => parseJson<string[]>(i.extensions, []).map((e) => ({ ideaId: i.id, ideaTitle: i.title, suggestion: e }))).slice(0, 24);
      return { engine: 'local-library' as const, mode, explanation: 'Erweiterungsvorschläge deiner gespeicherten und übernommenen Ideen.', ideas: [], suggestions };
    }
    case 'combine': {
      const ids = (p.ideaIds ?? '').split(',').filter(Boolean);
      let pair: IdeaRow[];
      if (ids.length >= 2) pair = ids.slice(0, 2).map((id) => requireIdea(ctx, id));
      else pair = ctx.db.all<IdeaRow>(`${base} AND i.id IN (SELECT id FROM ideas WHERE deleted_at IS NULL GROUP BY category_id ORDER BY random() LIMIT 2)`);
      if (pair.length < 2) throw badRequest('Für eine Kombination werden zwei Ideen benötigt.');
      return { engine: 'local-library' as const, mode, explanation: 'Regelbasierte Kombination zweier Ideen (keine KI). Als Entwurf speicherbar.', ideas: hydrate(ctx, pair), combination: combineIdeas(pair[0], pair[1]) };
    }
    default:
      throw badRequest('Unbekannter Entdeckungsmodus.');
  }
  return { engine: 'local-library' as const, mode, explanation, ideas: hydrate(ctx, rows) };
}

function combineIdeas(a: IdeaRow, b: IdeaRow) {
  const fa = parseJson<string[]>(a.features, []);
  const fb = parseJson<string[]>(b.features, []);
  return {
    title: `${a.title} × ${b.title}`,
    summary: `Kombiniert „${a.title}“ mit „${b.title}“: ${a.summary.replace(/\.$/, '')} – ergänzt um: ${b.summary.charAt(0).toLowerCase()}${b.summary.slice(1)}`,
    features: [...fa.slice(0, 3), ...fb.slice(0, 3)],
    technologies: [...new Set([...parseJson<string[]>(a.technologies, []), ...parseJson<string[]>(b.technologies, [])])].slice(0, 10),
    sourceIdeaIds: [a.id, b.id],
    note: 'Regelbasiert zusammengesetzt – Bewertung und Feinschliff bitte selbst vornehmen oder in Claude ausarbeiten.',
  };
}

export function markSeen(ctx: Ctx, ids: string[]): void {
  if (!ids.length) return;
  ctx.db.run(`UPDATE ideas SET seen_at = COALESCE(seen_at, ?) WHERE id IN (${ids.map(() => '?').join(',')})`, [nowIso(), ...ids]);
}

export function similarIdeas(ctx: Ctx, id: string, limit = 5) {
  const idea = requireIdea(ctx, id);
  const candidates = ctx.db.all<IdeaRow>(
    `${SELECT} WHERE i.deleted_at IS NULL AND i.id <> ? AND (i.category_id IS ? OR i.subcategory_id IS ?) LIMIT 200`,
    [id, idea.category_id, idea.subcategory_id],
  );
  const myTags = new Set(getTags(ctx, 'idea', id));
  const myTokens = tokens(`${idea.title} ${idea.summary}`);
  const scored = candidates
    .map((c) => {
      const t = tokens(`${c.title} ${c.summary}`);
      let overlap = 0;
      for (const x of t) if (myTokens.has(x)) overlap++;
      const tagOverlap = getTags(ctx, 'idea', c.id).filter((x) => myTags.has(x)).length;
      return { c, score: overlap + tagOverlap * 1.5 + (c.subcategory_id === idea.subcategory_id ? 1 : 0) + nameSimilarity(c.title, idea.title) * 2 };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((s) => s.c);
  const variants = ctx.db.all<IdeaRow>(`${SELECT} WHERE i.deleted_at IS NULL AND (i.parent_idea_id = ? OR i.id = ?)`, [id, idea.parent_idea_id ?? '']);
  return { similar: hydrate(ctx, scored), variants: hydrate(ctx, variants.filter((v) => v.id !== id)) };
}

/** Finds existing ideas that look like the given title (never merges – used to warn / link as variant). */
export function findSimilarByTitle(ctx: Ctx, title: string, excludeId?: string): { id: string; title: string; score: number }[] {
  const fp = fingerprint(title);
  const rows = ctx.db.all<{ id: string; title: string; fingerprint: string }>('SELECT id, title, fingerprint FROM ideas WHERE deleted_at IS NULL');
  return rows
    .filter((r) => r.id !== excludeId)
    .map((r) => ({ id: r.id, title: r.title, score: r.fingerprint === fp && fp ? 1 : nameSimilarity(r.title, title) }))
    .filter((r) => r.score >= 0.82)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ── Writes ─────────────────────────────────────────────────────────────────
export function createIdea(
  ctx: Ctx,
  meta: WriteMeta,
  raw: IdeaInput,
  opts: { source?: IdeaSource; sourceDetail?: string; force?: boolean } = {},
): IdeaRow {
  const input = ideaInputSchema.parse(raw);
  const similar = findSimilarByTitle(ctx, input.title);
  if (similar.length && !opts.force && !input.parentIdeaId) {
    throw conflict('Es gibt bereits eine sehr ähnliche Idee. Als Weiterentwicklung kennzeichnen oder bewusst separat anlegen?', { similar });
  }
  const id = newId('idea');
  const now = nowIso();
  let slug = slugify(input.title);
  for (let n = 2; ctx.db.get('SELECT 1 FROM ideas WHERE slug = ?', [slug]); n++) slug = `${slugify(input.title)}-${n}`;
  const j = (v: unknown[] | undefined) => JSON.stringify(v ?? []);
  ctx.db.write(() => {
    ctx.db.run(
      `INSERT INTO ideas(id, slug, title, summary, description, problem, goal, benefit, audience, category_id, subcategory_id, features,
        highlights, technologies, prerequisites, extensions, risks, complexity, effort, monetization_assessment, monetization_confidence,
        score_originality, score_usefulness, score_feasibility, status, favorite, source, source_detail, parent_idea_id, variant_note,
        fingerprint, notes, seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, slug, input.title, input.summary, input.description ?? null, input.problem ?? null, input.goal ?? null, input.benefit ?? null,
        input.audience ?? null, input.categoryId ?? null, input.subcategoryId ?? null, j(input.features), j(input.highlights),
        j(input.technologies), j(input.prerequisites), j(input.extensions), j(input.risks), input.complexity ?? null, input.effort ?? null,
        input.monetizationAssessment ?? null, input.monetizationConfidence ?? null, input.scoreOriginality ?? null,
        input.scoreUsefulness ?? null, input.scoreFeasibility ?? null, input.status ?? (opts.source === 'manual' ? 'saved' : 'discovered'),
        input.favorite ? 1 : 0, opts.source ?? 'manual', opts.sourceDetail ?? null, input.parentIdeaId ?? null,
        input.variantNote ?? null, fingerprint(input.title), input.notes ?? null, opts.source === 'manual' ? now : null, now, now,
      ],
    );
    if (input.tags?.length) setTags(ctx, 'idea', id, input.tags);
    const row = requireIdea(ctx, id);
    recordVersion(ctx, meta, 'idea', id, 1, 'create', row);
    logActivity(ctx, meta, {
      action: 'idea.created',
      summary: `Idee „${input.title}“ ${opts.source === 'ai' ? 'generiert' : opts.source === 'claude' ? 'von Claude übermittelt' : 'erfasst'}${input.parentIdeaId ? ' (als Weiterentwicklung gekennzeichnet)' : ''}`,
      entityType: 'idea', entityId: id, entityName: input.title,
    });
  });
  ctx.hooks.onChange?.('idea', id);
  return requireIdea(ctx, id);
}

export function updateIdea(ctx: Ctx, meta: WriteMeta, id: string, raw: Partial<IdeaInput> & { version?: number }): IdeaRow {
  const input = ideaInputSchema.partial().extend({ version: z.number().int().optional() }).parse(raw);
  const cur = requireIdea(ctx, id);
  if (input.version !== undefined && input.version !== cur.version) throw conflict('Die Idee wurde inzwischen geändert. Bitte neu laden.');
  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    const col = COLS[k];
    if (!col || v === undefined) continue;
    const value = Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
    if ((cur as unknown as Record<string, unknown>)[col] === value) continue;
    sets.push(`${col} = ?`);
    params.push(value);
    changed.push(k);
    if (col === 'title') { sets.push('fingerprint = ?'); params.push(fingerprint(String(v))); }
  }
  if (!changed.length && !input.tags) return cur;
  ctx.db.write(() => {
    if (sets.length) ctx.db.run(`UPDATE ideas SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`, [...params, nowIso(), id]);
    if (input.tags) setTags(ctx, 'idea', id, input.tags);
    const row = requireIdea(ctx, id);
    recordVersion(ctx, meta, 'idea', id, row.version, 'update', row);
    const statusChange = input.status && input.status !== cur.status;
    logActivity(ctx, meta, {
      action: statusChange ? 'idea.status' : 'idea.updated',
      summary: statusChange ? `Idee „${row.title}“: Status → ${input.status}` : `Idee „${row.title}“ aktualisiert`,
      entityType: 'idea', entityId: id, entityName: row.title, data: { fields: changed },
    });
  });
  ctx.hooks.onChange?.('idea', id);
  return requireIdea(ctx, id);
}

export function trashIdea(ctx: Ctx, meta: WriteMeta, id: string): void {
  const idea = requireIdea(ctx, id);
  ctx.db.write(() => {
    ctx.db.run('UPDATE ideas SET deleted_at = ?, version = version + 1 WHERE id = ?', [nowIso(), id]);
    logActivity(ctx, meta, { action: 'idea.trashed', summary: `Idee „${idea.title}“ in den Papierkorb gelegt`, entityType: 'idea', entityId: id, entityName: idea.title });
  });
  ctx.hooks.onChange?.('idea', id);
}

export function restoreIdea(ctx: Ctx, meta: WriteMeta, id: string): void {
  const idea = ctx.db.get<IdeaRow>('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!idea) throw notFound('Idee');
  ctx.db.write(() => {
    ctx.db.run('UPDATE ideas SET deleted_at = NULL, version = version + 1 WHERE id = ?', [id]);
    logActivity(ctx, meta, { action: 'idea.restored', summary: `Idee „${idea.title}“ wiederhergestellt`, entityType: 'idea', entityId: id, entityName: idea.title });
  });
  ctx.hooks.onChange?.('idea', id);
}

export function purgeIdea(ctx: Ctx, meta: WriteMeta, id: string): void {
  const idea = ctx.db.get<IdeaRow>('SELECT * FROM ideas WHERE id = ? AND deleted_at IS NOT NULL', [id]);
  if (!idea) throw badRequest('Nur Ideen im Papierkorb können endgültig gelöscht werden.');
  ctx.db.write(() => {
    ctx.db.run('UPDATE ideas SET parent_idea_id = NULL WHERE parent_idea_id = ?', [id]);
    ctx.db.run(`DELETE FROM entity_tags WHERE entity_type = 'idea' AND entity_id = ?`, [id]);
    ctx.db.run(`DELETE FROM external_identities WHERE entity_type = 'idea' AND entity_id = ?`, [id]);
    ctx.db.run('DELETE FROM ideas WHERE id = ?', [id]);
    logActivity(ctx, meta, { action: 'idea.purged', summary: `Idee „${idea.title}“ endgültig gelöscht`, entityType: 'idea', entityId: id, entityName: idea.title });
  });
  ctx.hooks.onChange?.('idea', id);
}

// ── Idea → project ─────────────────────────────────────────────────────────
export function suggestedExternalId(title: string): string {
  return slugify(title).slice(0, 60);
}

/** Structured, copyable development brief (deterministic template from the idea's data). */
export function buildBrief(ctx: Ctx, id: string, opts: { projectName?: string; externalId?: string } = {}): string {
  const i = serializeIdea(requireIdea(ctx, id));
  const name = opts.projectName ?? i.title;
  const ext = opts.externalId ?? suggestedExternalId(name);
  const list = (items: string[], fallback = '- _noch offen_') => (items.length ? items.map((x) => `- ${x}`).join('\n') : fallback);
  const date = new Date().toISOString().slice(0, 10);
  return `# Entwicklungsauftrag: ${name}

> Erstellt am ${date} aus dem OMEGA AI Idea Hub · Quelle: ${i.sourceLabel}${i.category?.name ? ` · Kategorie: ${i.category.name}` : ''}
> Hinweis: Bewertungen und wirtschaftliche Einschätzungen sind **Einschätzungen, keine Fakten oder Garantien**.

## Vision
${i.description ?? i.summary}

## Zielsetzung
${i.goal ?? '_noch offen_'}

## Problemstellung
${i.problem ?? '_noch offen_'}

## Zielgruppe
${i.audience ?? '_noch offen_'}

## Funktionsumfang (MVP)
${list(i.features)}

## Besondere Merkmale
${list(i.highlights)}

## Anforderungen
**Funktional**
${list(i.features.map((f) => `${f} – nachweisbar umgesetzt und getestet`))}

**Nicht-funktional**
- Daten dauerhaft und sicher speichern; keine Geheimnisse im Frontend oder in Logs
- Eingaben serverseitig validieren, verständliche Fehlermeldungen
- Responsiv (Smartphone bis Desktop), Tastaturbedienung, ausreichende Kontraste
- Automatisierte Tests für Kernabläufe

## Technische Rahmenbedingungen
- Mögliche Technologien: ${i.technologies.length ? i.technologies.join(', ') : '_frei wählbar_'}
${list(i.prerequisites.map((p) => `Voraussetzung: ${p}`), '- Keine besonderen Voraussetzungen erfasst')}

## Prioritäten
1. Kernnutzen aus der Problemstellung lösen (MVP)
2. Datensicherheit und Zuverlässigkeit
3. Bedienbarkeit und Design
4. Erweiterungen erst nach stabilem MVP

## Qualitätskriterien
- Jede Funktion ist erst fertig, wenn Oberfläche, Logik, Speicherung, Fehlerbehandlung und Tests funktionieren
- Keine Funktionsattrappen, keine vorgetäuschten Integrationen
- Tests werden tatsächlich ausgeführt und ehrlich dokumentiert

## Mögliche Erweiterungen
${list(i.extensions)}

## Risiken & Grenzen
${list(i.risks)}

## Einschätzung
- Technische Komplexität: ${i.complexity ?? '–'}/5 · Aufwand: ${i.effort ? EFFORT_LABELS[i.effort as keyof typeof EFFORT_LABELS] : '–'}
- Originalität ${i.scores.originality ?? '–'}/5 · Nutzen ${i.scores.usefulness ?? '–'}/5 · Umsetzbarkeit ${i.scores.feasibility ?? '–'}/5
- Wirtschaftliche Verwertbarkeit (${i.monetization.confidence ?? 'nicht bewertet'}): ${i.monetization.assessment ?? '–'}

## Synchronisierung mit OMEGA
Bitte melde Struktur und Fortschritt über den OMEGA-MCP-Server bzw. die Ingest-API (omega.ingest/v1):
- Projekt: \`externalId: "${ext}"\` (Typ \`project.upsert\`)
- Module: \`externalId: "${ext}/<modul>"\` mit \`parentExternalId: "${ext}"\` (Typ \`node.upsert\`)
- Fortschritt: Typ \`progress.report\`
`;
}

export function convertToProject(
  ctx: Ctx,
  meta: WriteMeta,
  id: string,
  opts: { name?: string; categoryId?: string | null; parentId?: string | null } = {},
) {
  const idea = requireIdea(ctx, id);
  if (idea.project_node_id && getNode(ctx, idea.project_node_id)) {
    throw conflict('Diese Idee wurde bereits als Projekt übernommen.', { projectId: idea.project_node_id });
  }
  const name = opts.name?.trim() || idea.title;
  const brief = buildBrief(ctx, id, { projectName: name });
  return ctx.db.write(() => {
    const project = createNode(
      ctx, meta,
      {
        kind: 'project', parentId: opts.parentId ?? null, name, summary: idea.summary, description: idea.description ?? idea.summary,
        categoryId: opts.categoryId !== undefined ? opts.categoryId : idea.category_id, lifecycleStatus: 'planned',
        tags: getTags(ctx, 'idea', id),
      },
      { origin: 'idea' },
    );
    const doc = createNode(ctx, meta, { kind: 'documentation', parentId: project.id, name: 'Entwicklungsauftrag', body: brief, summary: 'Strukturierter Auftrag für die Umsetzung in Claude' }, { origin: 'idea' });
    ctx.db.run(`UPDATE ideas SET status = 'converted', project_node_id = ?, version = version + 1, updated_at = ? WHERE id = ?`, [project.id, nowIso(), id]);
    logActivity(ctx, meta, {
      action: 'idea.converted', summary: `Idee „${idea.title}“ als Projekt „${name}“ übernommen – Entwicklungsauftrag erstellt`,
      entityType: 'idea', entityId: id, entityName: idea.title, projectId: project.id, data: { projectId: project.id, briefNodeId: doc.id },
    });
    ctx.hooks.onChange?.('idea', id);
    return { projectId: project.id, briefNodeId: doc.id, brief };
  });
}
