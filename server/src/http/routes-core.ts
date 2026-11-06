import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Ctx } from '../context';
import {
  SESSION_COOKIE, changePassword, createApiToken, hasUser, listApiTokens, listSessions, login, logout, revokeApiToken,
  revokeSession, setupOwner,
} from '../auth/auth';
import { listActivity } from '../modules/activity';
import { dashboard, integrationsStatus, qualityIssues } from '../modules/dashboard';
import { listNotifications, markRead } from '../modules/notifications';
import { search } from '../modules/search';
import { getPreferences, setPreferences } from '../modules/settings';
import { SCHEMA_VERSION } from '../db/database';
import { type App, body, meUser, query } from './kit';

export function registerCore(app: App, ctx: Ctx) {
  // ── public ────────────────────────────────────────────────────────────────
  app.get('/api/system/health', (c) => c.json({ ok: true, service: 'omega-infinity', schemaVersion: SCHEMA_VERSION }));

  app.get('/api/auth/state', (c) => {
    const u = c.get('user');
    return c.json({ setupRequired: !hasUser(ctx), authenticated: Boolean(u && c.get('authKind') === 'session'), user: u ? { id: u.id, email: u.email, displayName: u.displayName } : null });
  });

  const cookieOpts = () => ({ httpOnly: true, sameSite: 'Strict' as const, secure: ctx.config.cookieSecure, path: '/', maxAge: 30 * 86400 });

  app.post('/api/auth/setup', async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    await setupOwner(ctx, raw);
    const { token, user } = await login(ctx, { email: (raw as { email: string }).email, password: (raw as { password: string }).password }, { ip: c.get('ip'), userAgent: c.req.header('user-agent') ?? null });
    setCookie(c, SESSION_COOKIE, token, cookieOpts());
    return c.json({ user }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const { token, user } = await login(ctx, await c.req.json().catch(() => ({})), { ip: c.get('ip'), userAgent: c.req.header('user-agent') ?? null });
    setCookie(c, SESSION_COOKIE, token, cookieOpts());
    return c.json({ user });
  });

  app.post('/api/auth/logout', (c) => {
    logout(ctx, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ── authenticated ───────────────────────────────────────────────────────
  // all routes below are protected by the global default-deny guard in app.ts (owner session required)
  app.get('/api/me/sessions', (c) => {
    const u = meUser(c);
    return c.json(listSessions(ctx, u.id, u.sessionId ?? ''));
  });
  app.delete('/api/me/sessions/:id', (c) => {
    revokeSession(ctx, meUser(c).id, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/me/password', async (c) => {
    const u = meUser(c);
    await changePassword(ctx, u.id, u.sessionId ?? '', await c.req.json().catch(() => ({})));
    return c.json({ ok: true });
  });

  app.get('/api/tokens', (c) => c.json(listApiTokens(ctx, meUser(c).id)));
  app.post('/api/tokens', async (c) => c.json(createApiToken(ctx, meUser(c).id, await c.req.json().catch(() => ({}))), 201));
  app.delete('/api/tokens/:id', (c) => {
    revokeApiToken(ctx, meUser(c).id, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/preferences', (c) => c.json(getPreferences(ctx, meUser(c).id)));
  app.put('/api/preferences', async (c) => c.json(setPreferences(ctx, meUser(c).id, await body(c, z.record(z.string(), z.unknown())) as never)));

  app.get('/api/dashboard', (c) => c.json(dashboard(ctx)));
  app.get('/api/quality', (c) => c.json(qualityIssues(ctx)));
  app.get('/api/integrations', (c) => c.json(integrationsStatus(ctx)));

  app.get('/api/search', (c) => {
    const q = query(c, z.object({ q: z.string().max(200).default(''), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
    return c.json(search(ctx, q.q, { types: q.types?.split(',').filter(Boolean), limit: q.limit }));
  });

  app.get('/api/activity', (c) => {
    const q = query(c, z.object({
      actor: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), projectId: z.string().optional(),
      q: z.string().max(200).optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional(),
    }));
    return c.json(listActivity(ctx, q));
  });

  app.get('/api/notifications', (c) => c.json(listNotifications(ctx)));
  app.post('/api/notifications/read-all', (c) => {
    markRead(ctx);
    return c.json({ ok: true });
  });
  app.post('/api/notifications/:id/read', (c) => {
    markRead(ctx, c.req.param('id'));
    return c.json({ ok: true });
  });
}
