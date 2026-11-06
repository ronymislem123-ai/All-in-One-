import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './helpers/context';
import {
  createNode, descendantIds, getNode, listNodes, moveNode, nodeListSchema, purgeNode, restoreFromTrash, restoreVersion,
  trashNode, updateNode, ancestors,
} from '../src/modules/nodes';
import { listVersions } from '../src/modules/activity';
import { search } from '../src/modules/search';

const U = { actor: 'user' as const };
let env: TestEnv;
beforeEach(async () => { env = await makeEnv(); });
afterEach(() => env.cleanup());

describe('project hierarchy', () => {
  it('supports deep hierarchies without artificial depth limit', () => {
    const root = createNode(env.ctx, U, { kind: 'project', name: 'Root' });
    let parent = root.id;
    for (let i = 0; i < 60; i++) parent = createNode(env.ctx, U, { kind: 'module', parentId: parent, name: `Level ${i}` }).id;
    expect(ancestors(env.ctx, parent)).toHaveLength(60);
    expect(descendantIds(env.ctx, root.id)).toHaveLength(60);
  });

  it('prevents circular parent relationships', () => {
    const a = createNode(env.ctx, U, { kind: 'project', name: 'A' });
    const b = createNode(env.ctx, U, { kind: 'module', parentId: a.id, name: 'B' });
    const c = createNode(env.ctx, U, { kind: 'module', parentId: b.id, name: 'C' });
    expect(() => moveNode(env.ctx, U, a.id, c.id)).toThrow(/Zirkuläre/);
    expect(() => moveNode(env.ctx, U, a.id, a.id)).toThrow();
    expect(getNode(env.ctx, a.id)!.parent_id).toBeNull();
  });

  it('turns projects into subprojects when nested and back', () => {
    const a = createNode(env.ctx, U, { kind: 'project', name: 'A' });
    const b = createNode(env.ctx, U, { kind: 'project', name: 'B' });
    expect(moveNode(env.ctx, U, b.id, a.id).kind).toBe('subproject');
    expect(moveNode(env.ctx, U, b.id, null).kind).toBe('project');
  });

  it('refuses to trash nodes with children unless cascade is explicit, and restores subtrees', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'P' });
    const m = createNode(env.ctx, U, { kind: 'module', parentId: p.id, name: 'M' });
    createNode(env.ctx, U, { kind: 'feature', parentId: m.id, name: 'F' });
    expect(() => trashNode(env.ctx, U, p.id)).toThrow(/Unterobjekte/);
    expect(trashNode(env.ctx, U, p.id, true).trashed).toHaveLength(3);
    expect(getNode(env.ctx, m.id)).toBeUndefined();
    restoreFromTrash(env.ctx, U, p.id);
    expect(getNode(env.ctx, m.id)).toBeDefined();
    expect(descendantIds(env.ctx, p.id)).toHaveLength(2);
  });

  it('purges only from the trash and keeps the version history', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Purge me' });
    expect(() => purgeNode(env.ctx, U, p.id)).toThrow(/Papierkorb/);
    trashNode(env.ctx, U, p.id);
    expect(purgeNode(env.ctx, U, p.id)).toBe(1);
    expect(getNode(env.ctx, p.id, true)).toBeUndefined();
    expect(listVersions(env.ctx, 'node', p.id).length).toBeGreaterThan(0);
  });

  it('records versions and restores an earlier one', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Original', summary: 'v1' });
    updateNode(env.ctx, U, p.id, { name: 'Renamed', summary: 'v2' });
    expect(getNode(env.ctx, p.id)!.name).toBe('Renamed');
    restoreVersion(env.ctx, U, p.id, 1);
    const n = getNode(env.ctx, p.id)!;
    expect(n.name).toBe('Original');
    expect(n.summary).toBe('v1');
    expect(listVersions(env.ctx, 'node', p.id).length).toBeGreaterThanOrEqual(3);
  });

  it('rejects stale edits (optimistic concurrency)', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'X' });
    updateNode(env.ctx, U, p.id, { name: 'Y', version: 1 });
    expect(() => updateNode(env.ctx, U, p.id, { name: 'Z', version: 1 })).toThrow(/inzwischen geändert/);
  });

  it('tracks field provenance (website vs claude)', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Prov', summary: 'a' });
    updateNode(env.ctx, { actor: 'claude' }, p.id, { description: 'from claude' });
    const fs = JSON.parse(getNode(env.ctx, p.id)!.field_sources);
    expect(fs.summary.src).toBe('website');
    expect(fs.description.src).toBe('claude');
  });

  it('keeps the search index in sync', () => {
    const p = createNode(env.ctx, U, { kind: 'project', name: 'Quantenbuchhaltung', summary: 'Spezialprojekt' });
    expect(search(env.ctx, 'quanten').hits.some((h) => h.id === p.id)).toBe(true);
    trashNode(env.ctx, U, p.id);
    expect(search(env.ctx, 'quanten').hits.some((h) => h.id === p.id)).toBe(false);
  });

  it('lists with filters and pagination', () => {
    for (let i = 0; i < 30; i++) createNode(env.ctx, U, { kind: 'project', name: `P${i}`, favorite: i % 3 === 0 });
    const page = listNodes(env.ctx, nodeListSchema.parse({ kinds: 'project', parent: 'root', limit: '10', offset: '10', sort: 'name' }));
    expect(page.total).toBe(30);
    expect(page.items).toHaveLength(10);
    expect(listNodes(env.ctx, nodeListSchema.parse({ favorite: '1' })).total).toBe(10);
  });
});
