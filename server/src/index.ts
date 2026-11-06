import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { createContext } from './bootstrap';
import { createApp } from './app';
import { hasUser, setupCode } from './auth/auth';
import { startScheduler } from './jobs/scheduler';
import { createBackup } from './modules/backup';

const config = loadConfig();
const ctx = await createContext(config);
const app = createApp(ctx);

if (!hasUser(ctx)) setupCode(ctx); // logs the one-time setup code
if (config.secretKeySource === 'file') ctx.log.info('Geheimnis-Schlüssel aus data/.secret-key (für Produktion OMEGA_SECRET_KEY setzen)');
if (!config.backupPassphrase) ctx.log.warn('Backups sind unverschlüsselt – OMEGA_BACKUP_PASSPHRASE setzen, um sie zu verschlüsseln.');

const stop = config.schedulerEnabled ? startScheduler(ctx) : () => undefined;
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  ctx.log.info(`OMEGA Infinity läuft auf http://${info.address}:${info.port}`, { env: config.env, web: Boolean(config.webDistDir) });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  ctx.log.info(`Beende (${signal}) …`);
  stop();
  server.close();
  try {
    const changed = (ctx.db.meta('data_version') ?? '0') !== (ctx.db.meta('last_backup_data_version') ?? '');
    if (changed) await createBackup(ctx, 'snapshot', 'Sicherung beim Herunterfahren');
  } catch (e) {
    ctx.log.error('shutdown backup failed', { error: (e as Error).message });
  }
  ctx.db.checkpoint();
  ctx.db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
