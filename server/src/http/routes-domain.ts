import { z } from 'zod';
import type { Ctx } from '../context';
import { USER } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { sha256 } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { listVersions } from '../modules/activity';
import {
  appInputSchema, checkApp, confirmManually, createApp, listApps, markOpened, purgeApp, requireApp, restoreApp,
  serializeApp, setAppArchived, trashApp, updateApp,
} from '../modules/apps';
import { createCategory, deleteCategory, listCategories, updateCategory } from '../modules/categories';
import {
  buildBrief, convertToProject, createIdea, discover, discoverSchema, ideaInputSchema, ideaListSchema, listIdeas, markSeen,
  purgeIdea, requireIdea, restoreIdea, serializeIdea, similarIdeas, trashIdea, updateIdea, ideaStats,
} from '../modules/ideas';
import { aiStatus, generateIdeas, generateSchema } from '../modules/ideas-ai';
import { articleInput, createArticle, getArticle, listArticles, setVerification } from '../modules/knowledge';
import {
  childrenOf, createNode, listNodes, listTrash, moveNode, nodeCreateSchema, nodeDetail, nodeListSchema, nodeUpdateSchema,
  purgeNode, requireNode, restoreFromTrash, restoreVersion, setArchived, trashNode, updateNode,
} from '../modules/nodes';
import { projectHealth } from '../modules/dashboard';
import { listTags } from '../modules/tags';
import { logActivity } from '../modules/activity';
import { type App, body, query } from './kit';

export function registerDomain(app: App, ctx: Ctx) {
  // ── Nodes (projects, modules, …) ─────────────────────────────────────────
  app.get('/api/nodes', (c) => c.json(listNodes(ctx, query(c, nodeListSchema))));
  app.get('/api/nodes/children', (c) => {
    const parent = c.req.query('parent');
    return c.json(childrenOf(ctx, parent && parent !== 'root' ? parent : null, c.req.query('archived') !== 'exclude'));
  });
  app.post('/api/nodes', async (c) => {
    const row = createNode(ctx, USER, await body(c, nodeCreateSchema));
    return c.json(nodeDetail(ctx, row.id), 201);
  });
  app.get('/api/nodes/:id', (c) => {
    const d = nodeDetail(ctx, c.req.param('id'));
    return c.json({ ...d, health: projectHealth(ctx, requireNode(ctx, d.node.id)) });
  });
  app.patch('/api/nodes/:id', async (c) => {
    updateNode(ctx, USER, c.req.param('id'), await body(c, nodeUpdateSchema));
    return c.json(nodeDetail(ctx, c.req.param('id')));
  });
  app.post('/api/nodes/:id/move', async (c) => {
    const b = await body(c, z.object({ parentId: z.string().nullable(), version: z.number().int().optional() }));
    moveNode(ctx, USER, c.req.param('id'), b.parentId, { expectedVersion: b.version });
    return c.json(nodeDetail(ctx, c.req.param('id')));
  });
  app.post('/api/nodes/:id/archive', async (c) => {
    const b = await body(c, z.object({ archived: z.boolean() }));
    setArchived(ctx, USER, c.req.param('id'), b.archived);
    return c.json(nodeDetail(ctx, c.req.param('id')));
  });
  app.delete('/api/nodes/:id', (c) => c.json(trashNode(ctx, USER, c.req.param('id'), c.req.query('cascade') === '1')));
  app.post('/api/nodes/:id/restore', (c) => {
    restoreFromTrash(ctx, USER, c.req.param('id'));
    return c.json(nodeDetail(ctx, c.req.param('id')));
  });
  app.get('/api/nodes/:id/versions', (c) => {
    requireNode(ctx, c.req.param('id'), true);
    return c.json(listVersions(ctx, 'node', c.req.param('id')));
  });
  app.post('/api/nodes/:id/versions/:version/restore', (c) => {
    restoreVersion(ctx, USER, c.req.param('id'), Number(c.req.param('version')));
    return c.json(nodeDetail(ctx, c.req.param('id')));
  });

  // ── Trash ───────────────────────────────────────────────────────────────
  app.get('/api/trash', (c) => c.json(listTrash(ctx)));
  app.delete('/api/trash/:type/:id', async (c) => {
    const b = await body(c, z.object({ confirm: z.literal('ENDGÜLTIG') }));
    void b;
    const { type, id } = c.req.param();
    if (type === 'node') return c.json({ purged: purgeNode(ctx, USER, id) });
    if (type === 'idea') { purgeIdea(ctx, USER, id); return c.json({ purged: 1 }); }
    if (type === 'application') { purgeApp(ctx, USER, id); return c.json({ purged: 1 }); }
    throw badRequest('Unbekannter Typ.');
  });
  app.post('/api/trash/:type/:id/restore', (c) => {
    const { type, id } = c.req.param();
    if (type === 'node') restoreFromTrash(ctx, USER, id);
    else if (type === 'idea') restoreIdea(ctx, USER, id);
    else if (type === 'application') restoreApp(ctx, USER, id);
    else throw badRequest('Unbekannter Typ.');
    return c.json({ ok: true });
  });

  // ── Applications ────────────────────────────────────────────────────────
  app.get('/api/apps', (c) => {
    const q = query(c, z.object({ q: z.string().optional(), kind: z.string().optional(), availability: z.string().optional(), category: z.string().optional(), favorite: z.enum(['1']).optional(), archived: z.enum(['1']).optional(), nodeId: z.string().optional() }));
    return c.json(listApps(ctx, { ...q, favorite: q.favorite === '1', archived: q.archived === '1' }));
  });
  app.post('/api/apps', async (c) => c.json(serializeApp(createApp(ctx, USER, await body(c, appInputSchema))), 201));
  app.get('/api/apps/:id', (c) => c.json(serializeApp(requireApp(ctx, c.req.param('id')))));
  app.patch('/api/apps/:id', async (c) => c.json(serializeApp(updateApp(ctx, USER, c.req.param('id'), await body(c, appInputSchema.partial())))));
  app.post('/api/apps/:id/check', async (c) => c.json(await checkApp(ctx, USER, c.req.param('id'))));
  app.post('/api/apps/:id/confirm', async (c) => c.json(confirmManually(ctx, USER, c.req.param('id'), (await body(c, z.object({ note: z.string().max(500) }))).note)));
  app.post('/api/apps/:id/opened', (c) => { markOpened(ctx, c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/apps/:id/archive', async (c) => c.json(setAppArchived(ctx, USER, c.req.param('id'), (await body(c, z.object({ archived: z.boolean() }))).archived)));
  app.delete('/api/apps/:id', (c) => { trashApp(ctx, USER, c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/apps/:id/versions', (c) => c.json(listVersions(ctx, 'application', c.req.param('id'))));

  // ── Categories & tags ───────────────────────────────────────────────────
  app.get('/api/categories', (c) => c.json(listCategories(ctx)));
  const catSchema = z.object({ name: z.string().trim().min(1).max(80), parentId: z.string().nullable().optional(), icon: z.string().max(40).optional(), color: z.string().max(20).optional(), description: z.string().max(500).optional() });
  app.post('/api/categories', async (c) => c.json(createCategory(ctx, await body(c, catSchema)), 201));
  app.patch('/api/categories/:id', async (c) => c.json(updateCategory(ctx, c.req.param('id'), await body(c, catSchema.partial().extend({ sortOrder: z.number().int().optional() })))));
  app.delete('/api/categories/:id', (c) => { deleteCategory(ctx, c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/tags', (c) => c.json(listTags(ctx)));

  // ── Ideas ───────────────────────────────────────────────────────────────
  app.get('/api/ideas', (c) => c.json(listIdeas(ctx, query(c, ideaListSchema))));
  app.get('/api/ideas/stats', (c) => c.json({ ...ideaStats(ctx), ai: aiStatus(ctx) }));
  app.get('/api/ideas/discover', (c) => {
    const res = discover(ctx, query(c, discoverSchema));
    markSeen(ctx, res.ideas.map((i) => i.id));
    return c.json(res);
  });
  app.post('/api/ideas/generate', async (c) => c.json(await generateIdeas(ctx, USER, await body(c, generateSchema))));
  app.post('/api/ideas', async (c) => {
    const b = await body(c, ideaInputSchema.extend({ force: z.boolean().optional() }));
    const { force, ...input } = b;
    return c.json(serializeIdea(createIdea(ctx, USER, input, { source: 'manual', force })), 201);
  });
  app.get('/api/ideas/:id', (c) => {
    const id = c.req.param('id');
    markSeen(ctx, [id]);
    return c.json({ idea: serializeIdea(requireIdea(ctx, id)), ...similarIdeas(ctx, id) });
  });
  app.patch('/api/ideas/:id', async (c) => c.json(serializeIdea(updateIdea(ctx, USER, c.req.param('id'), await body(c, ideaInputSchema.partial().extend({ version: z.number().int().optional() }))))));
  app.delete('/api/ideas/:id', (c) => { trashIdea(ctx, USER, c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/ideas/:id/brief', (c) => c.json({ brief: buildBrief(ctx, c.req.param('id'), { projectName: c.req.query('name') || undefined }) }));
  app.post('/api/ideas/:id/convert', async (c) => {
    const b = await body(c, z.object({ name: z.string().max(200).optional(), categoryId: z.string().nullable().optional(), parentId: z.string().nullable().optional() }));
    return c.json(convertToProject(ctx, USER, c.req.param('id'), b), 201);
  });

  // ── Knowledge hub ───────────────────────────────────────────────────────
  app.get('/api/knowledge', (c) => c.json(listArticles(ctx, { topic: c.req.query('topic') || undefined, q: c.req.query('q') || undefined })));
  app.get('/api/knowledge/:slug', (c) => c.json(getArticle(ctx, c.req.param('slug'))));
  app.post('/api/knowledge', async (c) => c.json(createArticle(ctx, USER, await body(c, articleInput)), 201));
  app.post('/api/knowledge/:slug/verification', async (c) => c.json(setVerification(ctx, USER, c.req.param('slug'), (await body(c, z.object({ state: z.enum(['verified', 'outdated', 'unverified']) }))).state)));

  // ── Attachments (screenshots) – stored inside the DB so they are part of every backup ──
  const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  app.post('/api/attachments', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    const entityType = String(form.entityType ?? '');
    const entityId = String(form.entityId ?? '');
    if (!(file instanceof File)) throw badRequest('Datei fehlt.');
    if (!ALLOWED.has(file.type)) throw badRequest('Nur PNG, JPEG, WebP oder GIF.');
    if (file.size > 2 * 1024 * 1024) throw badRequest('Maximal 2 MB pro Bild.');
    if (entityType === 'node') requireNode(ctx, entityId);
    else if (entityType === 'application') requireApp(ctx, entityId);
    else throw badRequest('Unbekannter Bezug.');
    const buf = Buffer.from(await file.arrayBuffer());
    // verify magic bytes – never trust the declared type alone
    const magic = buf.subarray(0, 12).toString('hex');
    const okMagic = magic.startsWith('89504e47') || magic.startsWith('ffd8ff') || magic.startsWith('47494638') || (magic.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
    if (!okMagic) throw badRequest('Dateiinhalt passt nicht zum Bildformat.');
    const id = newId('att');
    ctx.db.write(() => {
      ctx.db.run('INSERT INTO attachments(id, entity_type, entity_id, kind, filename, mime, size, sha256, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id, entityType, entityId, 'screenshot', file.name.slice(0, 200), file.type, buf.length, sha256(buf), buf, nowIso(),
      ]);
      logActivity(ctx, USER, { action: 'attachment.added', summary: `Screenshot „${file.name}“ hinzugefügt`, entityType, entityId });
    });
    return c.json({ id }, 201);
  });
  app.get('/api/attachments/:id', (c) => {
    const a = ctx.db.get<{ mime: string; data: Buffer; filename: string }>('SELECT mime, data, filename FROM attachments WHERE id = ?', [c.req.param('id')]);
    if (!a) throw notFound('Anhang');
    return new Response(new Uint8Array(a.data), { headers: { 'content-type': a.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
  });
  app.delete('/api/attachments/:id', (c) => {
    ctx.db.write(() => ctx.db.run('DELETE FROM attachments WHERE id = ?', [c.req.param('id')]));
    return c.json({ ok: true });
  });
}
