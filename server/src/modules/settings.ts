import type { Ctx } from '../context';
import { decryptString, encryptString } from '../lib/crypto';
import { parseJson } from '../lib/json';
import { nowIso } from '../lib/time';

// ── System settings (non-secret) ───────────────────────────────────────────
export function getSetting<T>(ctx: Ctx, key: string, fallback: T): T {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? parseJson<T>(row.value, fallback) : fallback;
}
export function setSetting(ctx: Ctx, key: string, value: unknown): void {
  ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [
    key, JSON.stringify(value), nowIso(),
  ]);
}

// ── Secrets (encrypted at rest with AES-256-GCM, never returned to the client) ──
export function setSecret(ctx: Ctx, key: string, value: string | null): void {
  if (!value) {
    ctx.db.run('DELETE FROM secrets WHERE key = ?', [key]);
    return;
  }
  ctx.db.run(
    'INSERT INTO secrets(key, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at',
    [key, encryptString(ctx.config.secretKey, value), `…${value.slice(-4)}`, nowIso()],
  );
}
export function getSecret(ctx: Ctx, key: string): string | null {
  const row = ctx.db.get<{ ciphertext: string }>('SELECT ciphertext FROM secrets WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return decryptString(ctx.config.secretKey, row.ciphertext);
  } catch {
    ctx.log.warn('secret could not be decrypted (key changed?)', { key });
    return null;
  }
}
export function secretInfo(ctx: Ctx, key: string): { stored: boolean; hint: string | null; updatedAt: string | null } {
  const row = ctx.db.get<{ hint: string; updated_at: string }>('SELECT hint, updated_at FROM secrets WHERE key = ?', [key]);
  return { stored: Boolean(row), hint: row?.hint ?? null, updatedAt: row?.updated_at ?? null };
}

// ── GitHub configuration ───────────────────────────────────────────────────
export interface GitHubSettings {
  pollMinutes: number;
  autoDiscover: boolean;
  analyzeOnSync: boolean;
}
export function githubSettings(ctx: Ctx): GitHubSettings {
  return getSetting(ctx, 'github', { pollMinutes: ctx.config.github.defaultPollMinutes, autoDiscover: true, analyzeOnSync: true });
}
export function githubToken(ctx: Ctx): { token: string | null; source: 'env' | 'stored' | null } {
  if (ctx.config.github.envToken) return { token: ctx.config.github.envToken, source: 'env' };
  const stored = getSecret(ctx, 'github_token');
  return { token: stored, source: stored ? 'stored' : null };
}
export function githubWebhookSecret(ctx: Ctx): string | null {
  return ctx.config.github.envWebhookSecret ?? getSecret(ctx, 'github_webhook_secret');
}

// ── Per-user preferences ───────────────────────────────────────────────────
export const DEFAULT_PREFERENCES = {
  theme: 'system' as 'system' | 'dark' | 'light',
  density: 'comfortable' as 'comfortable' | 'compact',
  motion: 'system' as 'system' | 'reduced' | 'full',
  dashboardWidgets: ['welcome', 'stats', 'attention', 'recent', 'activity', 'sync', 'backup', 'favorites', 'recommendations', 'ideas'],
  hiddenWidgets: [] as string[],
  librarySort: 'activity',
  libraryView: 'grid' as 'grid' | 'list' | 'tree',
  explainLevel: 'simple' as 'simple' | 'technical',
  robotEnabled: true,
};
export type Preferences = typeof DEFAULT_PREFERENCES;

export function getPreferences(ctx: Ctx, userId: string): Preferences {
  const rows = ctx.db.all<{ key: string; value: string }>('SELECT key, value FROM preferences WHERE user_id = ?', [userId]);
  const out: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  for (const r of rows) if (r.key in DEFAULT_PREFERENCES) out[r.key] = parseJson(r.value, out[r.key]);
  return out as Preferences;
}
export function setPreferences(ctx: Ctx, userId: string, patch: Partial<Preferences>): Preferences {
  ctx.db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_PREFERENCES) || v === undefined) continue;
      ctx.db.run(
        'INSERT INTO preferences(user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [userId, k, JSON.stringify(v), nowIso()],
      );
    }
  });
  return getPreferences(ctx, userId);
}
