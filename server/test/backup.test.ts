import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, makeEnv, type TestEnv } from './helpers/context';
import { applyRetention, backupStatus, createBackup, listBackups, projectsInBackup, restoreFull, restoreProject, scheduledSnapshot, verifyBackup } from '../src/modules/backup';
import { createNode, getNode, trashNode, updateNode } from '../src/modules/nodes';
import { isEncryptedBackup } from '../src/lib/crypto';

const U = { actor: 'user' as const };
let env: TestEnv;
afterEach(() => env?.cleanup());

describe('backups', () => {
  it('creates a verified, checksummed backup with metadata sidecar', async () => {
    env = await makeEnv();
    createNode(env.ctx, U, { kind: 'project', name: 'Backup me' });
    const meta = await createBackup(env.ctx, 'manual', 'Test');
    expect(meta.verified?.ok).toBe(true);
    expect(meta.counts.projects).toBe(1);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(env.ctx.config.backupDir, `${meta.name}.json`))).toBe(true);
    expect(listBackups(env.ctx)[0].name).toBe(meta.name);
  });

  it('only snapshots when data changed (no redundant copies)', async () => {
    env = await makeEnv();
    createNode(env.ctx, U, { kind: 'project', name: 'A' });
    expect(await scheduledSnapshot(env.ctx)).not.toBeNull();
    expect(await scheduledSnapshot(env.ctx)).toBeNull();
    createNode(env.ctx, U, { kind: 'project', name: 'B' });
    expect(await scheduledSnapshot(env.ctx)).not.toBeNull();
  });

  it('encrypts backups when a passphrase is configured and still restores them', async () => {
    env = await makeEnv({}, { OMEGA_BACKUP_PASSPHRASE: 'a very long test passphrase' });
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Secret project' });
    const meta = await createBackup(env.ctx, 'manual');
    expect(meta.encrypted).toBe(true);
    const raw = readFileSync(join(env.ctx.config.backupDir, meta.name));
    expect(isEncryptedBackup(raw)).toBe(true);
    expect(raw.includes(Buffer.from('Secret project'))).toBe(false);
    updateNode(env.ctx, U, p.id, { name: 'Changed' });
    await restoreFull(env.ctx, U, meta.name);
    expect(getNode(env.ctx, p.id)!.name).toBe('Secret project');
  });

  it('detects tampered backups', async () => {
    env = await makeEnv();
    const meta = await createBackup(env.ctx, 'manual');
    const file = join(env.ctx.config.backupDir, meta.name);
    const buf = readFileSync(file);
    buf[buf.length - 100] ^= 0xff;
    writeFileSync(file, buf);
    const v = await verifyBackup(env.ctx, meta.name);
    expect(v.verified?.ok).toBe(false);
    await expect(restoreFull(env.ctx, U, meta.name)).rejects.toThrow();
  });

  it('full restore: reverts data, creates a pre-restore backup and keeps the owner account', async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Before' });
    const meta = await createBackup(env.ctx, 'manual');
    updateNode(env.ctx, U, p.id, { name: 'After' });
    createNode(env.ctx, U, { kind: 'project', name: 'New after backup' });
    const res = await c.post(`/api/backups/${meta.name}/restore`, { confirm: 'WIEDERHERSTELLEN' });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.preRestoreBackup).toMatch(/pre_restore/);
    expect(getNode(env.ctx, p.id)!.name).toBe('Before');
    expect(env.ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM nodes WHERE name = 'New after backup'`)!.c).toBe(0);
    // session still valid → owner not locked out
    expect((await c.get('/api/dashboard')).status).toBe(200);
    // the state before the restore is recoverable from the safety backup
    const pre = listBackups(env.ctx).find((b) => b.name === res.json.preRestoreBackup)!;
    expect(pre.counts.projects).toBe(2);
  });

  it('requires explicit confirmation for restores', async () => {
    env = await makeEnv();
    const c = await loggedIn(env.app);
    const meta = await createBackup(env.ctx, 'manual');
    expect((await c.post(`/api/backups/${meta.name}/restore`, {})).status).toBe(400);
  });

  it('restores a single project subtree from a backup', async () => {
    env = await makeEnv();
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Projekt X', tags: ['wichtig'] });
    const m = createNode(env.ctx, U, { kind: 'module', parentId: p.id, name: 'Modul X' });
    const other = createNode(env.ctx, U, { kind: 'project', name: 'Unbeteiligt' });
    const meta = await createBackup(env.ctx, 'manual');
    trashNode(env.ctx, U, p.id, true);
    env.ctx.db.run('DELETE FROM nodes WHERE id = ?', [m.id]); // simulate data loss (children first: parent FK is RESTRICT)
    env.ctx.db.run('DELETE FROM nodes WHERE id = ?', [p.id]);
    updateNode(env.ctx, U, other.id, { name: 'Unbeteiligt (geändert)' });
    const list = await projectsInBackup(env.ctx, meta.name);
    expect(list.map((x) => x.name)).toContain('Projekt X');
    const res = await restoreProject(env.ctx, U, meta.name, p.id);
    expect(res.ok).toBe(true);
    expect(getNode(env.ctx, p.id)!.name).toBe('Projekt X');
    expect(getNode(env.ctx, m.id)!.parent_id).toBe(p.id);
    expect(getNode(env.ctx, other.id)!.name).toBe('Unbeteiligt (geändert)'); // other data untouched
    expect(env.ctx.db.get<{ c: number }>(`SELECT COUNT(*) c FROM entity_tags WHERE entity_id = ?`, [p.id])!.c).toBe(1);
  });

  it('copies backups to an independent external directory', async () => {
    env = await makeEnv({}, {});
    env.ctx.config.backupExternalDir = join(env.dir, 'external');
    const meta = await createBackup(env.ctx, 'manual');
    expect(meta.external?.copied).toBe(true);
    expect(readdirSync(join(env.dir, 'external'))).toContain(meta.name);
  });

  it('applies the retention policy but never deletes the newest verified backup', async () => {
    env = await makeEnv();
    const metas = [];
    for (let i = 0; i < 4; i++) metas.push(await createBackup(env.ctx, 'snapshot'));
    // pretend three of them are 40 days old (same day); the newest one stays fresh
    for (const m of metas.slice(0, 3)) {
      const side = join(env.ctx.config.backupDir, `${m.name}.json`);
      const j = JSON.parse(readFileSync(side, 'utf8'));
      j.createdAt = new Date(Date.now() - 40 * 86400_000).toISOString();
      writeFileSync(side, JSON.stringify(j));
    }
    const removed = applyRetention(env.ctx);
    expect(removed.length).toBe(2); // fresh one kept (24 h window) + one weekly representative of the old ones
    expect(listBackups(env.ctx)).toHaveLength(2);
    expect(backupStatus(env.ctx).count).toBe(2);
  });
});
