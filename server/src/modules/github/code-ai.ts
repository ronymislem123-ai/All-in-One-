import Anthropic from '@anthropic-ai/sdk';
import type { Ctx } from '../../context';
import { badRequest, unavailable } from '../../lib/errors';
import { architecture, fileContent, pathDetail } from './explorer';

/**
 * Optional Q&A for the robot guide. Only available with ANTHROPIC_API_KEY. The model only receives
 * facts from the analysis plus (redacted) file content – it is told to separate facts from guesses.
 */
export async function askAboutCode(ctx: Ctx, repoId: string, path: string, question: string) {
  if (!ctx.config.anthropic.apiKeyConfigured) {
    throw unavailable('ai_not_configured', 'Fragen an den Code-Begleiter benötigen die Claude API (ANTHROPIC_API_KEY ist nicht gesetzt).');
  }
  const q = question.trim();
  if (!q || q.length > 1000) throw badRequest('Bitte eine Frage mit bis zu 1000 Zeichen stellen.');
  const facts = pathDetail(ctx, repoId, path);
  const arch = architecture(ctx, repoId);
  let content = '';
  if (facts.type === 'file' && !facts.protected) {
    try {
      const f = await fileContent(ctx, repoId, path);
      content = f.text.slice(0, 40_000);
    } catch { /* content optional */ }
  }
  const client = new Anthropic();
  const system = `Du bist OMI, ein freundlicher Begleiter, der eine Codebasis erklärt. Antworte auf Deutsch, knapp (max. 180 Wörter).
Nutze ausschließlich die gelieferten Fakten und den Quelltext. Kennzeichne Vermutungen ausdrücklich als Vermutung. Erfinde keine Dateien oder Beziehungen. Gib niemals Geheimnisse wieder.`;
  const user = `Repository: ${arch.repo.fullName}
Rollen (vermutet): ${arch.roles.map((r) => `${r.label}: ${r.files} Dateien`).join(', ')}
Ausgewählter Pfad: ${path || '(Wurzel)'}
Fakten aus der statischen Analyse:
${JSON.stringify(facts, null, 1).slice(0, 12_000)}
${content ? `\nQuelltext (Geheimnisse bereits entfernt):\n\`\`\`\n${content}\n\`\`\`` : ''}

Frage: ${q}`;
  try {
    const res = await client.beta.messages.create({
      model: ctx.config.anthropic.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw unavailable('ai_refusal', 'Die Frage wurde abgelehnt.');
    const answer = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return { answer, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw unavailable('ai_auth', 'Claude API: Schlüssel ungültig.');
    if (e instanceof Anthropic.RateLimitError) throw unavailable('ai_rate_limited', 'Claude API: Rate-Limit erreicht.');
    if (e instanceof Anthropic.APIError) throw unavailable('ai_error', `Claude API Fehler ${e.status ?? ''}`);
    throw e;
  }
}
