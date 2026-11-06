import type { AppConfig } from './config';
import type { Ctx } from './context';
import { Db, migrate } from './db/database';
import { createLogger, type Logger } from './lib/logger';
import { createBackup } from './modules/backup';
import { seedCategories } from './modules/categories';
import { seedIdeas } from './modules/ideas';
import { seedKnowledge } from './modules/knowledge';
import { rebuildSearchIndex, reindex } from './modules/search';

/** Opens the database, applies migrations (with a safety backup first) and seeds reference content. */
export async function createContext(config: AppConfig, log: Logger = createLogger(config.env === 'test' ? 'warn' : 'info')): Promise<Ctx> {
  const db = new Db(config.dbPath);
  const ctx: Ctx = { config, db, log, hooks: {} };
  const report = await migrate(db, async (pending, from) => {
    log.info('Sicherung vor Migration', { from, pending: pending.map((p) => p.name) });
    await createBackup(ctx, 'pre_migration', `Vor Migration von Version ${from} auf ${pending[pending.length - 1].id}`);
  });
  if (report.applied.length) log.info('Migrationen angewendet', report);
  ctx.hooks.onChange = (type, id) => {
    try { reindex(ctx, type, id); } catch (e) { log.warn('search reindex failed', { type, id, error: (e as Error).message }); }
  };
  const cats = seedCategories(ctx);
  const ideas = seedIdeas(ctx);
  const articles = seedKnowledge(ctx);
  if (cats || ideas || articles || !db.get('SELECT 1 FROM search_index LIMIT 1')) {
    const n = rebuildSearchIndex(ctx);
    log.info('Referenzinhalte geprüft', { categories: cats, ideas, articles, indexed: n });
  }
  return ctx;
}
