import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './helpers/context';
import { processEnvelope, retryEvent } from '../src/modules/ingest';
import { getNode, updateNode, createNode } from '../src/modules/nodes';
import { listConflicts, resolveConflict } from '../src/modules/conflicts';
import { importFile } from '../src/modules/transfer';
import { INGEST_SCHEMA_ID } from '@shared/ingest';

let env: TestEnv;
beforeEach(async () => { env = await makeEnv(); });
afterEach(() => env.cleanup());

const send = (events: unknown[]) => processEnvelope(env.ctx, { schema: INGEST_SCHEMA_ID, source: { client: 'test' }, events }, { trigger: 'api', client: 'test' });
const nodeId = (ext: string) => env.ctx.db.get<{ entity_id: string }>(`SELECT entity_id FROM external_identities WHERE external_id = ? AND entity_type = 'node'`, [ext])?.entity_id;
const count = (sql: string) => env.ctx.db.get<{ c: number }>(sql)!.c;

describe('Claude ingest (omega.ingest/v1)', () => {
  it('creates a project and is idempotent for repeated deliveries', () => {
    const ev = { eventId: 'e1', type: 'project.upsert', data: { externalId: 'alpha', name: 'Alpha', summary: 'Erstes Projekt', status: 'in_development' } };
    const r1 = send([ev]);
    expect(r1.results[0].status).toBe('applied');
    const r2 = send([ev]);
    expect(r2.results[0].status).toBe('duplicate');
    expect(count(`SELECT COUNT(*) c FROM nodes WHERE name = 'Alpha'`)).toBe(1);
    // different event id, same external id → update, never a second project
    const r3 = send([{ ...ev, eventId: 'e2', data: { ...ev.data, summary: 'Neu' } }]);
    expect(r3.results[0].status).toBe('applied');
    expect(count(`SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL`)).toBe(1);
    expect(getNode(env.ctx, nodeId('alpha')!)!.summary).toBe('Neu');
  });

  it('rejects a reused event id with different content', () => {
    send([{ eventId: 'same', type: 'project.upsert', data: { externalId: 'a', name: 'A' } }]);
    const r = send([{ eventId: 'same', type: 'project.upsert', data: { externalId: 'a', name: 'B' } }]);
    expect(r.results[0].status).toBe('rejected');
    expect(getNode(env.ctx, nodeId('a')!)!.name).toBe('A');
  });

  it('never merges by similar name – creates a reviewable duplicate conflict instead', () => {
    createNode(env.ctx, { actor: 'user' }, { kind: 'project', name: 'Trading Dashboard' });
    const r = send([{ eventId: 'd1', type: 'project.upsert', data: { externalId: 'trading', name: 'Trading-Dashboard' } }]);
    expect(r.results[0].status).toBe('conflict');
    expect(count(`SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL`)).toBe(2);
    const c = listConflicts(env.ctx, { status: 'open' })[0];
    expect(c.type).toBe('possible_duplicate');
    expect(c.candidates).toHaveLength(1);
    // resolve: use the existing project → identity moves, provisional node goes to trash
    resolveConflict(env.ctx, { actor: 'user' }, c.id, { resolution: 'use_existing', targetId: c.candidates[0].id });
    expect(nodeId('trading')).toBe(c.candidates[0].id);
    expect(count(`SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL`)).toBe(1);
  });

  it('stores children with unknown parent separately and attaches them when the parent arrives', () => {
    const r = send([{ eventId: 'm1', type: 'node.upsert', data: { externalId: 'beta/api', parentExternalId: 'beta', kind: 'module', name: 'API' } }]);
    expect(r.results[0].status).toBe('conflict');
    const mod = getNode(env.ctx, nodeId('beta/api')!)!;
    expect(mod.parent_id).toBeNull();
    expect(mod.review_state).toBe('unassigned');
    send([{ eventId: 'p1', type: 'project.upsert', data: { externalId: 'beta', name: 'Beta' } }]);
    const after = getNode(env.ctx, nodeId('beta/api')!)!;
    expect(after.parent_id).toBe(nodeId('beta'));
    expect(after.review_state).toBe('ok');
    expect(listConflicts(env.ctx, { status: 'open' })).toHaveLength(0);
  });

  it('respects website ownership: no silent overwrite, notes untouched, conflict raised', () => {
    send([{ eventId: 'x1', type: 'project.upsert', data: { externalId: 'gamma', name: 'Gamma', summary: 'Claude-Text' } }]);
    const id = nodeId('gamma')!;
    updateNode(env.ctx, { actor: 'user' }, id, { summary: 'Mein eigener Text', notes: 'Private Notiz', priority: 0 });
    const r = send([{ eventId: 'x2', type: 'project.upsert', data: { externalId: 'gamma', name: 'Gamma', summary: 'Claude-Text v2', description: 'Neue Beschreibung' } }]);
    expect(r.results[0].status).toBe('conflict');
    const n = getNode(env.ctx, id)!;
    expect(n.summary).toBe('Mein eigener Text');
    expect(n.description).toBe('Neue Beschreibung'); // never edited on the website → Claude is authoritative
    expect(n.notes).toBe('Private Notiz');
    expect(n.priority).toBe(0);
    const c = listConflicts(env.ctx, { status: 'open' }).find((x) => x.type === 'field_conflict')!;
    expect(c.details.claudeValue).toBe('Claude-Text v2');
    // owner keeps the website value → the same Claude value does not raise the conflict again
    resolveConflict(env.ctx, { actor: 'user' }, c.id, { resolution: 'keep_website' });
    const r2 = send([{ eventId: 'x3', type: 'project.upsert', data: { externalId: 'gamma', name: 'Gamma', summary: 'Claude-Text v2', description: 'Neue Beschreibung' } }]);
    expect(r2.results[0].status).toBe('applied');
    expect(listConflicts(env.ctx, { status: 'open' })).toHaveLength(0);
  });

  it('accept_claude applies the Claude value', () => {
    send([{ eventId: 'y1', type: 'project.upsert', data: { externalId: 'delta', name: 'Delta' } }]);
    updateNode(env.ctx, { actor: 'user' }, nodeId('delta')!, { name: 'Delta (Website)' });
    send([{ eventId: 'y2', type: 'node.rename', data: { externalId: 'delta', name: 'Delta Pro' } }]);
    const c = listConflicts(env.ctx, { status: 'open' })[0];
    resolveConflict(env.ctx, { actor: 'user' }, c.id, { resolution: 'accept_claude' });
    expect(getNode(env.ctx, nodeId('delta')!)!.name).toBe('Delta Pro');
  });

  it('rejects progress for unknown targets and succeeds on retry once the target exists', () => {
    const r = send([{ eventId: 'pr1', type: 'progress.report', data: { externalId: 'later', summary: 'Fertig', progress: 50 } }]);
    expect(r.results[0].status).toBe('rejected');
    send([{ eventId: 'pr0', type: 'project.upsert', data: { externalId: 'later', name: 'Later' } }]);
    const row = env.ctx.db.get<{ id: string }>(`SELECT id FROM sync_events WHERE event_id = 'pr1'`)!;
    expect(retryEvent(env.ctx, row.id).status).toBe('applied');
    expect(getNode(env.ctx, nodeId('later')!)!.progress).toBe(50);
  });

  it('records validation failures in the sync protocol without storing data', () => {
    const r = send([{ eventId: 'bad', type: 'project.upsert', data: { externalId: '', name: '' } }]);
    expect(r.results[0].status).toBe('rejected');
    expect(r.results[0].issues!.length).toBeGreaterThan(0);
    expect(count(`SELECT COUNT(*) c FROM sync_events WHERE status = 'rejected'`)).toBe(1);
    expect(count(`SELECT COUNT(*) c FROM nodes`)).toBe(0);
  });

  it('turns a repository hint into a suggestion, never a confirmed link', () => {
    send([{ eventId: 'r1', type: 'project.upsert', data: { externalId: 'eps', name: 'Eps', repository: 'me/eps' } }]);
    expect(count(`SELECT COUNT(*) c FROM project_repository_links WHERE status = 'suggested'`)).toBe(1);
    expect(count(`SELECT COUNT(*) c FROM project_repository_links WHERE status = 'confirmed'`)).toBe(0);
  });

  it('does not resurrect trashed targets silently', () => {
    send([{ eventId: 't1', type: 'project.upsert', data: { externalId: 'zeta', name: 'Zeta' } }]);
    env.ctx.db.run(`UPDATE nodes SET deleted_at = '2026-01-01' WHERE id = ?`, [nodeId('zeta')]);
    const r = send([{ eventId: 't2', type: 'project.upsert', data: { externalId: 'zeta', name: 'Zeta 2' } }]);
    expect(r.results[0].status).toBe('rejected');
    expect(r.results[0].message).toMatch(/Papierkorb/);
  });

  it('links similar Claude ideas as variants instead of merging', () => {
    send([{ eventId: 'i1', type: 'idea.upsert', data: { externalId: 'idea-1', title: 'Smarter Rechnungsscanner', summary: 'Scannt Rechnungen' } }]);
    send([{ eventId: 'i2', type: 'idea.upsert', data: { externalId: 'idea-2', title: 'Smarter Rechnungs-Scanner', summary: 'Scannt Rechnungen besser' } }]);
    const rows = env.ctx.db.all<{ parent_idea_id: string | null }>(`SELECT parent_idea_id FROM ideas WHERE source = 'claude' ORDER BY created_at`);
    expect(rows).toHaveLength(2);
    expect(rows[1].parent_idea_id).not.toBeNull();
  });

  it('imports markdown files idempotently', () => {
    const md = `---\nomega: project\nexternalId: md-proj\nname: Markdown Projekt\nstatus: planned\n---\n# Markdown Projekt\n\nBeschreibung hier.\n\n## Module\n- Login | in_development\n- Export\n`;
    const r1 = importFile(env.ctx, 'projekt.md', md) as { result: { summary: Record<string, number> } };
    expect(r1.result.summary.applied).toBe(3);
    const r2 = importFile(env.ctx, 'projekt.md', md) as { result: { summary: Record<string, number> } };
    expect(r2.result.summary.duplicate).toBe(3);
    expect(count(`SELECT COUNT(*) c FROM nodes WHERE deleted_at IS NULL`)).toBe(3);
  });
});
