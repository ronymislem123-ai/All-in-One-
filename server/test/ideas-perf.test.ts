import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { createNode, listNodes, nodeListSchema, childrenOf } from '../src/modules/nodes';
import { search } from '../src/modules/search';
import { dashboard } from '../src/modules/dashboard';
import { IDEA_DISCOVERY_MODES } from '@shared/domain';

let env: TestEnv;
beforeEach(async () => { env = await makeEnv(); });
afterEach(() => env.cleanup());

describe('AI Idea Hub', () => {
  it('ships the curated library with dynamic categories from the database', async () => {
    const c = await loggedIn(env.app);
    const cats = (await c.get('/api/categories')).json;
    expect(cats.length).toBeGreaterThanOrEqual(30);
    expect(cats.every((x: { children: unknown[] }) => x.children.length >= 2)).toBe(true);
    const ideas = (await c.get('/api/ideas?limit=200')).json;
    expect(ideas.total).toBe(144);
    // categories are data, not code: a new one can be created and used immediately
    const cat = (await c.post('/api/categories', { name: 'Raumfahrt' })).json;
    const idea = await c.post('/api/ideas', { title: 'Satellitenpass-Planer', summary: 'Plant Beobachtungen von Satellitenüberflügen.', categoryId: cat.id });
    expect(idea.status).toBe(201);
    expect((await c.get(`/api/ideas?category=${cat.id}`)).json.total).toBe(1);
  });

  it('filters by effort, scores and full text', async () => {
    const c = await loggedIn(env.app);
    const quick = (await c.get('/api/ideas?effort=xs,s&limit=200')).json;
    expect(quick.total).toBeGreaterThan(10);
    expect(quick.items.every((i: { effort: string }) => ['xs', 's'].includes(i.effort))).toBe(true);
    const top = (await c.get('/api/ideas?minUsefulness=5&limit=200')).json;
    expect(top.items.every((i: { scores: { usefulness: number } }) => i.scores.usefulness === 5)).toBe(true);
    const text = (await c.get('/api/ideas?q=Rechnung')).json;
    expect(text.total).toBeGreaterThan(0);
  });

  it('serves every local discovery mode transparently (no fake AI)', async () => {
    const c = await loggedIn(env.app);
    const project = (await c.post('/api/nodes', { name: 'Trading Journal', summary: 'Trading Tagebuch' })).json;
    const ids = (await c.get('/api/ideas?limit=2')).json.items.map((i: { id: string }) => i.id).join(',');
    for (const m of IDEA_DISCOVERY_MODES) {
      const qs = new URLSearchParams({ mode: m.id, q: 'Familie', projectId: project.node.id, ideaIds: ids, category: 'finance' });
      const r = await c.get(`/api/ideas/discover?${qs}`);
      expect(r.status, m.id).toBe(200);
      expect(r.json.engine).toBe('local-library');
    }
  });

  it('reports AI generation as not configured instead of faking it', async () => {
    const c = await loggedIn(env.app);
    const r = await c.post('/api/ideas/generate', { mode: 'discover' });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('ai_not_configured');
    expect((await c.get('/api/ideas/stats')).json.ai.configured).toBe(false);
  });

  it('warns about near-duplicate ideas and allows explicit variants', async () => {
    const c = await loggedIn(env.app);
    const first = (await c.get('/api/ideas?limit=1&sort=title')).json.items[0];
    const dup = await c.post('/api/ideas', { title: first.title, summary: 'nochmal' });
    expect(dup.status).toBe(409);
    expect(dup.json.error.details.similar[0].id).toBe(first.id);
    const variant = await c.post('/api/ideas', { title: `${first.title} 2.0`, summary: 'Verbessert', parentIdeaId: first.id, variantNote: 'Deutlich verbessert' });
    expect(variant.status).toBe(201);
    expect(variant.json.parentIdeaId).toBe(first.id);
  });

  it('turns an idea into a project with a copyable development brief', async () => {
    const c = await loggedIn(env.app);
    const idea = (await c.get('/api/ideas?limit=1')).json.items[0];
    const res = await c.post(`/api/ideas/${idea.id}/convert`, {});
    expect(res.status).toBe(201);
    expect(res.json.brief).toContain('# Entwicklungsauftrag');
    expect(res.json.brief).toContain('## Funktionsumfang (MVP)');
    expect(res.json.brief).toContain('project.upsert');
    const project = (await c.get(`/api/nodes/${res.json.projectId}`)).json;
    expect(project.node.origin).toBe('idea');
    expect(project.children.some((ch: { kind: string }) => ch.kind === 'documentation')).toBe(true);
    expect(project.sourceIdea.id).toBe(idea.id);
    expect((await c.get(`/api/ideas/${idea.id}`)).json.idea.status).toBe('converted');
    expect((await c.post(`/api/ideas/${idea.id}/convert`, {})).status).toBe(409);
  });
});

describe('performance with large datasets', () => {
  it('stays fast with 600 projects, 3000 modules and full-text search', () => {
    const U = { actor: 'user' as const };
    const t0 = Date.now();
    env.ctx.db.tx(() => {
      for (let i = 0; i < 600; i++) {
        const p = createNode(env.ctx, U, { kind: 'project', name: `Projekt ${i} ${i % 7 === 0 ? 'Analytics' : 'Tool'}`, summary: `Beschreibung ${i}` });
        for (let j = 0; j < 5; j++) createNode(env.ctx, U, { kind: 'module', parentId: p.id, name: `Modul ${i}.${j}` });
      }
    });
    const seedMs = Date.now() - t0;
    const t1 = Date.now();
    const page = listNodes(env.ctx, nodeListSchema.parse({ kinds: 'project', parent: 'root', limit: '60' }));
    const listMs = Date.now() - t1;
    expect(page.total).toBe(600);
    const t2 = Date.now();
    const hits = search(env.ctx, 'Analytics');
    const searchMs = Date.now() - t2;
    expect(hits.hits.length).toBeGreaterThan(10);
    const t3 = Date.now();
    childrenOf(env.ctx, null);
    const treeMs = Date.now() - t3;
    const t4 = Date.now();
    dashboard(env.ctx);
    const dashMs = Date.now() - t4;
    console.log(JSON.stringify({ seedMs, listMs, searchMs, treeMs, dashMs }));
    expect(listMs).toBeLessThan(500);
    expect(searchMs).toBeLessThan(200);
    expect(dashMs).toBeLessThan(1500);
  });
});
