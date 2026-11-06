import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  publicUrl: string | null;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  backupExternalDir: string | null;
  /** Passphrase for encrypting backups (OMEGA_BACKUP_PASSPHRASE). Null = unencrypted (shown as warning). */
  backupPassphrase: string | null;
  backupIntervalMinutes: number;
  /** Key for encrypting secrets stored in the DB (GitHub token etc.). */
  secretKey: Buffer;
  secretKeySource: 'env' | 'file';
  cookieSecure: boolean;
  trustProxy: boolean;
  setupCode: string | null;
  schedulerEnabled: boolean;
  webDistDir: string | null;
  github: {
    apiUrl: string;
    envToken: string | null;
    envWebhookSecret: string | null;
    defaultPollMinutes: number;
  };
  anthropic: {
    apiKeyConfigured: boolean;
    model: string;
  };
  appCheck: {
    /** Allow availability checks against private network addresses (localhost apps etc.). */
    allowPrivateHosts: boolean;
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function loadSecretKey(dataDir: string, envValue: string | undefined): { key: Buffer; source: 'env' | 'file' } {
  if (envValue) {
    // accept base64/hex of 32 bytes or any passphrase (hashed to 32 bytes)
    const b64 = Buffer.from(envValue, 'base64');
    if (b64.length === 32) return { key: b64, source: 'env' };
    if (/^[0-9a-f]{64}$/i.test(envValue)) return { key: Buffer.from(envValue, 'hex'), source: 'env' };
    return { key: createHash('sha256').update(envValue).digest(), source: 'env' };
  }
  const file = join(dataDir, '.secret-key');
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  return { key: Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'), source: 'file' };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as AppConfig['env'];
  const dataDir = resolve(overrides.dataDir ?? env.OMEGA_DATA_DIR ?? './data');
  mkdirSync(dataDir, { recursive: true });
  const backupDir = resolve(overrides.backupDir ?? env.OMEGA_BACKUP_DIR ?? join(dataDir, '..', 'backups'));
  mkdirSync(backupDir, { recursive: true });
  const publicUrl = env.OMEGA_PUBLIC_URL?.replace(/\/$/, '') || null;
  const { key, source } = loadSecretKey(dataDir, env.OMEGA_SECRET_KEY);
  const webDist = resolve(env.OMEGA_WEB_DIST ?? './dist/web');

  return {
    env: nodeEnv,
    host: env.OMEGA_HOST ?? '127.0.0.1',
    port: num(env.OMEGA_PORT, 4317),
    publicUrl,
    dataDir,
    dbPath: join(dataDir, 'omega.sqlite'),
    backupDir,
    backupExternalDir: env.OMEGA_BACKUP_EXTERNAL_DIR ? resolve(env.OMEGA_BACKUP_EXTERNAL_DIR) : null,
    backupPassphrase: env.OMEGA_BACKUP_PASSPHRASE || null,
    backupIntervalMinutes: Math.max(1, num(env.OMEGA_BACKUP_INTERVAL_MINUTES, 15)),
    secretKey: key,
    secretKeySource: source,
    cookieSecure: bool(env.OMEGA_COOKIE_SECURE, publicUrl?.startsWith('https://') ?? false),
    trustProxy: bool(env.OMEGA_TRUST_PROXY, false),
    setupCode: env.OMEGA_SETUP_CODE || null,
    schedulerEnabled: bool(env.OMEGA_SCHEDULER, nodeEnv !== 'test'),
    webDistDir: existsSync(webDist) ? webDist : null,
    github: {
      apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, ''),
      envToken: env.GITHUB_TOKEN || null,
      envWebhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
      defaultPollMinutes: Math.max(5, num(env.GITHUB_POLL_MINUTES, 30)),
    },
    anthropic: {
      apiKeyConfigured: Boolean(env.ANTHROPIC_API_KEY),
      model: env.OMEGA_CLAUDE_MODEL || 'claude-opus-5-5',
    },
    appCheck: { allowPrivateHosts: bool(env.OMEGA_APPCHECK_ALLOW_PRIVATE, true) },
    ...overrides,
  };
}
