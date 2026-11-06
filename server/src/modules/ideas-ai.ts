import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Ctx, WriteMeta } from '../context';
import { badRequest, unavailable } from '../lib/errors';
import { categoryIdBySlug } from './categories';
import { createIdea, findSimilarByTitle, requireIdea, serializeIdea } from './ideas';
import { getNode } from './nodes';
import { logActivity } from './activity';
import seedCategories from '../seed/categories.json';
import { EFFORTS } from '@shared/domain';

/**
 * Optional, real AI generation via the Claude API. Only active when ANTHROPIC_API_KEY is set –
 * otherwise the endpoint answers "not configured" and the UI offers the local library instead (§7.3, §22).
 */
export function aiStatus(ctx: Ctx) {
  return {
    configured: ctx.config.anthropic.apiKeyConfigured,
    model: ctx.config.anthropic.model,
    note: ctx.config.anthropic.apiKeyConfigured
      ? 'Claude API verbunden (Schlüssel aus Umgebungsvariable ANTHROPIC_API_KEY).'
      : 'Nicht eingerichtet: ANTHROPIC_API_KEY ist nicht gesetzt. Es wird ausschließlich die lokale, kuratierte Bibliothek verwendet.',
  };
}

export const generateSchema = z.object({
  mode: z.enum(['discover', 'category', 'problem', 'unusual', 'quick-wins', 'big-projects', 'business', 'high-impact', 'extend-project', 'combine', 'automation', 'claude', 'audience', 'improve']),
  category: z.string().optional(),
  problem: z.string().max(1000).optional(),
  audience: z.string().max(300).optional(),
  projectId: z.string().optional(),
  ideaIds: z.array(z.string()).max(3).optional(),
  count: z.number().int().min(1).max(6).default(3),
});

const aiIdea = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(300),
  description: z.string().max(1500),
  problem: z.string().max(800),
  goal: z.string().max(400),
  benefit: z.string().max(600),
  audience: z.string().max(200),
  category: z.string(),
  features: z.array(z.string().max(200)).max(8),
  highlights: z.array(z.string().max(200)).max(4),
  technologies: z.array(z.string().max(60)).max(10),
  prerequisites: z.array(z.string().max(200)).max(6),
  extensions: z.array(z.string().max(200)).max(5),
  risks: z.array(z.string().max(200)).max(5),
  complexity: z.number().int().min(1).max(5),
  effort: z.enum(EFFORTS),
  monetization_assessment: z.string().max(500),
  monetization_confidence: z.enum(['plausibel', 'spekulativ', 'nicht-vorgesehen']),
  originality: z.number().int().min(1).max(5),
  usefulness: z.number().int().min(1).max(5),
  feasibility: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(30)).max(6),
});

const strArr = { type: 'array', items: { type: 'string' } };
const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'summary', 'description', 'problem', 'goal', 'benefit', 'audience', 'category', 'features', 'highlights', 'technologies',
          'prerequisites', 'extensions', 'risks', 'complexity', 'effort', 'monetization_assessment', 'monetization_confidence',
          'originality', 'usefulness', 'feasibility', 'tags',
        ],
        properties: {
          title: { type: 'string' }, summary: { type: 'string' }, description: { type: 'string' }, problem: { type: 'string' },
          goal: { type: 'string' }, benefit: { type: 'string' }, audience: { type: 'string' },
          category: { type: 'string', enum: seedCategories.categories.map((c) => c.slug) },
          features: strArr, highlights: strArr, technologies: strArr, prerequisites: strArr, extensions: strArr, risks: strArr,
          complexity: { type: 'integer' }, effort: { type: 'string', enum: [...EFFORTS] },
          monetization_assessment: { type: 'string' },
          monetization_confidence: { type: 'string', enum: ['plausibel', 'spekulativ', 'nicht-vorgesehen'] },
          originality: { type: 'integer' }, usefulness: { type: 'integer' }, feasibility: { type: 'integer' }, tags: strArr,
        },
      },
    },
  },
} as const;

const MODE_TEXT: Record<string, string> = {
  discover: 'Entwickle frische, konkrete Ideen aus beliebigen Bereichen.',
  category: 'Entwickle Ideen für die angegebene Kategorie.',
  problem: 'Entwickle Lösungen für das beschriebene Problem.',
  unusual: 'Entwickle besonders ungewöhnliche, überraschende, aber umsetzbare Ideen.',
  'quick-wins': 'Entwickle kleine Tools mit sehr geringem Entwicklungsaufwand (XS oder S).',
  'big-projects': 'Entwickle ambitionierte, große Softwareprojekte (Aufwand L oder XL).',
  business: 'Entwickle Business-Ideen mit nüchterner Einschätzung der Verwertbarkeit.',
  'high-impact': 'Entwickle Ideen mit maximalem praktischem Alltagsnutzen.',
  'extend-project': 'Entwickle Erweiterungen für das angegebene bestehende Projekt.',
  combine: 'Kombiniere die angegebenen Ideen zu neuen, stärkeren Konzepten.',
  automation: 'Entwickle Ideen zur Automatisierung wiederkehrender Prozesse.',
  claude: 'Entwickle neue Einsatzmöglichkeiten für Claude, Claude Code und MCP.',
  audience: 'Entwickle Lösungen für die angegebene Zielgruppe.',
  improve: 'Entwickle Verbesserungen bestehender Funktionen der genannten Ideen.',
};

export async function generateIdeas(ctx: Ctx, meta: WriteMeta, raw: z.input<typeof generateSchema>) {
  if (!ctx.config.anthropic.apiKeyConfigured) {
    throw unavailable('ai_not_configured', 'KI-Generierung ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt). Nutze die lokale Ideenbibliothek.');
  }
  const p = generateSchema.parse(raw);
  const context: string[] = [];
  if (p.category) context.push(`Kategorie: ${p.category}`);
  if (p.problem) context.push(`Problem: ${p.problem}`);
  if (p.audience) context.push(`Zielgruppe: ${p.audience}`);
  if (p.projectId) {
    const n = getNode(ctx, p.projectId);
    if (!n) throw badRequest('Projekt nicht gefunden.');
    context.push(`Bestehendes Projekt: ${n.name} – ${n.summary ?? n.description ?? ''}`);
  }
  if (p.ideaIds?.length) {
    for (const id of p.ideaIds) {
      const i = serializeIdea(requireIdea(ctx, id));
      context.push(`Idee: ${i.title} – ${i.summary}`);
    }
  }
  // Anti-standard: tell the model what already exists so it avoids repetitions.
  const existing = ctx.db
    .all<{ title: string }>(
      `SELECT i.title FROM ideas i LEFT JOIN categories c ON c.id = i.category_id WHERE i.deleted_at IS NULL ${p.category ? 'AND c.slug = ?' : ''} ORDER BY i.updated_at DESC LIMIT 120`,
      p.category ? [p.category] : [],
    )
    .map((r) => r.title);

  const client = new Anthropic();
  const system = `Du bist Produktstratege für ein persönliches Innovationssystem. Antworte ausschließlich auf Deutsch.
Regeln: konkrete, umsetzbare Ideen, die mit Claude (Claude Code, Claude API, MCP) gebaut werden können. Keine Standardideen ohne klaren Twist.
Trenne Fakten von Einschätzungen. Versprich niemals Einnahmen oder Erfolg. Nenne ehrliche Risiken und rechtliche Grenzen.
Bewertungen (1–5) ehrlich und differenziert vergeben. Wiederhole keine der bereits vorhandenen Ideen; deutlich verbesserte Varianten nur, wenn sie klar besser sind.`;
  const user = `${MODE_TEXT[p.mode]}
Anzahl: ${p.count}
${context.join('\n')}

Bereits vorhandene Ideen (nicht wiederholen):
${existing.map((t) => `- ${t}`).join('\n') || '- (keine)'}`;

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: ctx.config.anthropic.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA as unknown as Record<string, unknown> } },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw unavailable('ai_auth', 'Claude API: Schlüssel ungültig.');
    if (e instanceof Anthropic.RateLimitError) throw unavailable('ai_rate_limited', 'Claude API: Rate-Limit erreicht – bitte später erneut versuchen.');
    if (e instanceof Anthropic.APIError) throw unavailable('ai_error', `Claude API Fehler ${e.status ?? ''}: ${e.message}`);
    throw unavailable('ai_unreachable', 'Claude API nicht erreichbar.');
  }
  if (response.stop_reason === 'refusal') throw unavailable('ai_refusal', 'Die Anfrage wurde von Claude abgelehnt.');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: { ideas: unknown[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unavailable('ai_invalid', 'Antwort der Claude API war kein gültiges JSON.');
  }
  const created = [];
  const skipped: string[] = [];
  for (const rawIdea of parsed.ideas ?? []) {
    const r = aiIdea.safeParse(rawIdea);
    if (!r.success) { skipped.push('Ungültiger Eintrag verworfen'); continue; }
    const i = r.data;
    const similar = findSimilarByTitle(ctx, i.title);
    const row = createIdea(
      ctx, meta,
      {
        title: i.title, summary: i.summary, description: i.description, problem: i.problem, goal: i.goal, benefit: i.benefit,
        audience: i.audience, categoryId: categoryIdBySlug(ctx, i.category), features: i.features, highlights: i.highlights,
        technologies: i.technologies, prerequisites: i.prerequisites, extensions: i.extensions, risks: i.risks,
        complexity: i.complexity, effort: i.effort, monetizationAssessment: i.monetization_assessment,
        monetizationConfidence: i.monetization_confidence, scoreOriginality: i.originality, scoreUsefulness: i.usefulness,
        scoreFeasibility: i.feasibility, tags: i.tags,
        parentIdeaId: similar[0]?.id ?? null,
        variantNote: similar[0] ? `Ähnlich zu „${similar[0].title}“ – als Weiterentwicklung gekennzeichnet` : null,
      },
      { source: 'ai', sourceDetail: `${response.model} · Modus ${p.mode}`, force: true },
    );
    created.push(serializeIdea(row));
  }
  logActivity(ctx, meta, { action: 'idea.generated', summary: `${created.length} Ideen über die Claude API generiert (Modus: ${p.mode})`, data: { model: response.model } });
  return { engine: 'claude-api' as const, model: response.model, ideas: created, skipped };
}
