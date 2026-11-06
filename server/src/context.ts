import type { AppConfig } from './config';
import { Db } from './db/database';
import type { Logger } from './lib/logger';
import type { Actor } from '@shared/domain';

/**
 * The application context: configuration, database and logger.
 * Services receive the context instead of importing singletons → testable, no hidden global state.
 */
export interface Ctx {
  config: AppConfig;
  db: Db;
  log: Logger;
  /** Called after domain writes so the search index / notifications stay in sync. */
  hooks: {
    onChange?: (entityType: string, entityId: string) => void;
  };
}

/** Who performs a write – used for activity, versions and field provenance. */
export interface WriteMeta {
  actor: Actor;
  /** Optional sync event id that caused the write (for traceability). */
  eventId?: string;
}

export const USER: WriteMeta = { actor: 'user' };
export const SYSTEM: WriteMeta = { actor: 'system' };
