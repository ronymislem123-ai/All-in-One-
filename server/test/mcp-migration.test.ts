import { serve, type ServerType } from '@hono/node-server';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import BetterSqlite3 from 'better-sqlite3';
import { loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { Db, MIGRATIONS, migrate } from '../src/db/database';
import { createBackup } from '../src/modules/backup';
import { sha256 } from '../src/lib/crypto';

describe('MCP server → OMEGA (end-to-end over stdio)', () => {
  let env: TestEnv;
  let server: ServerType;
  let port: number;
  let token: string;
  let mcp: Client;

  beforeAll(async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    token = (await c.post('/api/tokens', { name: 'MCP-Test', scopes: ['ingest', 'read'] })).json.token;
    await new Promise<void>((resolve) => { server = serve({ fetch: env.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => { port = info.port; resolve(); }); });
    mcp = new Client({ name: 'omega-test-client', version: '1.0.0' });
    await mcp.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', join(process.cwd(), 'mcp/src/index.ts')],
      env: { ...process.env, OMEGA_URL: `http://127.0.0.1:${port}`, OMEGA_TOKEN: token } as Record<string, string>,
      stderr: 'pipe',
    }));
  }, 60_000);

  afterAll(async () => {
    await mcp?.close();
    server?.close();
    env?.cleanup();
  });

  const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

  it('lists the OMEGA tools', async () => {
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['omega_status', 'omega_list', 'omega_upsert_project', 'omega_upsert_module', 'omega_report_progress', 'omega_add_idea', 'omega_upsert_doc', 'omega_send_events']));
  });

  it('checks the connection', async () => {
    expect(text(await mcp.callTool({ name: 'omega_status', arguments: {} }))).toMatch(/Verbunden mit OMEGA/);
  });

  it('creates a project, a module and reports progress – idempotently', async () => {
    const r1 = await mcp.callTool({ name: 'omega_upsert_project', arguments: { externalId: 'mcp-demo', name: 'MCP Demo', summary: 'Über MCP angelegt', status: 'in_development' } });
    expect(text(r1)).toMatch(/1 übernommen/);
    const again = await mcp.callTool({ name: 'omega_upsert_project', arguments: { externalId: 'mcp-demo', name: 'MCP Demo', summary: 'Über MCP angelegt', status: 'in_development' } });
    expect(text(again)).toMatch(/1 bereits vorhanden/);
    await mcp.callTool({ name: 'omega_upsert_module', arguments: { externalId: 'mcp-demo/api', parentExternalId: 'mcp-demo', kind: 'module', name: 'API', nature: 'technical', codePath: 'server/src' } });
    const prog = await mcp.callTool({ name: 'omega_report_progress', arguments: { externalId: 'mcp-demo', summary: 'API fertig', progress: 40 } });
    expect(text(prog)).toMatch(/übernommen/);
    const nodes = env.ctx.db.all<{ name: string; progress: number | null; origin: string }>(`SELECT name, progress, origin FROM nodes WHERE deleted_at IS NULL ORDER BY created_at`);
    expect(nodes.map((n) => n.name)).toEqual(['MCP Demo', 'API']);
    expect(nodes[0].progress).toBe(40);
    expect(nodes[0].origin).toBe('claude');
    const list = text(await mcp.callTool({ name: 'omega_list', arguments: {} }));
    expect(list).toContain('externalId "mcp-demo/api"');
  });

  it('streams a live development session into the Werkstatt', async () => {
    const start = text(await mcp.callTool({ name: 'omega_live_start', arguments: { externalId: 'mcp-demo/live', title: 'Live-Demo', state: 'building', milestones: [{ key: 'backend', label: 'Backend' }, { key: 'ui', label: 'Oberfläche' }], tasks: [{ key: 't1', title: 'Routen' }] } }));
    expect(start).toMatch(/gestartet/);
    expect(text(await mcp.callTool({ name: 'omega_live_log', arguments: { sessionId: 'mcp-demo/live', kind: 'decision', title: 'SSE statt WebSocket', body: 'weniger Abhängigkeiten' } }))).toMatch(/1 übernommen/);
    expect(text(await mcp.callTool({ name: 'omega_live_log', arguments: { sessionId: 'mcp-demo/live', kind: 'decision', title: 'SSE statt WebSocket', body: 'weniger Abhängigkeiten' } }))).toMatch(/1 bereits vorhanden/);
    expect(text(await mcp.callTool({ name: 'omega_live_milestone', arguments: { sessionId: 'mcp-demo/live', key: 'backend', progress: 100 } }))).toMatch(/1 übernommen/);
    expect(text(await mcp.callTool({ name: 'omega_live_task', arguments: { sessionId: 'mcp-demo/live', key: 't1', status: 'done' } }))).toMatch(/1 übernommen/);
    expect(text(await mcp.callTool({ name: 'omega_live_preview', arguments: { sessionId: 'mcp-demo/live', url: 'http://localhost:5173/live' } }))).toMatch(/1 übernommen/);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(text(await mcp.callTool({ name: 'omega_live_screenshot', arguments: { sessionId: 'mcp-demo/live', title: 'Startseite', base64: png, mime: 'image/png' } }))).toMatch(/1 übernommen/);
    expect(text(await mcp.callTool({ name: 'omega_live_status', arguments: { sessionId: 'mcp-demo/live', state: 'done', progress: 100 } }))).toMatch(/1 übernommen/);
    const s = env.ctx.db.get<{ state: string; progress: number; preview_url: string }>(`SELECT state, progress, preview_url FROM dev_sessions WHERE external_id = 'mcp-demo/live'`)!;
    expect(s).toEqual({ state: 'done', progress: 100, preview_url: 'http://localhost:5173/live' });
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM dev_events WHERE session_id = (SELECT id FROM dev_sessions WHERE external_id = 'mcp-demo/live')`)!.n).toBe(6);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM dev_media`)!.n).toBe(1);
    const unknown = await mcp.callTool({ name: 'omega_live_log', arguments: { sessionId: 'does-not-exist', kind: 'log', title: 'x' } });
    expect((unknown as { isError?: boolean }).isError).toBe(true);
  });

  it('reports validation problems back to Claude instead of storing bad data', async () => {
    const r = await mcp.callTool({ name: 'omega_send_events', arguments: { events: [{ type: 'project.upsert', data: { externalId: 'x y z', name: '' } }] } });
    expect(text(r)).toMatch(/abgelehnt/);
  });

  it('fails safely when OMEGA is unreachable', async () => {
    const broken = new Client({ name: 'broken', version: '1.0.0' });
    await broken.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', join(process.cwd(), 'mcp/src/index.ts')],
      env: { ...process.env, OMEGA_URL: 'http://127.0.0.1:9', OMEGA_TOKEN: token } as Record<string, string>,
      stderr: 'pipe',
    }));
    const r = await broken.callTool({ name: 'omega_upsert_project', arguments: { externalId: 'never', name: 'Never' } });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toMatch(/nicht erreichbar/);
    await broken.close();
  });
});

describe('database migrations', () => {
  it('upgrades an older database after a safety backup and keeps the data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omega-mig-'));
    try {
      const path = join(dir, 'old.sqlite');
      // build a version-1 database by hand
      const raw = new BetterSqlite3(path);
      raw.exec(MIGRATIONS[0].sql);
      raw.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
      raw.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?, ?)').run(MIGRATIONS[0].name, sha256(MIGRATIONS[0].sql), new Date().toISOString());
      raw.prepare(`INSERT INTO repositories(id, owner, name, full_name, created_at, updated_at) VALUES ('r1', 'o', 'n', 'o/n', 'x', 'x')`).run();
      raw.close();
      const env = await makeEnv({ dbPath: path, backupDir: join(dir, 'backups') });
      try {
        const row = env.ctx.db.get<{ full_name: string; tracked_branch: string | null }>(`SELECT full_name, tracked_branch FROM repositories WHERE id = 'r1'`)!;
        expect(row.full_name).toBe('o/n');
        expect(row.tracked_branch).toBeNull();
        const backups = readdirSync(join(dir, 'backups')).filter((f) => f.includes('pre_migration') && f.endsWith('.sqlite'));
        expect(backups).toHaveLength(1);
      } finally {
        env.cleanup();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to run when an applied migration was modified', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omega-mig2-'));
    try {
      const db = new Db(join(dir, 'x.sqlite'));
      await migrate(db);
      db.run(`UPDATE schema_migrations SET checksum = 'tampered' WHERE id = 1`);
      await expect(migrate(db)).rejects.toThrow(/Prüfsumme/);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates verified backups that open as SQLite', async () => {
    const env = await makeEnv();
    try {
      const m = await createBackup(env.ctx, 'manual');
      const db = new BetterSqlite3(join(env.ctx.config.backupDir, m.name), { readonly: true });
      expect((db.prepare('SELECT MAX(id) v FROM schema_migrations').get() as { v: number }).v).toBe(MIGRATIONS.length);
      db.close();
    } finally {
      env.cleanup();
    }
  });
});
