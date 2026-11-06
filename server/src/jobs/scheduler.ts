import type { Ctx } from '../context';
import { scheduledSnapshot } from '../modules/backup';
import { syncAll } from '../modules/github/sync';
import { githubSettings } from '../modules/settings';
import { minutesSince } from '../lib/time';

/**
 * Background jobs: 15-minute backup snapshots (only when data changed) and GitHub polling.
 * Jobs never overlap and failures are recorded (notifications/sync log) instead of crashing the server.
 */
export function startScheduler(ctx: Ctx): () => void {
  const timers: NodeJS.Timeout[] = [];
  let ghRunning = false;
  let bkRunning = false;

  const backupTick = async () => {
    if (bkRunning) return;
    bkRunning = true;
    try {
      const res = await scheduledSnapshot(ctx);
      if (res) ctx.log.info('Zwischenstand gesichert', { name: res.name });
    } catch (e) {
      ctx.log.error('scheduled backup failed', { error: (e as Error).message });
    } finally {
      bkRunning = false;
    }
  };

  const githubTick = async () => {
    if (ghRunning) return;
    const hasRepos = ctx.db.get('SELECT 1 FROM repositories WHERE tracked = 1 LIMIT 1');
    if (!hasRepos) return;
    const last = ctx.db.meta('last_github_sync_at');
    const age = minutesSince(last);
    if (age !== null && age < githubSettings(ctx).pollMinutes) return;
    ghRunning = true;
    try {
      await syncAll(ctx, 'poll');
    } catch (e) {
      ctx.log.warn('github poll failed', { error: (e as Error).message });
    } finally {
      ghRunning = false;
    }
  };

  // first backup check shortly after start, then every interval
  timers.push(setTimeout(backupTick, 20_000));
  timers.push(setInterval(backupTick, ctx.config.backupIntervalMinutes * 60_000));
  timers.push(setTimeout(githubTick, 60_000));
  timers.push(setInterval(githubTick, 60_000));
  timers.forEach((t) => t.unref());
  return () => timers.forEach((t) => clearInterval(t));
}
