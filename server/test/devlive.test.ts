import { afterEach, describe, expect, it } from 'vitest';
import { client, loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { liveListenerCount, subscribeLive } from '../src/modules/devlive';
import { INGEST_SCHEMA_ID } from '@shared/ingest';

let env: TestEnv;
afterEach(() => env?.cleanup());

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function tokenClient(app: TestEnv['app'], scopes = ['ingest', 'read']) {
  const owner = await loggedIn(app);
  const t = await owner.post('/api/tokens', { name: 'claude', scopes });
  expect(t.status).toBe(201);
  const bearer = { authorization: `Bearer ${t.json.token}` };
  const c = client(app);
  return { owner, bearer, c };
}

describe('Werkstatt – live sessions (omega.live/v1)', () => {
  it('creates a session via token, is idempotent per externalId and derives progress from milestones', async () => {
    env = await makeEnv();
    const { owner, bearer, c } = await tokenClient(env.app);
    const first = await c.post('/api/ingest/v1/live/sessions', {
      externalId: 'omega/werkstatt', title: 'Werkstatt bauen', goal: 'Live-Entwicklung sichtbar machen', state: 'building', phase: 'Backend',
      milestones: [{ key: 'db', label: 'Datenbank', progress: 100 }, { key: 'api', label: 'API', progress: 50 }, { key: 'ui', label: 'Oberfläche' }],
      tasks: [{ key: 't1', title: 'Migration', status: 'done' }, { key: 't2', title: 'Routen', status: 'doing' }],
    }, bearer);
    expect(first.status).toBe(201);
    expect(first.json.created).toBe(true);
    expect(first.json.session.progress).toBe(50);
    expect(first.json.session.progressExplicit).toBe(false);
    expect(first.json.session.counts).toEqual({ events: 0, media: 0, tasksDone: 1, tasksTotal: 2 });

    const again = await c.post('/api/ingest/v1/live/sessions', { externalId: 'omega/werkstatt', title: 'Werkstatt bauen', phase: 'Frontend' }, bearer);
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    expect(again.json.session.id).toBe(first.json.session.id);
    expect(again.json.session.phase).toBe('Frontend');
    expect(again.json.session.state).toBe('building');

    const list = await owner.get('/api/live/sessions');
    expect(list.json).toHaveLength(1);
    const detail = await owner.get(`/api/live/sessions/${first.json.session.id}`);
    expect(detail.json.milestones.map((m: { key: string; status: string }) => [m.key, m.status])).toEqual([['db', 'done'], ['api', 'active'], ['ui', 'pending']]);
    expect(detail.json.tasks).toHaveLength(2);
  });

  it('appends events idempotently, updates milestones/tasks/preview/status and stores screenshots', async () => {
    env = await makeEnv();
    const { owner, bearer, c } = await tokenClient(env.app);
    const s = (await c.post('/api/ingest/v1/live/sessions', { externalId: 'demo', title: 'Demo', milestones: [{ key: 'ui', label: 'Oberfläche' }] }, bearer)).json.session;
    const seen: string[] = [];
    const off = subscribeLive(s.id, (m) => seen.push(m.type));
    expect(liveListenerCount(s.id)).toBe(1);

    const res = await c.post(`/api/ingest/v1/live/sessions/demo/events`, {
      events: [
        { eventId: 'e1', kind: 'research', title: 'Codebasis gelesen', body: 'Hono + SQLite' },
        { eventId: 'e2', kind: 'milestone', title: 'Oberfläche halb fertig', milestone: { key: 'ui', progress: 50 } },
        { eventId: 'e3', kind: 'task', title: 'Neue Aufgabe', task: { key: 'a', title: 'Seite bauen', status: 'doing' } },
        { eventId: 'e4', kind: 'preview', title: 'Vorschau läuft', preview: { url: 'http://localhost:5173/live', note: 'Dev-Server' } },
        { eventId: 'e5', kind: 'screenshot', title: 'Erster Screenshot', image: { mime: 'image/png', base64: PNG_1x1, caption: 'Startseite', width: 1, height: 1 } },
        { eventId: 'e6', kind: 'status', title: 'Jetzt testen', status: { state: 'testing', phase: 'QA', now: 'Tests laufen' } },
        { eventId: 'e7', kind: 'milestone', title: 'ohne label', milestone: { key: 'unknown', progress: 10 } },
        { eventId: 'e8', kind: 'screenshot', title: 'fehlt Bild' },
        { kind: 'log', title: 'ohne eventId' },
      ],
    }, bearer);
    expect(res.status).toBe(200);
    expect(res.json.summary).toEqual({ applied: 7, duplicate: 0, rejected: 2 });
    expect(res.json.results[6].status).toBe('rejected');
    expect(res.json.results[6].message).toMatch(/label/);
    expect(res.json.results[7].issues[0].path).toBe('image');
    expect(seen.filter((t) => t === 'event')).toHaveLength(7);
    off();
    expect(liveListenerCount(s.id)).toBe(0);

    // duplicate eventIds are no-ops
    const dup = await c.post(`/api/ingest/v1/live/sessions/${s.id}/events`, { events: [{ eventId: 'e1', kind: 'research', title: 'anders' }] }, bearer);
    expect(dup.json.summary).toEqual({ applied: 0, duplicate: 1, rejected: 0 });

    const d = (await owner.get(`/api/live/sessions/${s.id}`)).json;
    expect(d.session.state).toBe('testing');
    expect(d.session.phase).toBe('QA');
    expect(d.session.now).toBe('Tests laufen');
    expect(d.session.previewUrl).toBe('http://localhost:5173/live');
    expect(d.session.previewNote).toBe('Dev-Server');
    expect(d.session.progress).toBe(50);
    expect(d.milestones[0]).toMatchObject({ key: 'ui', progress: 50, status: 'active' });
    expect(d.tasks[0]).toMatchObject({ key: 'a', title: 'Seite bauen', status: 'doing' });
    expect(d.media).toHaveLength(1);
    expect(d.media[0]).toMatchObject({ mime: 'image/png', size: 70, title: 'Erster Screenshot', caption: 'Startseite' });
    expect(d.session.counts.events).toBe(7);

    const img = await env.app.request(`/api/live/media/${d.media[0].id}`, { headers: { cookie: owner.cookie } });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await img.arrayBuffer()).byteLength).toBe(70);

    // same bytes again → same media row
    await c.post(`/api/ingest/v1/live/sessions/${s.id}/events`, { events: [{ eventId: 'e9', kind: 'screenshot', title: 'nochmal', image: { mime: 'image/png', base64: PNG_1x1 } }] }, bearer);
    expect((await owner.get(`/api/live/sessions/${s.id}`)).json.media).toHaveLength(1);

    // event listing: newest first by default, forward with after=
    const ev = (await owner.get(`/api/live/sessions/${s.id}/events?limit=3`)).json;
    expect(ev.items).toHaveLength(3);
    expect(ev.items[0].kind).toBe('screenshot');
    expect(ev.nextCursor).toBeGreaterThan(0);
    const all = (await owner.get(`/api/live/sessions/${s.id}/events?limit=100`)).json;
    expect(all.items.map((e: { eventId: string | null }) => e.eventId)).toEqual(['e9', null, 'e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
    const e4 = all.items.find((e: { eventId: string | null }) => e.eventId === 'e4');
    const fwd = (await owner.get(`/api/live/sessions/${s.id}/events?after=${e4.id}`)).json;
    expect(fwd.items.map((e: { eventId: string | null }) => e.eventId)).toEqual(['e5', 'e6', null, 'e9']);
    expect(fwd.latestId).toBe(ev.items[0].id);
    const onlyResearch = (await owner.get(`/api/live/sessions/${s.id}/events?kind=research`)).json;
    expect(onlyResearch.items).toHaveLength(1);

    // activity & notification were written
    const act = (await owner.get('/api/activity?entityType=live_session')).json;
    expect(act.items.some((a: { action: string }) => a.action === 'live.session.start')).toBe(true);
    const notif = (await owner.get('/api/notifications')).json;
    expect(notif.items.some((n: { link: string }) => n.link === `/live/${s.id}`)).toBe(true);
  });

  it('keeps the security model: owner session only for reading, tokens only under /api/ingest, scope checks, no project data touched', async () => {
    env = await makeEnv();
    const { owner, bearer, c } = await tokenClient(env.app, ['read']);
    expect((await c.post('/api/ingest/v1/live/sessions', { externalId: 'x', title: 'X' }, bearer)).status).toBe(403); // missing scope "ingest"
    expect((await c.get('/api/live/sessions', bearer)).status).toBe(403); // token outside ingest namespace
    const anon = client(env.app);
    expect((await anon.get('/api/live/sessions')).status).toBe(401);
    expect((await anon.get('/api/ingest/v1/live/schema')).status).toBe(200);
    expect((await anon.post('/api/ingest/v1/live/sessions', { externalId: 'x', title: 'X' })).status).toBe(401);

    // session via owner cookie (the website itself may also write), linked to a Claude project
    await owner.post('/api/ingest/v1/events', { schema: INGEST_SCHEMA_ID, events: [{ eventId: 'p1', type: 'project.upsert', data: { externalId: 'proj', name: 'Projekt A' } }] });
    const s = (await owner.post('/api/ingest/v1/live/sessions', { externalId: 'x', title: 'X', projectExternalId: 'proj', previewUrl: 'ftp://nope' })).json;
    expect(s).toMatchObject({ error: { code: 'bad_request' } });
    const ok = (await owner.post('/api/ingest/v1/live/sessions', { externalId: 'x', title: 'X', projectExternalId: 'proj' })).json;
    expect(ok.session.projectName).toBe('Projekt A');
    const nodes = (await owner.get('/api/nodes')).json;
    const project = (Array.isArray(nodes) ? nodes : nodes.items).find((n: { name: string }) => n.name === 'Projekt A');
    expect(project.progress ?? 0).toBe(0); // live sessions never change project fields

    // owner can end and delete; events of unknown sessions 404
    expect((await owner.post(`/api/live/sessions/${ok.session.id}/end`)).json.state).toBe('done');
    expect((await owner.post('/api/ingest/v1/live/sessions/nope/events', { events: [{ kind: 'log', title: 'x' }] })).status).toBe(404);
    expect((await owner.del(`/api/live/sessions/${ok.session.id}`)).status).toBe(200);
    expect((await owner.get('/api/live/sessions')).json).toHaveLength(0);
  });

  it('migrates existing databases to schema version 3 with a safety backup', async () => {
    env = await makeEnv();
    const owner = await loggedIn(env.app);
    expect((await owner.get('/api/system/health')).json.schemaVersion).toBe(3);
    const applied = env.ctx.db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY id').map((r) => r.name);
    expect(applied).toEqual(['001_init', '002_tracked_branch', '003_dev_live']);
  });
});
