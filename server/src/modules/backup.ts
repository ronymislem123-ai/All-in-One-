import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AppConfig } from '../config';
import type { Ctx, WriteMeta } from '../context';
import { decryptBuffer, encryptBuffer, isEncryptedBackup, sha256 } from '../lib/crypto';
import { badRequest, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { fileStamp, nowIso } from '../lib/time';
import { migrate, openReadonly, SCHEMA_VERSION } from '../db/database';
import { logActivity } from './activity';
import { notify } from './notifications';
import { rebuildSearchIndex } from './search';

export type BackupKind = 'snapshot' | 'manual' | 'pre_restore' | 'pre_migration' | 'pre_import';
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  snapshot: 'Automatischer Zwischenstand',
  manual: 'Manuelle Sicherung',
  pre_restore: 'Sicherung vor Wiederherstellung',
  pre_migration: 'Sicherung vor Migration',
  pre_import: 'Sicherung vor Import',
};

export interface BackupMeta {
  name: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  sha256: string;
  encrypted: boolean;
  schemaVersion: number;
  dataVersion: string | null;
  counts: Record<string, number>;
  note: string | null;
  verified: { at: string; ok: boolean; detail: string } | null;
  external: { copied: boolean; path: string | null; error: string | null } | null;
}

const COUNT_QUERIES: Record<string, string> = {
  nodes: 'SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL',
  projects: `SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL AND kind = 'project'`,
  ideas: 'SELECT COUNT(*) c FROM ideas WHERE deleted_at IS NULL',
  apps: 'SELECT COUNT(*) c FROM applications WHERE deleted_at IS NULL',
  repositories: 'SELECT COUNT(*) c FROM repositories',
  syncEvents: 'SELECT COUNT(*) c FROM sync_events',
  openConflicts: `SELECT COUNT(*) c FROM conflicts WHERE status = 'open'`,
  activity: 'SELECT COUNT(*) c FROM activity',
};

let lastScheduledAt: string | null = null;
let busy = false;

const sidecar = (dir: string, name: string) => join(dir, `${name}.json`);
function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Removes an SQLite file together with possible -wal/-shm/-journal companions. */
function removeSqliteFile(path: string): void {
  for (const ext of ['', '-wal', '-shm', '-journal']) rmSync(path + ext, { force: true });
}

/** Opens a backup copy for inspection (decrypts to a temp file if needed). Caller must cleanup(). */
async function materialize(ctx: Ctx, name: string): Promise<{ path: string; cleanup: () => void }> {
  const file = join(ctx.config.backupDir, name);
  if (!existsSync(file) || name.includes('/') || name.includes('..')) throw notFound('Sicherung');
  const head = readFileSync(file).subarray(0, 8);
  if (!isEncryptedBackup(head)) return { path: file, cleanup: () => undefined };
  if (!ctx.config.backupPassphrase) throw badRequest('Sicherung ist verschlüsselt, aber OMEGA_BACKUP_PASSPHRASE ist nicht gesetzt.');
  const plain = await decryptBuffer(ctx.config.backupPassphrase, readFileSync(file));
  const tmp = join(ctx.config.backupDir, `.inspect-${newId('tmp')}.sqlite`);
  writeFileSync(tmp, plain, { mode: 0o600 });
  return { path: tmp, cleanup: () => removeSqliteFile(tmp) };
}

function inspectSqlite(path: string): { ok: boolean; detail: string; counts: Record<string, number>; schemaVersion: number } {
  const db = openReadonly(path);
  try {
    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    const counts: Record<string, number> = {};
    for (const [k, q] of Object.entries(COUNT_QUERIES)) {
      try { counts[k] = (db.prepare(q).get() as { c: number }).c; } catch { counts[k] = -1; }
    }
    let schemaVersion = 0;
    try { schemaVersion = (db.prepare('SELECT MAX(id) v FROM schema_migrations').get() as { v: number }).v ?? 0; } catch { /* very old */ }
    return { ok: integrity === 'ok', detail: integrity === 'ok' ? 'Integritätsprüfung bestanden' : `Integritätsprüfung: ${integrity}`, counts, schemaVersion };
  } finally {
    db.close();
  }
}

/**
 * Creates a verified backup: SQLite online backup → integrity check → optional AES-256-GCM encryption →
 * checksum → sidecar metadata → optional copy to an independent external directory → retention.
 */
export async function createBackup(ctx: Ctx, kind: BackupKind, note?: string): Promise<BackupMeta> {
  const dir = ctx.config.backupDir;
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${newId('bk')}.sqlite`);
  try {
    ctx.db.checkpoint();
    await ctx.db.backupTo(tmp);
    const check = inspectSqlite(tmp);
    if (!check.ok) throw new Error(`Frische Sicherung fehlerhaft: ${check.detail}`);
    const encrypted = Boolean(ctx.config.backupPassphrase);
    const name = `omega-${fileStamp()}-${kind}-${newId('b').slice(-6).toLowerCase()}.sqlite${encrypted ? '.enc' : ''}`;
    const final = join(dir, name);
    if (encrypted) {
      writeAtomic(final, await encryptBuffer(ctx.config.backupPassphrase!, readFileSync(tmp)));
      removeSqliteFile(tmp);
    } else {
      renameSync(tmp, final);
      removeSqliteFile(tmp);
    }
    const buf = readFileSync(final);
    const meta: BackupMeta = {
      name, kind, createdAt: nowIso(), size: buf.length, sha256: sha256(buf), encrypted, schemaVersion: check.schemaVersion,
      dataVersion: ctx.db.meta('data_version'), counts: check.counts, note: note ?? null,
      verified: { at: nowIso(), ok: true, detail: check.detail }, external: null,
    };
    if (ctx.config.backupExternalDir) {
      try {
        mkdirSync(ctx.config.backupExternalDir, { recursive: true });
        copyFileSync(final, join(ctx.config.backupExternalDir, name));
        const copy = readFileSync(join(ctx.config.backupExternalDir, name));
        if (sha256(copy) !== meta.sha256) throw new Error('Prüfsumme der externen Kopie weicht ab');
        meta.external = { copied: true, path: ctx.config.backupExternalDir, error: null };
      } catch (e) {
        meta.external = { copied: false, path: ctx.config.backupExternalDir, error: (e as Error).message };
        notify(ctx, { level: 'warning', title: 'Externe Backup-Kopie fehlgeschlagen', body: (e as Error).message, link: '/backups', dedupeKey: 'backup-external' });
      }
    }
    writeAtomic(sidecar(dir, name), JSON.stringify(meta, null, 2));
    if (meta.external?.copied) copyFileSync(sidecar(dir, name), join(ctx.config.backupExternalDir!, `${name}.json`));
    ctx.db.setMeta('last_backup_at', meta.createdAt);
    ctx.db.setMeta('last_backup_data_version', meta.dataVersion ?? '0');
    ctx.db.run(`UPDATE notifications SET read_at = ? WHERE dedupe_key = 'backup-failed' AND read_at IS NULL`, [nowIso()]);
    applyRetention(ctx);
    return meta;
  } catch (e) {
    removeSqliteFile(tmp);
    ctx.db.setMeta('last_backup_error', `${nowIso()} ${(e as Error).message}`);
    notify(ctx, { level: 'error', title: 'Datensicherung fehlgeschlagen', body: (e as Error).message, link: '/backups', dedupeKey: 'backup-failed' });
    ctx.log.error('backup failed', { error: (e as Error).message });
    throw e;
  }
}

export function listBackups(ctx: Ctx): BackupMeta[] {
  const dir = ctx.config.backupDir;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^omega-.*\.sqlite(\.enc)?$/.test(f));
  return files
    .map((f) => {
      const side = sidecar(dir, f);
      if (existsSync(side)) return parseJson<BackupMeta>(readFileSync(side, 'utf8'), null as unknown as BackupMeta);
      const st = statSync(join(dir, f));
      return {
        name: f, kind: 'manual', createdAt: st.mtime.toISOString(), size: st.size, sha256: '', encrypted: f.endsWith('.enc'),
        schemaVersion: 0, dataVersion: null, counts: {}, note: 'Ohne Metadaten gefunden', verified: null, external: null,
      } as BackupMeta;
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function verifyBackup(ctx: Ctx, name: string): Promise<BackupMeta> {
  const metas = listBackups(ctx);
  const meta = metas.find((m) => m.name === name);
  if (!meta) throw notFound('Sicherung');
  const buf = readFileSync(join(ctx.config.backupDir, name));
  let verified: BackupMeta['verified'];
  if (meta.sha256 && sha256(buf) !== meta.sha256) {
    verified = { at: nowIso(), ok: false, detail: 'Prüfsumme stimmt nicht überein – Datei verändert oder beschädigt' };
  } else {
    const m = await materialize(ctx, name);
    try {
      const r = inspectSqlite(m.path);
      verified = { at: nowIso(), ok: r.ok, detail: r.detail };
      meta.counts = r.counts;
    } catch (e) {
      verified = { at: nowIso(), ok: false, detail: `Nicht lesbar: ${(e as Error).message}` };
    } finally {
      m.cleanup();
    }
  }
  meta.verified = verified;
  writeAtomic(sidecar(ctx.config.backupDir, name), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Retention: everything from the last 24 h, then one per day for 30 days and one per week for 12 weeks.
 * Safety backups (manual / pre_*) are kept 90 days. The newest verified backup is never deleted.
 */
export function applyRetention(ctx: Ctx, now = Date.now()): string[] {
  const all = listBackups(ctx);
  const keep = new Set<string>();
  const newestOk = all.find((b) => b.verified?.ok);
  if (newestOk) keep.add(newestOk.name);
  const daily = new Set<string>();
  const weekly = new Set<string>();
  for (const b of all) {
    const age = (now - new Date(b.createdAt).getTime()) / 3_600_000;
    if (age <= 24) { keep.add(b.name); continue; }
    if (b.kind !== 'snapshot' && age <= 90 * 24) { keep.add(b.name); continue; }
    const day = b.createdAt.slice(0, 10);
    if (age <= 30 * 24 && !daily.has(day)) { daily.add(day); keep.add(b.name); continue; }
    const d = new Date(b.createdAt);
    const week = `${d.getUTCFullYear()}-${Math.floor((d.getTime() / 86_400_000 + 4) / 7)}`;
    if (age <= 84 * 24 && !weekly.has(week)) { weekly.add(week); keep.add(b.name); continue; }
  }
  const removed: string[] = [];
  for (const b of all) {
    if (keep.has(b.name)) continue;
    rmSync(join(ctx.config.backupDir, b.name), { force: true });
    rmSync(sidecar(ctx.config.backupDir, b.name), { force: true });
    removed.push(b.name);
  }
  return removed;
}

// ── Restore ────────────────────────────────────────────────────────────────
interface RestoreLogEntry { id: string; at: string; type: 'full' | 'project'; backup: string; preRestoreBackup: string | null; ok: boolean; detail: string }
const restoreLogFile = (ctx: Ctx) => join(ctx.config.backupDir, 'restore-log.json');
export function restoreLog(ctx: Ctx): RestoreLogEntry[] {
  return existsSync(restoreLogFile(ctx)) ? parseJson<RestoreLogEntry[]>(readFileSync(restoreLogFile(ctx), 'utf8'), []) : [];
}
function appendRestoreLog(ctx: Ctx, e: RestoreLogEntry) {
  writeAtomic(restoreLogFile(ctx), JSON.stringify([e, ...restoreLog(ctx)].slice(0, 200), null, 2));
}

/**
 * Full restore: verify the chosen backup → create a pre-restore backup → swap the database file →
 * migrate if the backup is older → verify the live database. On failure the pre-restore state is put back.
 */
export async function restoreFull(ctx: Ctx, meta: WriteMeta, name: string): Promise<RestoreLogEntry> {
  if (busy) throw badRequest('Es läuft bereits eine Sicherung oder Wiederherstellung.');
  busy = true;
  const logEntry: RestoreLogEntry = { id: newId('rst'), at: nowIso(), type: 'full', backup: name, preRestoreBackup: null, ok: false, detail: '' };
  const m = await materialize(ctx, name).catch((e) => { busy = false; throw e; });
  try {
    const check = inspectSqlite(m.path);
    if (!check.ok) throw badRequest(`Sicherung ist beschädigt: ${check.detail}`);
    if (check.schemaVersion > SCHEMA_VERSION) throw badRequest('Sicherung stammt aus einer neueren Programmversion.');
    const pre = await createBackup(ctx, 'pre_restore', `Automatisch vor Wiederherstellung von ${name}`);
    logEntry.preRestoreBackup = pre.name;
    const dbPath = ctx.db.path;
    // Access data (accounts, sessions, tokens, secrets, settings) is not project data: it is carried over so a
    // restore never locks the owner out or revives revoked tokens.
    const keepTables = ['users', 'sessions', 'api_tokens', 'secrets', 'settings', 'preferences'];
    const kept = Object.fromEntries(keepTables.map((t) => [t, ctx.db.all<Record<string, unknown>>(`SELECT * FROM ${t}`)]));
    const staging = `${dbPath}.restore-${process.pid}`;
    copyFileSync(m.path, staging);
    ctx.db.close();
    try {
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      renameSync(staging, dbPath);
      ctx.db.reopen();
      await migrate(ctx.db);
      ctx.db.tx(() => {
        for (const t of [...keepTables].reverse()) ctx.db.run(`DELETE FROM ${t}`);
        for (const t of keepTables) {
          for (const row of kept[t]) {
            const cols = Object.keys(row);
            ctx.db.run(`INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
          }
        }
      });
      const live = ctx.db.integrityCheck();
      if (live !== 'ok') throw new Error(`Integritätsprüfung nach Wiederherstellung: ${live}`);
      rebuildSearchIndex(ctx);
    } catch (e) {
      // roll back to the pre-restore state
      ctx.db.close();
      const back = await materialize(ctx, pre.name);
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      copyFileSync(back.path, dbPath);
      back.cleanup();
      ctx.db.reopen();
      throw new Error(`Wiederherstellung fehlgeschlagen und rückgängig gemacht: ${(e as Error).message}`);
    }
    logEntry.ok = true;
    logEntry.detail = `Datenbank auf Stand ${name} zurückgesetzt (${Object.entries(check.counts).map(([k, v]) => `${k}: ${v}`).join(', ')})`;
    logActivity(ctx, meta, { action: 'backup.restored', summary: `Vollständige Wiederherstellung aus ${name}. Vorheriger Stand gesichert als ${pre.name}.` });
    notify(ctx, { level: 'success', title: 'Wiederherstellung abgeschlossen', body: logEntry.detail, link: '/backups' });
    return logEntry;
  } catch (e) {
    logEntry.detail = (e as Error).message;
    throw e;
  } finally {
    m.cleanup();
    appendRestoreLog(ctx, logEntry);
    ctx.db.setMeta('last_restore', JSON.stringify(logEntry));
    busy = false;
  }
}

export async function projectsInBackup(ctx: Ctx, name: string) {
  const m = await materialize(ctx, name);
  try {
    const db = openReadonly(m.path);
    try {
      return db
        .prepare(
          `SELECT n.id, n.name, n.kind, n.updated_at, n.deleted_at,
             (WITH RECURSIVE d(id) AS (SELECT n.id UNION ALL SELECT c.id FROM nodes c JOIN d ON c.parent_id = d.id) SELECT COUNT(*) - 1 FROM d) descendants
           FROM nodes n WHERE n.kind = 'project' ORDER BY n.name`,
        )
        .all() as { id: string; name: string; kind: string; updated_at: string; deleted_at: string | null; descendants: number }[];
    } finally {
      db.close();
    }
  } finally {
    m.cleanup();
  }
}

/** Restores one project subtree from a backup into the live database (after a safety backup). */
export async function restoreProject(ctx: Ctx, meta: WriteMeta, name: string, nodeId: string): Promise<RestoreLogEntry> {
  const logEntry: RestoreLogEntry = { id: newId('rst'), at: nowIso(), type: 'project', backup: name, preRestoreBackup: null, ok: false, detail: '' };
  const m = await materialize(ctx, name);
  try {
    const src = openReadonly(m.path);
    let rows: Record<string, unknown>[];
    let tags: { tag_name: string; entity_id: string }[];
    let identities: Record<string, unknown>[];
    try {
      rows = src.prepare(`WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM nodes c JOIN d ON c.parent_id = d.id) SELECT n.* FROM nodes n JOIN d ON d.id = n.id`).all(nodeId) as Record<string, unknown>[];
      if (!rows.length) throw notFound('Projekt in dieser Sicherung');
      const ids = rows.map((r) => r.id as string);
      const ph = ids.map(() => '?').join(',');
      tags = src.prepare(`SELECT t.name tag_name, et.entity_id FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'node' AND et.entity_id IN (${ph})`).all(...ids) as never;
      identities = src.prepare(`SELECT * FROM external_identities WHERE entity_type = 'node' AND entity_id IN (${ph})`).all(...ids) as Record<string, unknown>[];
    } finally {
      src.close();
    }
    const pre = await createBackup(ctx, 'pre_restore', `Automatisch vor Projektwiederherstellung aus ${name}`);
    logEntry.preRestoreBackup = pre.name;
    const columns = ctx.db.all<{ name: string }>('PRAGMA table_info(nodes)').map((c) => c.name);
    const ids = new Set(rows.map((r) => r.id as string));
    ctx.db.write(() => {
      // parents first so that foreign keys hold
      const ordered: Record<string, unknown>[] = [];
      const placed = new Set<string>();
      let guard = 0;
      while (ordered.length < rows.length && guard++ < 10000) {
        for (const r of rows) {
          if (placed.has(r.id as string)) continue;
          const parent = r.parent_id as string | null;
          if (!parent || !ids.has(parent) || placed.has(parent)) { ordered.push(r); placed.add(r.id as string); }
        }
      }
      for (const r of ordered) {
        const parent = r.parent_id as string | null;
        const parentOk = !parent || ids.has(parent) || ctx.db.get('SELECT 1 FROM nodes WHERE id = ?', [parent]);
        const values = columns.map((c) => {
          if (c === 'deleted_at') return null;
          if (c === 'parent_id') return parentOk ? parent : null;
          if (c === 'review_state' && !parentOk) return 'unassigned';
          if (c === 'category_id' && r.category_id && !ctx.db.get('SELECT 1 FROM categories WHERE id = ?', [r.category_id])) return null;
          if (c === 'updated_at') return nowIso();
          return c in r ? r[c] : null;
        });
        const exists = ctx.db.get<{ version: number }>('SELECT version FROM nodes WHERE id = ?', [r.id]);
        if (exists) {
          const sets = columns.filter((c) => c !== 'id').map((c) => `${c} = ?`).join(', ');
          ctx.db.run(`UPDATE nodes SET ${sets} WHERE id = ?`, [...values.filter((_, i) => columns[i] !== 'id'), r.id]);
          ctx.db.run('UPDATE nodes SET version = ? WHERE id = ?', [exists.version + 1, r.id]);
        } else {
          ctx.db.run(`INSERT INTO nodes(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
        }
      }
      for (const x of identities) {
        ctx.db.run(
          `INSERT OR IGNORE INTO external_identities(id, source, external_id, entity_type, entity_id, confirmed, first_seen_at, last_seen_at, last_event_id, last_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [x.id, x.source, x.external_id, x.entity_type, x.entity_id, x.confirmed, x.first_seen_at, x.last_seen_at, x.last_event_id, x.last_payload],
        );
      }
      const byNode = new Map<string, string[]>();
      for (const t of tags) byNode.set(t.entity_id, [...(byNode.get(t.entity_id) ?? []), t.tag_name]);
      for (const [nid, names] of byNode) {
        for (const tagName of names) {
          let tag = ctx.db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', [tagName]);
          if (!tag) { tag = { id: newId('tag') }; ctx.db.run('INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)', [tag.id, tagName, nowIso()]); }
          ctx.db.run(`INSERT OR IGNORE INTO entity_tags(tag_id, entity_type, entity_id) VALUES (?, 'node', ?)`, [tag.id, nid]);
        }
      }
      const rootName = String(rows.find((r) => r.id === nodeId)?.name ?? nodeId);
      logActivity(ctx, meta, {
        action: 'backup.project_restored', entityType: 'node', entityId: nodeId, entityName: rootName,
        summary: `Projekt „${rootName}“ (${rows.length} Objekte) aus ${name} wiederhergestellt. Vorheriger Stand gesichert als ${pre.name}.`,
      });
    });
    for (const id of ids) ctx.hooks.onChange?.('node', id);
    logEntry.ok = true;
    logEntry.detail = `${rows.length} Objekte wiederhergestellt`;
    return logEntry;
  } catch (e) {
    logEntry.detail = (e as Error).message;
    throw e;
  } finally {
    m.cleanup();
    appendRestoreLog(ctx, logEntry);
  }
}

// ── Scheduling & status ────────────────────────────────────────────────────
/** Creates a snapshot only if data changed since the last backup (no redundant copies). */
export async function scheduledSnapshot(ctx: Ctx): Promise<BackupMeta | null> {
  lastScheduledAt = nowIso();
  if (busy) return null;
  const current = ctx.db.meta('data_version') ?? '0';
  const last = ctx.db.meta('last_backup_data_version');
  if (last === current && listBackups(ctx).length > 0) return null;
  busy = true;
  try {
    return await createBackup(ctx, 'snapshot', 'Automatischer 15-Minuten-Zwischenstand (nur bei Änderungen)');
  } finally {
    busy = false;
  }
}

export function backupStatus(ctx: Ctx) {
  const list = listBackups(ctx);
  const last = list[0] ?? null;
  const interval = ctx.config.backupIntervalMinutes;
  const lastRestore = parseJson<RestoreLogEntry | null>(ctx.db.meta('last_restore'), null);
  const changedSince = (ctx.db.meta('data_version') ?? '0') !== (ctx.db.meta('last_backup_data_version') ?? '');
  const ageMin = last ? (Date.now() - new Date(last.createdAt).getTime()) / 60_000 : null;
  let health: 'ok' | 'attention' | 'critical' | 'unknown' = 'unknown';
  if (!last) health = 'critical';
  else if (!last.verified?.ok) health = 'critical';
  else if (changedSince && ageMin !== null && ageMin > interval * 2 + 1) health = 'attention';
  else if (ctx.config.backupExternalDir && last.external && !last.external.copied) health = 'attention';
  else health = 'ok';
  return {
    health,
    last,
    count: list.length,
    totalBytes: list.reduce((s, b) => s + b.size, 0),
    intervalMinutes: interval,
    lastScheduledCheckAt: lastScheduledAt,
    nextScheduledAt: lastScheduledAt ? new Date(new Date(lastScheduledAt).getTime() + interval * 60_000).toISOString() : null,
    changedSinceLastBackup: changedSince,
    encryption: Boolean(ctx.config.backupPassphrase),
    external: ctx.config.backupExternalDir ? { configured: true, dir: basename(ctx.config.backupExternalDir) } : { configured: false, dir: null },
    lastError: ctx.db.meta('last_backup_error'),
    lastRestore,
    directory: ctx.config.backupDir,
  };
}

/**
 * Emergency restore for a STOPPED server (e.g. the live database no longer opens).
 * Verifies the backup, moves the current database files aside – they are never deleted – and puts the backup in place.
 * Account data is taken from the backup in this mode (the live database may be unusable).
 */
export async function offlineRestore(config: AppConfig, name: string): Promise<{ restored: string; previous: string | null; counts: Record<string, number> }> {
  const m = await materialize({ config } as Ctx, name);
  try {
    const check = inspectSqlite(m.path);
    if (!check.ok) throw new Error(`Sicherung ist beschädigt: ${check.detail}`);
    if (check.schemaVersion > SCHEMA_VERSION) throw new Error('Sicherung stammt aus einer neueren Programmversion.');
    const db = config.dbPath;
    let previous: string | null = null;
    if (existsSync(db)) {
      previous = `${db}.vor-wiederherstellung-${fileStamp()}`;
      renameSync(db, previous);
      for (const ext of ['-wal', '-shm']) if (existsSync(db + ext)) renameSync(db + ext, previous + ext);
    }
    copyFileSync(m.path, db);
    return { restored: name, previous, counts: check.counts };
  } finally {
    m.cleanup();
  }
}
