import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ZodError } from 'zod';
import type { Ctx } from './context';
import { SESSION_COOKIE, userByApiToken, userBySession } from './auth/auth';
import { AppError, forbidden, unauthorized } from './lib/errors';
import type { Env } from './http/kit';
import { registerCore } from './http/routes-core';
import { registerDomain } from './http/routes-domain';
import { registerSync } from './http/routes-sync';
import { registerLive } from './http/routes-live';

/** Endpoints reachable without an owner session. Everything else under /api is default-deny. */
const PUBLIC = new Set(['/api/system/health', '/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/auth/logout', '/api/webhooks/github', '/api/ingest/v1/schema', '/api/ingest/v1/live/schema']);
const TOKEN_PREFIX = '/api/ingest/';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export function createApp(ctx: Ctx) {
  const app = new Hono<Env>();

  // ── security headers ─────────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!c.res.headers.get('Content-Security-Policy')) {
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      );
    }
    if (ctx.config.cookieSecure) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  });

  // ── identity resolution ─────────────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const fwd = ctx.config.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    c.set('ip', fwd || incoming?.socket?.remoteAddress || 'local');
    c.set('user', null);
    c.set('authKind', null);
    c.set('scopes', []);
    c.set('tokenName', null);
    const auth = c.req.header('authorization');
    if (auth?.startsWith('Bearer ')) {
      if (!c.req.path.startsWith(TOKEN_PREFIX)) throw forbidden('API-Tokens sind nur für die Ingest-Schnittstelle zugelassen.');
      const t = userByApiToken(ctx, auth.slice(7).trim());
      c.set('user', t.user);
      c.set('authKind', 'token');
      c.set('scopes', t.scopes);
      c.set('tokenName', t.tokenName);
    } else {
      const u = userBySession(ctx, getCookie(c, SESSION_COOKIE));
      if (u) {
        c.set('user', u);
        c.set('authKind', 'session');
        c.set('scopes', ['ingest', 'read']);
      }
    }
    // CSRF: cookie-authenticated state changes need the custom header (cannot be sent cross-site without CORS)
    if (UNSAFE.has(c.req.method) && c.get('authKind') !== 'token' && !c.req.path.startsWith('/api/webhooks/')) {
      if (c.req.header('x-omega-csrf') !== '1') throw forbidden('Fehlender CSRF-Schutz-Header.');
      const origin = c.req.header('origin');
      const host = c.req.header('host');
      if (origin && host && new URL(origin).host !== host && (!ctx.config.publicUrl || new URL(origin).origin !== new URL(ctx.config.publicUrl).origin)) {
        throw forbidden('Ungültige Herkunft der Anfrage.');
      }
    }
    // default deny
    if (!PUBLIC.has(c.req.path) && !c.req.path.startsWith(TOKEN_PREFIX) && c.get('authKind') !== 'session') throw unauthorized();
    await next();
  });

  app.use('/api/*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: () => { throw new AppError(413, 'too_large', 'Anfrage ist zu groß.'); } }));

  registerCore(app, ctx);
  registerDomain(app, ctx);
  registerSync(app, ctx);
  registerLive(app, ctx);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Unbekannter Endpunkt.' } }, 404));

  // ── static web app (production build) with SPA fallback ─────────────────
  const dist = ctx.config.webDistDir;
  if (dist) {
    const index = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : null;
    app.get('*', (c) => {
      const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, '');
      const file = join(dist, rel);
      if (file.startsWith(dist) && rel !== '/' && existsSync(file) && !file.endsWith('/')) {
        try {
          const data = readFileSync(file);
          const immutable = rel.startsWith('/assets/');
          return new Response(new Uint8Array(data), {
            headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
          });
        } catch { /* directory → fall through */ }
      }
      if (!index) return c.text('Web-App nicht gebaut. Bitte `npm run build` ausführen.', 404);
      return c.html(index);
    });
  }

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status as 400);
    }
    if (err instanceof ZodError) {
      return c.json({ error: { code: 'bad_request', message: 'Eingaben sind ungültig.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }, 400);
    }
    ctx.log.error('unhandled error', { path: c.req.path, method: c.req.method, error: err.message, stack: ctx.config.env !== 'production' ? err.stack : undefined });
    return c.json({ error: { code: 'internal', message: 'Interner Fehler. Deine bereits gespeicherten Daten sind nicht betroffen.' } }, 500);
  });

  return app;
}
