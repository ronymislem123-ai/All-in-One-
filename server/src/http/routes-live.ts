import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import type { Ctx } from '../context';
import { USER } from '../context';
import { badRequest } from '../lib/errors';
import { rateLimit } from '../auth/auth';
import {
  appendLiveEvents, deleteLiveSession, endLiveSession, getLiveMedia, getLiveSession, listLiveEvents, listLiveSessions, subscribeLive, upsertLiveSession,
} from '../modules/devlive';
import { LIVE_SCHEMA_ID, liveEventsEnvelope } from '@shared/devlive';
import { type App, meUser, query, requireScope } from './kit';

/** Werkstatt (omega.live/v1): Claude writes through the ingest namespace (token scope "ingest"), the owner reads with a session. */
export function registerLive(app: App, ctx: Ctx) {
  // ── Claude → OMEGA ──────────────────────────────────────────────────────
  app.post('/api/ingest/v1/live/sessions', requireScope('ingest'), async (c) => {
    rateLimit(ctx, `live:${c.get('user')!.id}`, 300, 300);
    const raw = await c.req.json().catch(() => { throw badRequest('Ungültiger JSON-Body.'); });
    const client = c.get('authKind') === 'token' ? `Token „${c.get('tokenName')}“` : 'Website';
    const r = upsertLiveSession(ctx, raw, { client });
    return c.json(r, r.created ? 201 : 200);
  });
  app.post('/api/ingest/v1/live/sessions/:id/events', requireScope('ingest'), async (c) => {
    rateLimit(ctx, `live:${c.get('user')!.id}`, 300, 300);
    const raw = await c.req.json().catch(() => { throw badRequest('Ungültiger JSON-Body.'); });
    const env = liveEventsEnvelope.safeParse(raw);
    if (!env.success) throw badRequest('Umschlag ist ungültig (erwartet { events: [...] }).', env.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return c.json({ schema: LIVE_SCHEMA_ID, ...appendLiveEvents(ctx, c.req.param('id'), env.data.events) });
  });
  app.get('/api/ingest/v1/live/sessions/:id', requireScope('read'), (c) => c.json(getLiveSession(ctx, c.req.param('id'))));
  app.get('/api/ingest/v1/live/schema', (c) => c.json({ schema: LIVE_SCHEMA_ID, docs: '/docs/INTEGRATIONS.md#live' }));

  // ── Owner (session) ─────────────────────────────────────────────────────
  app.get('/api/live/sessions', (c) => c.json(listLiveSessions(ctx, Number(c.req.query('limit') ?? 50))));
  app.get('/api/live/sessions/:id', (c) => c.json(getLiveSession(ctx, c.req.param('id'))));
  app.get('/api/live/sessions/:id/events', (c) => {
    const q = query(c, z.object({ after: z.coerce.number().int().optional(), before: z.coerce.number().int().optional(), kind: z.string().max(40).optional(), limit: z.coerce.number().int().optional() }));
    return c.json(listLiveEvents(ctx, c.req.param('id'), q));
  });
  app.post('/api/live/sessions/:id/end', (c) => { meUser(c); return c.json(endLiveSession(ctx, USER, c.req.param('id'))); });
  app.delete('/api/live/sessions/:id', (c) => { meUser(c); deleteLiveSession(ctx, USER, c.req.param('id')); return c.json({ ok: true }); });

  app.get('/api/live/media/:id', (c) => {
    const m = getLiveMedia(ctx, c.req.param('id'));
    return new Response(new Uint8Array(m.data), { headers: { 'content-type': m.mime, 'content-length': String(m.size), etag: `"${m.sha256.slice(0, 32)}"`, 'x-content-type-options': 'nosniff' } });
  });

  /** Server-Sent Events: one message per new event ("event"), session change ("session") or deletion ("deleted"); keep-alive every 25 s. */
  app.get('/api/live/sessions/:id/stream', (c) => {
    const { session } = getLiveSession(ctx, c.req.param('id'));
    return streamSSE(c, async (stream) => {
      let id = 0;
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ sessionId: session.id, state: session.state }), id: String(id++) });
      let closed = false;
      const unsubscribe = subscribeLive(session.id, (msg) => {
        if (closed) return;
        void stream.writeSSE({ event: msg.type, data: JSON.stringify(msg), id: String(id++) }).catch(() => { closed = true; });
      });
      const keepAlive = setInterval(() => { if (!closed) void stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => { closed = true; }); }, 25_000);
      stream.onAbort(() => { closed = true; });
      try {
        while (!closed) await stream.sleep(1000);
      } finally {
        clearInterval(keepAlive);
        unsubscribe();
      }
    });
  });
}
