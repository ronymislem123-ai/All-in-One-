import { z } from 'zod';
import type { Ctx } from '../context';
import { USER } from '../context';
import { badRequest } from '../lib/errors';
import { rateLimit } from '../auth/auth';
import { getConflict, listConflicts, resolveConflict, resolveSchema } from '../modules/conflicts';
import { listKnownIdentities, processEnvelope, retryEvent } from '../modules/ingest';
import { listEvents, listRuns } from '../modules/sync-log';
import { exportData, importExport, importFile } from '../modules/transfer';
import { ensureRepository, confirmLink, generateLinkSuggestions, listLinkSuggestions, rejectLink, requireRepo, serializeRepo, unlink } from '../modules/github/repos';
import { analyzeRepository, discoverRepositories, rateLimit as ghRate, syncAll, syncRepository } from '../modules/github/sync';
import { architecture, fileContent, pathDetail, repoGraph, repoOverview, treeChildren } from '../modules/github/explorer';
import { handleWebhook } from '../modules/github/webhook';
import { githubSettings, githubToken, githubWebhookSecret, secretInfo, setSecret, setSetting } from '../modules/settings';
import { logActivity } from '../modules/activity';
import { applyRetention, backupStatus, createBackup, listBackups, projectsInBackup, restoreFull, restoreLog, restoreProject, verifyBackup } from '../modules/backup';
import { INGEST_EXAMPLE, INGEST_SCHEMA_ID } from '@shared/ingest';
import { type App, body, meUser, query, requireScope } from './kit';

export function registerSync(app: App, ctx: Ctx) {
  // ── Claude ingest (session OR Bearer token with scope) ──────────────────
  app.post('/api/ingest/v1/events', requireScope('ingest'), async (c) => {
    rateLimit(ctx, `ingest:${c.get('user')!.id}`, 120, 120);
    const raw = await c.req.json().catch(() => { throw badRequest('Ungültiger JSON-Body.'); });
    const client = c.get('authKind') === 'token' ? `Token „${c.get('tokenName')}“` : 'Website';
    return c.json(processEnvelope(ctx, raw, { trigger: 'api', client }));
  });
  app.get('/api/ingest/v1/ping', requireScope('ingest'), (c) => c.json({ ok: true, schema: INGEST_SCHEMA_ID, user: c.get('user')!.displayName, scopes: c.get('scopes') }));
  app.get('/api/ingest/v1/identities', requireScope('read'), (c) => c.json(listKnownIdentities(ctx)));
  app.get('/api/ingest/v1/schema', (c) => c.json({ schema: INGEST_SCHEMA_ID, example: INGEST_EXAMPLE, docs: '/docs/INTEGRATIONS.md' }));

  // ── Sync center ─────────────────────────────────────────────────────────
  app.get('/api/sync/runs', (c) => c.json(listRuns(ctx, { source: c.req.query('source') || undefined, limit: Number(c.req.query('limit') ?? 50) })));
  app.get('/api/sync/events', (c) => {
    const q = query(c, z.object({ status: z.string().optional(), source: z.string().optional(), q: z.string().optional(), runId: z.string().optional(), limit: z.coerce.number().optional(), offset: z.coerce.number().optional() }));
    return c.json(listEvents(ctx, q));
  });
  app.post('/api/sync/events/:id/retry', (c) => c.json(retryEvent(ctx, c.req.param('id'))));

  // ── Import / export ─────────────────────────────────────────────────────
  app.post('/api/import/file', async (c) => {
    const b = await body(c, z.object({ filename: z.string().min(1).max(200), content: z.string().max(2_000_000), dryRun: z.boolean().optional() }));
    return c.json(importFile(ctx, b.filename, b.content, { dryRun: b.dryRun }));
  });
  app.get('/api/export', (c) => {
    const data = exportData(ctx, { includeActivity: c.req.query('activity') === '1' });
    logActivity(ctx, USER, { action: 'export.created', summary: 'Verwaltungsdaten exportiert' });
    return c.body(JSON.stringify(data, null, 2), 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="omega-export-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  });
  app.post('/api/import/export', async (c) => c.json(await importExport(ctx, USER, await c.req.json().catch(() => null))));

  // ── Conflicts ───────────────────────────────────────────────────────────
  app.get('/api/conflicts', (c) => c.json(listConflicts(ctx, { status: c.req.query('status') ?? 'open', type: c.req.query('type') || undefined })));
  app.get('/api/conflicts/:id', (c) => c.json(getConflict(ctx, c.req.param('id'))));
  app.post('/api/conflicts/:id/resolve', async (c) => c.json(resolveConflict(ctx, USER, c.req.param('id'), await body(c, resolveSchema))));

  // ── GitHub ──────────────────────────────────────────────────────────────
  app.get('/api/github/status', (c) => {
    const t = githubToken(ctx);
    return c.json({
      tokenSource: t.source, tokenInfo: secretInfo(ctx, 'github_token'), envToken: Boolean(ctx.config.github.envToken),
      webhookConfigured: Boolean(githubWebhookSecret(ctx)), webhookSecretInfo: secretInfo(ctx, 'github_webhook_secret'),
      webhookUrl: ctx.config.publicUrl ? `${ctx.config.publicUrl}/api/webhooks/github` : null,
      settings: githubSettings(ctx), rateLimit: ghRate(), apiUrl: ctx.config.github.apiUrl,
      permissions: 'Nur lesend: Metadata (read) und Contents (read). Keine Schreibrechte erforderlich oder genutzt.',
    });
  });
  app.put('/api/github/config', async (c) => {
    const b = await body(c, z.object({
      token: z.string().max(400).nullable().optional(),
      webhookSecret: z.string().min(16).max(200).nullable().optional(),
      pollMinutes: z.number().int().min(5).max(1440).optional(),
      autoDiscover: z.boolean().optional(),
      analyzeOnSync: z.boolean().optional(),
    }));
    if (b.token !== undefined) setSecret(ctx, 'github_token', b.token);
    if (b.webhookSecret !== undefined) setSecret(ctx, 'github_webhook_secret', b.webhookSecret);
    const cur = githubSettings(ctx);
    setSetting(ctx, 'github', { pollMinutes: b.pollMinutes ?? cur.pollMinutes, autoDiscover: b.autoDiscover ?? cur.autoDiscover, analyzeOnSync: b.analyzeOnSync ?? cur.analyzeOnSync });
    logActivity(ctx, USER, { action: 'github.config', summary: `GitHub-Einstellungen geändert${b.token !== undefined ? ' (Token aktualisiert)' : ''}` });
    return c.json({ ok: true });
  });
  app.post('/api/github/discover', async (c) => c.json(await discoverRepositories(ctx)));
  app.post('/api/github/sync', async (c) => c.json(await syncAll(ctx, 'manual')));

  app.get('/api/repos', (c) => {
    const rows = ctx.db.all<Record<string, unknown>>(
      `SELECT r.*, (SELECT COUNT(*) FROM project_repository_links l WHERE l.repository_id = r.id AND l.status = 'confirmed') linked FROM repositories r ORDER BY r.tracked DESC, COALESCE(r.pushed_at, r.created_at) DESC`,
    );
    return c.json(rows.map((r) => ({ ...serializeRepo(r as never), linked: r.linked })));
  });
  app.post('/api/repos', async (c) => {
    const b = await body(c, z.object({ fullName: z.string().trim(), sync: z.boolean().default(true) }));
    const repo = ensureRepository(ctx, b.fullName.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''), 'manual');
    logActivity(ctx, USER, { action: 'repo.added', summary: `Repository ${repo.full_name} zur Beobachtung hinzugefügt (nur lesend)`, entityType: 'repository', entityId: repo.id, entityName: repo.full_name });
    const result = b.sync ? await syncRepository(ctx, repo.id, { analyze: true }) : null;
    generateLinkSuggestions(ctx);
    return c.json({ repo: serializeRepo(requireRepo(ctx, repo.id)), result }, 201);
  });
  app.get('/api/repos/:id', (c) => c.json(repoOverview(ctx, c.req.param('id'))));
  app.patch('/api/repos/:id', async (c) => {
    const b = await body(c, z.object({ tracked: z.boolean() }));
    const repo = requireRepo(ctx, c.req.param('id'));
    ctx.db.write(() => {
      ctx.db.run('UPDATE repositories SET tracked = ? WHERE id = ?', [b.tracked ? 1 : 0, repo.id]);
      logActivity(ctx, USER, { action: 'repo.tracking', summary: `${repo.full_name}: Beobachtung ${b.tracked ? 'aktiviert' : 'pausiert'} (Daten bleiben erhalten)`, entityType: 'repository', entityId: repo.id });
    });
    return c.json(serializeRepo(requireRepo(ctx, repo.id)));
  });
  app.post('/api/repos/:id/sync', async (c) => c.json(await syncRepository(ctx, c.req.param('id'), { force: c.req.query('force') === '1', analyze: true })));
  app.post('/api/repos/:id/analyze', async (c) => c.json(await analyzeRepository(ctx, c.req.param('id'))));
  app.get('/api/repos/:id/tree', (c) => c.json(treeChildren(ctx, c.req.param('id'), c.req.query('path') ?? '')));
  app.get('/api/repos/:id/graph', (c) => c.json(repoGraph(ctx, c.req.param('id'), (c.req.query('expanded') ?? '').split(',').filter(Boolean), { includeTests: c.req.query('tests') === '1' })));
  app.get('/api/repos/:id/architecture', (c) => c.json(architecture(ctx, c.req.param('id'))));
  app.get('/api/repos/:id/path', (c) => c.json(pathDetail(ctx, c.req.param('id'), c.req.query('path') ?? '')));
  app.get('/api/repos/:id/file', async (c) => c.json(await fileContent(ctx, c.req.param('id'), c.req.query('path') ?? '')));

  app.get('/api/link-suggestions', (c) => c.json(listLinkSuggestions(ctx)));
  app.post('/api/nodes/:id/repos', async (c) => {
    const b = await body(c, z.object({ repositoryId: z.string() }));
    confirmLink(ctx, USER, c.req.param('id'), b.repositoryId);
    return c.json({ ok: true });
  });
  app.post('/api/nodes/:id/repos/:repoId/reject', (c) => { rejectLink(ctx, USER, c.req.param('id'), c.req.param('repoId')); return c.json({ ok: true }); });
  app.delete('/api/nodes/:id/repos/:repoId', (c) => { unlink(ctx, USER, c.req.param('id'), c.req.param('repoId')); return c.json({ ok: true }); });

  // ── Webhook (public, signature-verified) ────────────────────────────────
  app.post('/api/webhooks/github', async (c) => {
    rateLimit(ctx, `webhook:${c.get('ip')}`, 120, 120);
    const raw = await c.req.text();
    const res = await handleWebhook(ctx, { event: c.req.header('x-github-event') ?? null, delivery: c.req.header('x-github-delivery') ?? null, signature: c.req.header('x-hub-signature-256') ?? null }, raw);
    return c.json(res, res.status === 'accepted' ? 202 : 200);
  });

  // ── Backups ─────────────────────────────────────────────────────────────
  app.get('/api/backups', (c) => c.json({ status: backupStatus(ctx), backups: listBackups(ctx), restores: restoreLog(ctx).slice(0, 20) }));
  app.post('/api/backups', async (c) => {
    const b = await body(c, z.object({ note: z.string().max(300).optional() }));
    const meta = await createBackup(ctx, 'manual', b.note);
    logActivity(ctx, USER, { action: 'backup.created', summary: `Manuelle Sicherung erstellt: ${meta.name}` });
    return c.json(meta, 201);
  });
  app.post('/api/backups/retention', (c) => c.json({ removed: applyRetention(ctx) }));
  app.post('/api/backups/:name/verify', async (c) => c.json(await verifyBackup(ctx, c.req.param('name'))));
  app.get('/api/backups/:name/projects', async (c) => c.json(await projectsInBackup(ctx, c.req.param('name'))));
  app.post('/api/backups/:name/restore', async (c) => {
    await body(c, z.object({ confirm: z.literal('WIEDERHERSTELLEN') }));
    meUser(c);
    return c.json(await restoreFull(ctx, USER, c.req.param('name')));
  });
  app.post('/api/backups/:name/restore-project', async (c) => {
    const b = await body(c, z.object({ nodeId: z.string(), confirm: z.literal('WIEDERHERSTELLEN') }));
    return c.json(await restoreProject(ctx, USER, c.req.param('name'), b.nodeId));
  });
}
