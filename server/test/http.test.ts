import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { client, loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { INGEST_SCHEMA_ID } from '@shared/ingest';

let env: TestEnv;
afterEach(() => env?.cleanup());

describe('authentication & security', () => {
  it('requires the setup code for the first account and allows setup only once', async () => {
    env = await makeEnv();
    const c = client(env.app);
    expect((await c.get('/api/auth/state')).json.setupRequired).toBe(true);
    expect((await c.post('/api/auth/setup', { setupCode: 'WRONG', email: 'a@b.de', displayName: 'X', password: 'correct-horse-battery' })).status).toBe(403);
    expect((await c.post('/api/auth/setup', { setupCode: 'TESTCODE', email: 'a@b.de', displayName: 'X', password: 'kurz' })).status).toBe(400);
    expect((await c.post('/api/auth/setup', { setupCode: 'TESTCODE', email: 'a@b.de', displayName: 'X', password: 'correct-horse-battery' })).status).toBe(201);
    const again = client(env.app);
    expect((await again.post('/api/auth/setup', { setupCode: 'TESTCODE', email: 'c@d.de', displayName: 'Y', password: 'correct-horse-battery' })).status).toBe(409);
  });

  it('denies by default, sets secure cookie flags and security headers', async () => {
    env = await makeEnv();
    const anon = client(env.app);
    for (const p of ['/api/dashboard', '/api/nodes', '/api/ideas', '/api/backups', '/api/export', '/api/repos', '/api/conflicts']) {
      expect((await anon.get(p)).status, p).toBe(401);
    }
    const c = client(env.app);
    const r = await c.post('/api/auth/setup', { setupCode: 'TESTCODE', email: 'a@b.de', displayName: 'X', password: 'correct-horse-battery' });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const h = (await c.get('/api/dashboard')).headers;
    expect(h.get('content-security-policy')).toContain("default-src 'self'");
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('cache-control')).toBe('no-store');
  });

  it('enforces the CSRF header on cookie-authenticated writes', async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    const res = await env.app.request('/api/nodes', { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(res.status).toBe(403);
    const cross = await env.app.request('/api/nodes', { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json', 'x-omega-csrf': '1', origin: 'https://evil.example', host: 'localhost' }, body: JSON.stringify({ name: 'X' }) });
    expect(cross.status).toBe(403);
    expect((await c.post('/api/nodes', { name: 'Legit' })).status).toBe(201);
  });

  it('rate-limits login attempts', async () => {
    env = await makeEnv();
    await loggedIn(env.app);
    const c = client(env.app);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await c.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-password' })).status);
    expect(statuses.slice(0, 7).every((s) => s === 401)).toBe(true); // setup already used one login
    expect(statuses).toContain(429);
  });

  it('API tokens work only on ingest endpoints, with scopes, and can be revoked', async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    const t = (await c.post('/api/tokens', { name: 'MCP', scopes: ['ingest'] })).json;
    expect(t.token).toMatch(/^omg_/);
    const listed = (await c.get('/api/tokens')).json;
    expect(JSON.stringify(listed)).not.toContain(t.token); // shown only once
    const bearer = { authorization: `Bearer ${t.token}` };
    const tc = client(env.app);
    expect((await tc.get('/api/ingest/v1/ping', bearer)).status).toBe(200);
    expect((await tc.get('/api/dashboard', bearer)).status).toBe(403);
    expect((await tc.get('/api/ingest/v1/identities', bearer)).status).toBe(403); // needs "read"
    const ev = { schema: INGEST_SCHEMA_ID, events: [{ eventId: 'tok-1', type: 'project.upsert', data: { externalId: 'via-token', name: 'Via Token' } }] };
    const res = await env.app.request('/api/ingest/v1/events', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify(ev) });
    expect(res.status).toBe(200);
    expect((await res.json()).summary.applied).toBe(1);
    await c.del(`/api/tokens/${t.id}`);
    expect((await tc.get('/api/ingest/v1/ping', bearer)).status).toBe(401);
  });

  it('changing the password signs out other sessions', async () => {
    env = await makeEnv();
    const a = await loggedIn(env.app);
    const b = client(env.app);
    await b.post('/api/auth/login', { email: 'owner@example.com', password: 'correct-horse-battery' });
    expect((await b.get('/api/dashboard')).status).toBe(200);
    expect((await a.post('/api/me/password', { current: 'correct-horse-battery', next: 'another-long-password' })).status).toBe(200);
    expect((await b.get('/api/dashboard')).status).toBe(401);
    expect((await a.get('/api/dashboard')).status).toBe(200);
  });
});

describe('app library availability proof', () => {
  it('marks an app available only after a successful check', async () => {
    env = await makeEnv();
    const srv = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const c = await loggedIn(env.app);
    const app = (await c.post('/api/apps', { name: 'Lokale App', kind: 'hosted_web', launchUrl: `http://127.0.0.1:${port}/` })).json;
    expect(app.availability).toBe('unverified');
    const checked = (await c.post(`/api/apps/${app.id}/check`)).json;
    expect(checked.availability).toBe('available');
    srv.close();
    const dead = (await c.post('/api/apps', { name: 'Tot', kind: 'external_url', launchUrl: 'http://127.0.0.1:9/' })).json;
    expect((await c.post(`/api/apps/${dead.id}/check`)).json.availability).toBe('unreachable');
    const metadata = (await c.post('/api/apps', { name: 'Meta', kind: 'external_url', launchUrl: 'http://169.254.169.254/latest' })).json;
    const m = (await c.post(`/api/apps/${metadata.id}/check`)).json;
    expect(m.availability).toBe('unreachable');
    expect(m.lastCheck.error).toMatch(/gesperrt/);
    expect((await c.post('/api/apps', { name: 'XSS', kind: 'external_url', launchUrl: 'javascript:alert(1)' })).status).toBe(400);
    const internal = (await c.post('/api/apps', { name: 'Ideen', kind: 'internal', launchUrl: '/ideas' })).json;
    expect((await c.post(`/api/apps/${internal.id}/check`)).json.availability).toBe('available');
    // changing the launch target invalidates the proof
    const changed = (await c.patch(`/api/apps/${internal.id}`, { launchUrl: '/knowledge' })).json;
    expect(changed.availability).toBe('unverified');
  });
});

describe('export / import', () => {
  it('round-trips administrative data without secrets and never overwrites existing records', async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    const p = (await c.post('/api/nodes', { name: 'Export-Projekt', notes: 'Notiz' })).json;
    await c.put('/api/github/config', { token: 'ghp_shouldNeverBeExported1234567890abcdef' });
    const exp = await c.get('/api/export');
    expect(exp.status).toBe(200);
    const text = JSON.stringify(exp.json);
    expect(text).not.toContain('ghp_shouldNeverBeExported');
    expect(text).not.toContain('password_hash');
    expect(exp.json.data.nodes).toHaveLength(1);

    const other = await makeEnv();
    try {
      const c2 = await loggedIn(other.app);
      const imp = await c2.post('/api/import/export', exp.json);
      expect(imp.status).toBe(200);
      expect(imp.json.report.nodes.inserted).toBe(1);
      const again = await c2.post('/api/import/export', exp.json);
      expect(again.json.report.nodes.existing).toBe(1);
      expect((await c2.get(`/api/nodes/${p.node.id}`)).json.node.notes).toBe('Notiz');
    } finally {
      other.cleanup();
    }
  });
});
