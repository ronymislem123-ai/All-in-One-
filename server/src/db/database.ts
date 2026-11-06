import BetterSqlite3 from 'better-sqlite3';
import { sha256 } from '../lib/crypto';
import { nowIso } from '../lib/time';
import * as m001 from './migrations/001_init';
import * as m002 from './migrations/002_tracked_branch';

export type SqlParams = Record<string, unknown> | unknown[] | undefined;

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** All migrations in order. Never edit an applied migration – add a new one. */
export const MIGRATIONS: Migration[] = [
  { id: 1, name: '001_init', sql: m001.sql },
  { id: 2, name: '002_tracked_branch', sql: m002.sql },
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

function openRaw(path: string, readonly = false): BetterSqlite3.Database {
  const db = new BetterSqlite3(path, { readonly, fileMustExist: readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    // FULL: a commit is only acknowledged once it is durable on disk (§13.1 event-based saving).
    db.pragma('synchronous = FULL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Thin wrapper around better-sqlite3. Holds the connection so that a full restore can
 * swap the underlying database file without restarting the process.
 */
export class Db {
  private conn: BetterSqlite3.Database;
  private cache = new Map<string, BetterSqlite3.Statement>();

  constructor(public readonly path: string) {
    this.conn = openRaw(path);
  }

  get raw(): BetterSqlite3.Database {
    return this.conn;
  }

  private stmt(sql: string): BetterSqlite3.Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.conn.prepare(sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T = Record<string, unknown>>(sql: string, params?: SqlParams): T[] {
    const s = this.stmt(sql);
    return (params === undefined ? s.all() : Array.isArray(params) ? s.all(...params) : s.all(params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params?: SqlParams): T | undefined {
    const s = this.stmt(sql);
    return (params === undefined ? s.get() : Array.isArray(params) ? s.get(...params) : s.get(params)) as T | undefined;
  }

  run(sql: string, params?: SqlParams): BetterSqlite3.RunResult {
    const s = this.stmt(sql);
    return params === undefined ? s.run() : Array.isArray(params) ? s.run(...params) : s.run(params);
  }

  exec(sql: string): void {
    this.conn.exec(sql);
  }

  /** Runs fn in a transaction (nested calls become savepoints). */
  tx<T>(fn: () => T): T {
    return this.conn.transaction(fn)();
  }

  /** Domain write: transaction + bump of the data version used by the snapshot scheduler. */
  write<T>(fn: () => T): T {
    return this.tx(() => {
      const result = fn();
      this.run(
        `INSERT INTO meta(key, value) VALUES ('data_version', '1')
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
      );
      this.run(
        `INSERT INTO meta(key, value) VALUES ('data_changed_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [nowIso()],
      );
      return result;
    });
  }

  meta(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  /** Consistent online backup to a file (uses SQLite's backup API). */
  async backupTo(file: string): Promise<void> {
    await this.conn.backup(file);
  }

  checkpoint(): void {
    this.conn.pragma('wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.cache.clear();
    if (this.conn.open) this.conn.close();
  }

  /** Re-open the connection (after the file was replaced by a restore). */
  reopen(): void {
    this.close();
    this.conn = openRaw(this.path);
  }

  integrityCheck(): string {
    return (this.conn.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
  }
}

export function openReadonly(path: string): BetterSqlite3.Database {
  return openRaw(path, true);
}

export interface MigrationReport {
  applied: string[];
  fromVersion: number;
  toVersion: number;
}

/**
 * Applies pending migrations inside a transaction each. Applied migrations are checksummed so that
 * accidental edits of historical migrations are detected instead of silently diverging.
 * `beforeApply` is called once before the first pending migration (used to create a safety backup).
 */
export async function migrate(db: Db, beforeApply?: (pending: Migration[], fromVersion: number) => Promise<void>): Promise<MigrationReport> {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = db.all<{ id: number; name: string; checksum: string }>('SELECT id, name, checksum FROM schema_migrations ORDER BY id');
  for (const a of applied) {
    const m = MIGRATIONS.find((x) => x.id === a.id);
    if (!m) throw new Error(`Datenbank hat unbekannte Migration ${a.id} (${a.name}) – neuere Version der Daten? Abbruch zum Schutz der Daten.`);
    if (sha256(m.sql) !== a.checksum) throw new Error(`Migration ${a.name} wurde nach dem Anwenden verändert (Prüfsumme). Abbruch.`);
  }
  const fromVersion = applied.length ? applied[applied.length - 1].id : 0;
  const pending = MIGRATIONS.filter((m) => m.id > fromVersion);
  if (pending.length && beforeApply && fromVersion > 0) await beforeApply(pending, fromVersion);
  for (const m of pending) {
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations(id, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [m.id, m.name, sha256(m.sql), nowIso()]);
    });
  }
  return { applied: pending.map((m) => m.name), fromVersion, toVersion: SCHEMA_VERSION };
}
