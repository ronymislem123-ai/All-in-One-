import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client, loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { startGitHubMock, type MockRepo } from './helpers/github-mock';
import { ensureRepository, generateLinkSuggestions, confirmLink } from '../src/modules/github/repos';
import { syncRepository, syncAll } from '../src/modules/github/sync';
import { architecture, fileContent, pathDetail, repoGraph } from '../src/modules/github/explorer';
import { createNode, getNode, codeStatus, updateNode } from '../src/modules/nodes';
import { listConflicts } from '../src/modules/conflicts';
import { hmacSha256 } from '../src/lib/crypto';
import { redactSecrets, isSecretPath } from '../src/lib/redact';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { hono: '^4', react: '^19' }, devDependencies: { vitest: '^5' } }),
  'tsconfig.json': '{ // comment\n "compilerOptions": { "paths": { "@shared/*": ["./shared/src/*"] } } }',
  'server/src/index.ts': "import { createApp } from './app';\nimport { Hono } from 'hono';\nexport const start = () => createApp();",
  'server/src/app.ts': "import { db } from './db/database';\nimport { STATUS } from '@shared/domain';\nexport function createApp() { return db; }",
  'server/src/db/database.ts': "import fs from 'node:fs';\nexport const db = {};\nexport class Db {}",
  'shared/src/domain.ts': 'export const STATUS = 1;',
  'web/src/main.tsx': "import React from 'react';\nimport { STATUS } from '@shared/domain';\nimport './styles.css';",
  'web/src/styles.css': 'body { color: red }',
  'server/test/app.test.ts': "import { createApp } from '../src/app';",
  '.env': 'SECRET_TOKEN=supersecretvalue123',
  'config/credentials.json': '{"key":"x"}',
  'README.md': '# Demo\nToken: ghp_abcdefghijklmnopqrstuvwxyz0123456789 password = "hunter2hunter2"',
  'py/app.py': 'from .util import helper\nimport requests\ndef handler():\n  pass',
  'py/util.py': 'def helper():\n  return 1',
};

let env: TestEnv;
let gh: Awaited<ReturnType<typeof startGitHubMock>>;
const repoDef: MockRepo = { id: 4242, fullName: 'owner/omega-demo', head: 'sha1', files: FILES };

beforeEach(async () => {
  gh = await startGitHubMock([{ ...repoDef, files: { ...FILES } }, { id: 7, fullName: 'owner/other', head: 'x1', files: { 'a.ts': 'export const a = 1' } }]);
  env = await makeEnv({}, { GITHUB_API_URL: gh.url, GITHUB_WEBHOOK_SECRET: 'webhook-secret-for-tests' });
});
afterEach(async () => { env.cleanup(); await gh.close(); });

describe('GitHub read-only integration', () => {
  it('syncs metadata, tree and commits and analyses the code', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    const res = await syncRepository(env.ctx, repo.id, { analyze: true });
    expect(res.status).toBe('ok');
    expect(res.analyzed).toBe(true);
    const row = env.ctx.db.get<{ github_id: number; file_count: number; head_sha: string }>('SELECT * FROM repositories WHERE id = ?', [repo.id])!;
    expect(row.github_id).toBe(4242);
    expect(row.head_sha).toBe('sha1');
    expect(row.file_count).toBe(Object.keys(FILES).length);
    // only GET requests were ever made
    expect(gh.state.requests.every((r) => r.method === 'GET')).toBe(true);

    const app = env.ctx.db.get<{ imports: string; external_imports: string; exports: string }>(`SELECT * FROM code_files WHERE repo_id = ? AND path = 'server/src/app.ts'`, [repo.id])!;
    expect(JSON.parse(app.imports)).toEqual(expect.arrayContaining(['server/src/db/database.ts', 'shared/src/domain.ts'])); // relative + tsconfig alias
    expect(JSON.parse(app.exports)).toContain('createApp');
    const idx = env.ctx.db.get<{ external_imports: string }>(`SELECT external_imports FROM code_files WHERE repo_id = ? AND path = 'server/src/index.ts'`, [repo.id])!;
    expect(JSON.parse(idx.external_imports)).toContain('hono');
    const py = env.ctx.db.get<{ imports: string; external_imports: string }>(`SELECT * FROM code_files WHERE repo_id = ? AND path = 'py/app.py'`, [repo.id])!;
    expect(JSON.parse(py.imports)).toContain('py/util.py');
    expect(JSON.parse(py.external_imports)).toContain('requests');
    // secrets are excluded from analysis
    const envFile = env.ctx.db.get<{ excluded_reason: string }>(`SELECT excluded_reason FROM code_files WHERE repo_id = ? AND path = '.env'`, [repo.id])!;
    expect(envFile.excluded_reason).toBe('secret');
    const deps = env.ctx.db.all<{ name: string; dev: number }>('SELECT name, dev FROM repo_dependencies WHERE repo_id = ?', [repo.id]);
    expect(deps.map((d) => d.name)).toEqual(expect.arrayContaining(['hono', 'react', 'vitest']));
  });

  it('builds an aggregated dependency graph and explains paths', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: true });
    const g = repoGraph(env.ctx, repo.id, []);
    const names = g.nodes.map((n) => n.path);
    expect(names).toEqual(expect.arrayContaining(['server', 'web', 'shared', 'package.json']));
    expect(g.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'server', to: 'shared', basis: 'erkannt' }), expect.objectContaining({ from: 'web', to: 'shared' })]));
    const expanded = repoGraph(env.ctx, repo.id, ['server', 'server/src']);
    expect(expanded.nodes.map((n) => n.path)).toContain('server/src/app.ts');
    const detail = pathDetail(env.ctx, repo.id, 'shared/src/domain.ts');
    expect(detail.type).toBe('file');
    if (detail.type === 'file') expect(detail.importedBy).toEqual(expect.arrayContaining(['server/src/app.ts', 'web/src/main.tsx']));
    const arch = architecture(env.ctx, repo.id);
    expect(arch.roles.length).toBeGreaterThan(2);
    expect(arch.topFolders.every((f) => f.basis === 'vermutet')).toBe(true);
  });

  it('never serves secret files and redacts secrets in served content', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: false });
    await expect(fileContent(env.ctx, repo.id, '.env')).rejects.toThrow(/Sicherheitsgründen/);
    await expect(fileContent(env.ctx, repo.id, 'config/credentials.json')).rejects.toThrow();
    const readme = await fileContent(env.ctx, repo.id, 'README.md');
    expect(readme.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(readme.text).not.toContain('hunter2hunter2');
    expect(readme.redactions).toBe(2);
    expect(readme.readOnly).toBe(true);
  });

  it('uses ETags so unchanged repositories cost no rate limit', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: false });
    await syncRepository(env.ctx, repo.id, { analyze: false });
    expect(gh.state.etagHits).toBeGreaterThanOrEqual(1);
  });

  it('keeps project, link and data when a repository disappears, and raises a conflict', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: true });
    const p = createNode(env.ctx, { actor: 'user' }, { kind: 'project', name: 'Demo' });
    confirmLink(env.ctx, { actor: 'user' }, p.id, repo.id);
    gh.state.gone.add('owner/omega-demo');
    const res = await syncRepository(env.ctx, repo.id);
    expect(res.status).toBe('not_found');
    expect(getNode(env.ctx, p.id)).toBeDefined();
    expect(env.ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM project_repository_links WHERE status = 'confirmed'`)!.c).toBe(1);
    expect(env.ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM repo_tree WHERE repo_id = ?`, [repo.id])!.c).toBeGreaterThan(0);
    expect(listConflicts(env.ctx, { status: 'open' }).some((c) => c.type === 'repo_unreachable')).toBe(true);
    expect(codeStatus(env.ctx, getNode(env.ctx, p.id)!).status).toBe('unreachable');
  });

  it('follows renames through the stable repository id', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: false });
    const def = gh.state.repos.get('owner/omega-demo')!;
    gh.state.repos.delete('owner/omega-demo');
    def.fullName = 'owner/omega-renamed';
    gh.state.repos.set('owner/omega-renamed', def);
    await syncRepository(env.ctx, repo.id, { analyze: false });
    expect(env.ctx.db.get<{ full_name: string }>('SELECT full_name FROM repositories WHERE id = ?', [repo.id])!.full_name).toBe('owner/omega-renamed');
  });

  it('derives module code status from the real tree', async () => {
    const repo = ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    await syncRepository(env.ctx, repo.id, { analyze: false });
    const p = createNode(env.ctx, { actor: 'user' }, { kind: 'project', name: 'Demo' });
    confirmLink(env.ctx, { actor: 'user' }, p.id, repo.id);
    const ok = createNode(env.ctx, { actor: 'user' }, { kind: 'module', parentId: p.id, name: 'Server', codePath: 'server/src' });
    const missing = createNode(env.ctx, { actor: 'user' }, { kind: 'module', parentId: p.id, name: 'Mobile', codePath: 'mobile/app' });
    expect(codeStatus(env.ctx, ok).status).toBe('detected');
    expect(codeStatus(env.ctx, missing).status).toBe('missing');
    updateNode(env.ctx, { actor: 'user' }, missing.id, { codePath: 'web/src' });
    expect(codeStatus(env.ctx, getNode(env.ctx, missing.id)!).status).toBe('detected');
  });

  it('only suggests links by name and flags ambiguous ones', async () => {
    ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    createNode(env.ctx, { actor: 'user' }, { kind: 'project', name: 'Omega Demo' });
    createNode(env.ctx, { actor: 'user' }, { kind: 'project', name: 'Omega-Demo' });
    const r = generateLinkSuggestions(env.ctx);
    expect(r.suggested).toBe(2);
    expect(r.ambiguous).toBe(1);
    expect(env.ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM project_repository_links WHERE status = 'confirmed'`)!.c).toBe(0);
  });

  it('syncAll processes all tracked repositories and logs a run', async () => {
    ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    ensureRepository(env.ctx, 'owner/other', 'manual');
    const r = await syncAll(env.ctx, 'manual');
    expect(r.ok).toBe(2);
    expect(env.ctx.db.get<{ status: string }>(`SELECT status FROM sync_runs WHERE source = 'github' ORDER BY started_at DESC`)!.status).toBe('succeeded');
  });

  it('verifies webhook signatures and processes deliveries idempotently', async () => {
    ensureRepository(env.ctx, 'owner/omega-demo', 'manual');
    const c = client(env.app);
    const payload = JSON.stringify({ repository: { id: 4242, full_name: 'owner/omega-demo' } });
    const bad = await c.raw('POST', '/api/webhooks/github', undefined, { 'x-github-event': 'push', 'x-github-delivery': 'd-1', 'x-hub-signature-256': 'sha256=deadbeef', 'content-type': 'application/json' });
    expect(bad.status).toBe(401);
    const sig = `sha256=${hmacSha256('webhook-secret-for-tests', payload)}`;
    const send = () => env.app.request('/api/webhooks/github', { method: 'POST', body: payload, headers: { 'x-github-event': 'push', 'x-github-delivery': 'd-2', 'x-hub-signature-256': sig, 'content-type': 'application/json' } });
    const ok = await send();
    expect(ok.status).toBe(202);
    const dup = await send();
    expect((await dup.json()).status).toBe('duplicate');
  });

  it('exposes the explorer over HTTP for the owner only', async () => {
    const anon = client(env.app);
    expect((await anon.get('/api/repos')).status).toBe(401);
    const c = await loggedIn(env.app);
    const add = await c.post('/api/repos', { fullName: 'owner/omega-demo' });
    expect(add.status).toBe(201);
    const graph = await c.get(`/api/repos/${add.json.repo.id}/graph`);
    expect(graph.status).toBe(200);
    expect(graph.json.nodes.length).toBeGreaterThan(3);
    const secret = await c.get(`/api/repos/${add.json.repo.id}/file?path=.env`);
    expect(secret.status).toBe(403);
  });
});

describe('secret redaction', () => {
  it('detects secret paths', () => {
    for (const p of ['.env', 'app/.env.production', 'id_rsa', 'certs/server.pem', '.npmrc', 'deploy/credentials.yml', 'infra/terraform.tfstate']) expect(isSecretPath(p)).toBe(true);
    for (const p of ['.env.example', 'src/env.ts', 'docs/keys.md', 'package.json']) expect(isSecretPath(p)).toBe(false);
  });
  it('redacts token patterns but keeps placeholders', () => {
    const r = redactSecrets('a = "sk-ant-abcdefghijklmnopqrstuvwxyz"\napiKey: "process.env"\npassword = "changeme"\ndb=postgres://user:pa55word@host/db\n-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----');
    expect(r.text).not.toContain('sk-ant-abc');
    expect(r.text).toContain('process.env');
    expect(r.text).toContain('changeme');
    expect(r.text).not.toContain('pa55word');
    expect(r.text).not.toContain('AAA');
    expect(r.redactions).toBe(3);
  });
});
