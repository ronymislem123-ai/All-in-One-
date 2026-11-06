import { z } from 'zod';
import type { Ctx } from '../context';
import { hashPassword, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, tooMany, unauthorized } from '../lib/errors';
import { newId } from '../lib/ids';
import { addMinutes, nowIso } from '../lib/time';
import { logActivity } from '../modules/activity';
import { API_TOKEN_SCOPES, type ApiTokenScope } from '@shared/domain';

export const SESSION_COOKIE = 'omega_session';
const SESSION_DAYS = 30;

export interface AuthUser { id: string; email: string; displayName: string; role: 'owner' }

// ── Setup code (protects the very first account creation) ──────────────────
let generatedSetupCode: string | null = null;

/** Returns the one-time setup code: OMEGA_SETUP_CODE if configured, otherwise generated and logged once. */
export function setupCode(ctx: Ctx): string {
  if (ctx.config.setupCode) return ctx.config.setupCode;
  if (!generatedSetupCode) {
    generatedSetupCode = randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase();
    ctx.log.info(`Ersteinrichtung: Einrichtungscode ${generatedSetupCode} (nur in diesem Server-Log sichtbar)`);
  }
  return generatedSetupCode;
}

export function hasUser(ctx: Ctx): boolean {
  return Boolean(ctx.db.get('SELECT 1 FROM users LIMIT 1'));
}

// ── Rate limiting (in-memory token bucket per key) ─────────────────────────
const limiterState = new WeakMap<Ctx, Map<string, { tokens: number; updated: number }>>();
export function rateLimit(ctx: Ctx, key: string, capacity: number, refillPerMinute: number): void {
  let buckets = limiterState.get(ctx);
  if (!buckets) { buckets = new Map(); limiterState.set(ctx, buckets); }
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 60_000) * refillPerMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw tooMany();
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) buckets.clear();
}

const passwordSchema = z.string().min(10, 'Passwort: mindestens 10 Zeichen').max(200);

export const setupSchema = z.object({
  setupCode: z.string().min(1),
  email: z.string().email().max(200),
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
});

export async function setupOwner(ctx: Ctx, raw: unknown): Promise<AuthUser> {
  const input = setupSchema.parse(raw);
  if (hasUser(ctx)) throw conflict('Die Ersteinrichtung ist bereits abgeschlossen.');
  if (!safeEqual(input.setupCode.trim().toUpperCase(), setupCode(ctx).toUpperCase())) throw forbidden('Einrichtungscode ist falsch.');
  const id = newId('usr');
  const now = nowIso();
  const hash = await hashPassword(input.password);
  ctx.db.write(() => {
    ctx.db.run('INSERT INTO users(id, email, display_name, password_hash, role, created_at, updated_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id, input.email, input.displayName, hash, 'owner', now, now, now,
    ]);
    logActivity(ctx, { actor: 'system' }, { action: 'auth.setup', summary: `Ersteinrichtung abgeschlossen – Willkommen, ${input.displayName}!` });
  });
  generatedSetupCode = null;
  return { id, email: input.email, displayName: input.displayName, role: 'owner' };
}

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export async function login(ctx: Ctx, raw: unknown, meta: { ip: string; userAgent: string | null }): Promise<{ user: AuthUser; token: string }> {
  const input = loginSchema.parse(raw);
  rateLimit(ctx, `login:${meta.ip}`, 8, 4);
  rateLimit(ctx, `login-user:${input.email.toLowerCase()}`, 8, 4);
  const row = ctx.db.get<{ id: string; email: string; display_name: string; password_hash: string }>('SELECT * FROM users WHERE email = ?', [input.email]);
  // constant-ish work even for unknown users
  const ok = row ? await verifyPassword(input.password, row.password_hash) : (await hashPassword(input.password), false);
  if (!row || !ok) throw new AppError(401, 'invalid_credentials', 'E-Mail oder Passwort ist falsch.');
  const token = randomToken(32);
  const now = nowIso();
  ctx.db.run('INSERT INTO sessions(id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    newId('ses'), sha256(token), row.id, now, now, addMinutes(now, SESSION_DAYS * 1440), meta.userAgent?.slice(0, 300) ?? null, meta.ip,
  ]);
  ctx.db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  return { user: { id: row.id, email: row.email, displayName: row.display_name, role: 'owner' }, token };
}

export function userBySession(ctx: Ctx, token: string | undefined): (AuthUser & { sessionId: string }) | null {
  if (!token) return null;
  const row = ctx.db.get<{ sid: string; id: string; email: string; display_name: string; expires_at: string; last_seen_at: string }>(
    `SELECT s.id sid, s.expires_at, s.last_seen_at, u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row || row.expires_at < nowIso()) return null;
  // sliding expiry, written at most every 10 minutes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60_000) {
    const now = nowIso();
    ctx.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now, addMinutes(now, SESSION_DAYS * 1440), row.sid]);
  }
  return { id: row.id, email: row.email, displayName: row.display_name, role: 'owner', sessionId: row.sid };
}

export function logout(ctx: Ctx, token: string | undefined): void {
  if (token) ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export function listSessions(ctx: Ctx, userId: string, currentSessionId: string) {
  return ctx.db
    .all<{ id: string; created_at: string; last_seen_at: string; expires_at: string; user_agent: string | null; ip: string | null }>(
      'SELECT id, created_at, last_seen_at, expires_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
      [userId],
    )
    .map((s) => ({ ...s, current: s.id === currentSessionId }));
}

export function revokeSession(ctx: Ctx, userId: string, id: string): void {
  const r = ctx.db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r.changes) throw notFound('Sitzung');
}

export async function changePassword(ctx: Ctx, userId: string, sessionId: string, raw: unknown): Promise<void> {
  const input = z.object({ current: z.string().min(1), next: passwordSchema }).parse(raw);
  const row = ctx.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!row || !(await verifyPassword(input.current, row.password_hash))) throw badRequest('Aktuelles Passwort ist falsch.');
  const now = nowIso();
  const hash = await hashPassword(input.next);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', [hash, now, now, userId]);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, sessionId]); // sign out other devices
    logActivity(ctx, { actor: 'user' }, { action: 'auth.password', summary: 'Passwort geändert – andere Sitzungen wurden abgemeldet' });
  });
}

// ── API tokens (Bearer) for MCP / scripts ──────────────────────────────────
export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export function createApiToken(ctx: Ctx, userId: string, raw: unknown) {
  const input = tokenCreateSchema.parse(raw);
  const token = `omg_${randomToken(32)}`;
  const id = newId('tok');
  const now = nowIso();
  ctx.db.run('INSERT INTO api_tokens(id, user_id, name, token_hash, token_hint, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id, userId, input.name, sha256(token), token.slice(-4), JSON.stringify(input.scopes), now,
    input.expiresInDays ? addMinutes(now, input.expiresInDays * 1440) : null,
  ]);
  logActivity(ctx, { actor: 'user' }, { action: 'token.created', summary: `API-Token „${input.name}“ erstellt (${input.scopes.join(', ')})` });
  // the plain token is shown exactly once
  return { id, name: input.name, scopes: input.scopes, token, hint: token.slice(-4) };
}

export function listApiTokens(ctx: Ctx, userId: string) {
  return ctx.db
    .all<{ id: string; name: string; token_hint: string; scopes: string; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null }>(
      'SELECT id, name, token_hint, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
    )
    .map((t) => ({ ...t, scopes: JSON.parse(t.scopes) as string[] }));
}

export function revokeApiToken(ctx: Ctx, userId: string, id: string): void {
  const r = ctx.db.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [nowIso(), id, userId]);
  if (!r.changes) throw notFound('Token');
  logActivity(ctx, { actor: 'user' }, { action: 'token.revoked', summary: 'API-Token widerrufen' });
}

export function userByApiToken(ctx: Ctx, token: string): { user: AuthUser; scopes: ApiTokenScope[]; tokenId: string; tokenName: string } {
  const row = ctx.db.get<{ id: string; name: string; scopes: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; user_id: string; email: string; display_name: string }>(
    `SELECT t.id, t.name, t.scopes, t.expires_at, t.revoked_at, t.last_used_at, u.id user_id, u.email, u.display_name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    [sha256(token)],
  );
  if (!row || row.revoked_at || (row.expires_at && row.expires_at < nowIso())) throw unauthorized('API-Token ungültig, abgelaufen oder widerrufen.');
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    ctx.db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  }
  return { user: { id: row.user_id, email: row.email, displayName: row.display_name, role: 'owner' }, scopes: JSON.parse(row.scopes), tokenId: row.id, tokenName: row.name };
}
