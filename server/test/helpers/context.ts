import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from '../../src/config';
import { createContext } from '../../src/bootstrap';
import { createApp } from '../../src/app';
import type { Ctx } from '../../src/context';
import { createLogger } from '../../src/lib/logger';

export interface TestEnv {
  ctx: Ctx;
  dir: string;
  app: ReturnType<typeof createApp>;
  cleanup: () => void;
}

export async function makeEnv(overrides: Partial<AppConfig> = {}, env: Record<string, string> = {}): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'omega-test-'));
  const config = loadConfig(
    { NODE_ENV: 'test', OMEGA_DATA_DIR: join(dir, 'data'), OMEGA_BACKUP_DIR: join(dir, 'backups'), OMEGA_SETUP_CODE: 'TESTCODE', OMEGA_WEB_DIST: join(dir, 'no-web'), ...env },
    overrides,
  );
  const ctx = await createContext(config, createLogger('error'));
  const app = createApp(ctx);
  return {
    ctx,
    dir,
    app,
    cleanup: () => {
      try { ctx.db.close(); } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Small HTTP client around app.request() that keeps the session cookie and sends the CSRF header. */
export function client(app: TestEnv['app']) {
  let cookie = '';
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        'x-omega-csrf': '1',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    get: (p: string, h?: Record<string, string>) => req('GET', p, undefined, h),
    post: (p: string, b?: unknown, h?: Record<string, string>) => req('POST', p, b ?? {}, h),
    patch: (p: string, b?: unknown) => req('PATCH', p, b ?? {}),
    put: (p: string, b?: unknown) => req('PUT', p, b ?? {}),
    del: (p: string, b?: unknown) => req('DELETE', p, b),
    raw: req,
    setCookie: (c: string) => { cookie = c; },
    get cookie() { return cookie; },
  };
}

export async function loggedIn(app: TestEnv['app']) {
  const c = client(app);
  const r = await c.post('/api/auth/setup', { setupCode: 'TESTCODE', email: 'owner@example.com', displayName: 'Owner', password: 'correct-horse-battery' });
  if (r.status !== 201) throw new Error(`setup failed: ${JSON.stringify(r.json)}`);
  return c;
}
