import type { Ctx } from '../../context';
import { hmacSha256, safeEqual, sha256 } from '../../lib/crypto';
import { AppError, unavailable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { githubWebhookSecret } from '../settings';
import { syncRepository } from './sync';

/**
 * GitHub webhook receiver. Signature (X-Hub-Signature-256, HMAC-SHA256) is mandatory; deliveries are
 * idempotent by X-GitHub-Delivery. The webhook only *triggers* a read-only re-sync – it never writes to GitHub.
 */
export async function handleWebhook(ctx: Ctx, headers: { event: string | null; delivery: string | null; signature: string | null }, rawBody: string) {
  const secret = githubWebhookSecret(ctx);
  if (!secret) throw unavailable('webhook_not_configured', 'Webhook-Secret ist nicht eingerichtet.');
  const expected = `sha256=${hmacSha256(secret, rawBody)}`;
  if (!headers.signature || !safeEqual(headers.signature, expected)) throw new AppError(401, 'invalid_signature', 'Ungültige Webhook-Signatur.');
  if (!headers.delivery || !headers.event) throw new AppError(400, 'bad_request', 'Delivery- oder Event-Header fehlt.');

  if (ctx.db.get(`SELECT 1 FROM sync_events WHERE source = 'github' AND event_id = ?`, [headers.delivery])) {
    return { status: 'duplicate' as const };
  }
  let payload: { repository?: { id: number; full_name: string }; action?: string; zen?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new AppError(400, 'bad_request', 'Ungültiges JSON.');
  }
  const repo = payload.repository
    ? ctx.db.get<{ id: string; full_name: string }>('SELECT id, full_name FROM repositories WHERE github_id = ? OR full_name = ?', [payload.repository.id, payload.repository.full_name])
    : undefined;
  const rowId = newId('sev');
  const relevant = Boolean(repo) && ['push', 'repository', 'create', 'delete', 'public', 'release'].includes(headers.event);
  ctx.db.run(
    `INSERT INTO sync_events(id, source, event_id, type, payload, payload_hash, status, target_type, target_id, message, client, received_at, processed_at)
     VALUES (?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, 'github-webhook', ?, ?)`,
    [
      rowId, headers.delivery, `${headers.event}${payload.action ? '.' + payload.action : ''}`,
      JSON.stringify({ repository: payload.repository?.full_name ?? null, action: payload.action ?? null }), sha256(rawBody),
      relevant ? 'applied' : 'duplicate', repo ? 'repository' : null, repo?.id ?? null,
      headers.event === 'ping' ? 'Ping empfangen – Webhook funktioniert' : relevant ? 'Abgleich angestoßen' : 'Nicht relevant oder Repository nicht verfolgt',
      nowIso(), nowIso(),
    ],
  );
  if (relevant && repo) {
    // fire-and-forget: the webhook answers quickly, the sync result is logged separately
    syncRepository(ctx, repo.id).catch((e) => ctx.log.warn('webhook-triggered sync failed', { repo: repo.full_name, error: (e as Error).message }));
  }
  return { status: relevant ? ('accepted' as const) : ('ignored' as const) };
}
