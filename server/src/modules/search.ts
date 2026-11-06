import type { Ctx } from '../context';
import { NODE_KIND_LABELS, type NodeKind } from '@shared/domain';

type Indexer = (ctx: Ctx, id: string) => { title: string; body: string; extra: string } | null;

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n');
const list = (json: string | null | undefined) => {
  try { return (JSON.parse(json ?? '[]') as string[]).join(' · '); } catch { return ''; }
};
const tagsOf = (ctx: Ctx, type: string, id: string) =>
  ctx.db.all<{ name: string }>('SELECT t.name FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = ? AND et.entity_id = ?', [type, id]).map((t) => t.name).join(' ');

const INDEXERS: Record<string, Indexer> = {
  node: (ctx, id) => {
    const n = ctx.db.get<Record<string, string | null>>('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!n) return null;
    return {
      title: n.name ?? '',
      body: join(n.summary, n.description, n.body?.slice(0, 20000), n.notes),
      extra: join(NODE_KIND_LABELS[n.kind as NodeKind], n.code_path, tagsOf(ctx, 'node', id)),
    };
  },
  idea: (ctx, id) => {
    const i = ctx.db.get<Record<string, string | null>>('SELECT * FROM ideas WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!i) return null;
    return {
      title: i.title ?? '',
      body: join(i.summary, i.description, i.problem, i.benefit, i.goal, list(i.features), i.notes),
      extra: join(i.audience, list(i.technologies), tagsOf(ctx, 'idea', id)),
    };
  },
  application: (ctx, id) => {
    const a = ctx.db.get<Record<string, string | null>>('SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!a) return null;
    return { title: a.name ?? '', body: join(a.summary, a.description, list(a.features)), extra: join(a.launch_url, tagsOf(ctx, 'application', id)) };
  },
  category: (ctx, id) => {
    const c = ctx.db.get<Record<string, string | null>>('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!c) return null;
    return { title: c.name ?? '', body: c.description ?? '', extra: c.slug ?? '' };
  },
  knowledge: (ctx, id) => {
    const k = ctx.db.get<Record<string, string | null>>('SELECT * FROM knowledge_articles WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!k) return null;
    return { title: k.title ?? '', body: join(k.summary, k.body), extra: k.topic ?? '' };
  },
  repository: (ctx, id) => {
    const r = ctx.db.get<Record<string, string | null>>('SELECT * FROM repositories WHERE id = ?', [id]);
    if (!r) return null;
    return { title: r.full_name ?? '', body: r.description ?? '', extra: join(r.primary_language, list(r.topics)) };
  },
};

export function reindex(ctx: Ctx, entityType: string, entityId: string): void {
  const indexer = INDEXERS[entityType];
  if (!indexer) return;
  ctx.db.run('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  const doc = indexer(ctx, entityId);
  if (doc) {
    ctx.db.run('INSERT INTO search_index(entity_type, entity_id, title, body, extra) VALUES (?, ?, ?, ?, ?)', [
      entityType, entityId, doc.title, doc.body, doc.extra,
    ]);
  }
}

/** Indexes repository file paths (not contents) so files are findable via global search. */
export function reindexRepoFiles(ctx: Ctx, repoId: string): void {
  ctx.db.tx(() => {
    ctx.db.run(`DELETE FROM search_index WHERE entity_type = 'file' AND entity_id LIKE ?`, [`${repoId}:%`]);
    const files = ctx.db.all<{ path: string; name: string }>(
      `SELECT path, name FROM repo_tree WHERE repo_id = ? AND type = 'blob' LIMIT 20000`, [repoId]);
    for (const f of files) {
      ctx.db.run('INSERT INTO search_index(entity_type, entity_id, title, body, extra) VALUES (?, ?, ?, ?, ?)', [
        'file', `${repoId}:${f.path}`, f.name, f.path.replace(/[/._-]/g, ' '), '',
      ]);
    }
  });
}

export function rebuildSearchIndex(ctx: Ctx): number {
  let count = 0;
  ctx.db.tx(() => {
    ctx.db.run(`DELETE FROM search_index WHERE entity_type <> 'file'`);
    const sets: [string, string][] = [
      ['node', 'SELECT id FROM nodes WHERE deleted_at IS NULL'],
      ['idea', 'SELECT id FROM ideas WHERE deleted_at IS NULL'],
      ['application', 'SELECT id FROM applications WHERE deleted_at IS NULL'],
      ['category', 'SELECT id FROM categories WHERE deleted_at IS NULL'],
      ['knowledge', 'SELECT id FROM knowledge_articles WHERE deleted_at IS NULL'],
      ['repository', 'SELECT id FROM repositories'],
    ];
    for (const [type, sql] of sets) {
      for (const r of ctx.db.all<{ id: string }>(sql)) { reindex(ctx, type, r.id); count++; }
    }
  });
  return count;
}

function toFtsQuery(q: string): string | null {
  const terms = q
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  snippet: string;
  subtitle?: string;
  link: string;
  meta?: Record<string, unknown>;
}

export function search(ctx: Ctx, q: string, opts: { types?: string[]; limit?: number } = {}): { query: string; hits: SearchHit[] } {
  const fts = toFtsQuery(q);
  if (!fts) return { query: q, hits: [] };
  const limit = Math.min(opts.limit ?? 40, 100);
  const typeFilter = opts.types?.length ? `AND entity_type IN (${opts.types.map(() => '?').join(',')})` : '';
  const rows = ctx.db.all<{ entity_type: string; entity_id: string; title: string; snip: string }>(
    `SELECT entity_type, entity_id, title, snippet(search_index, 3, '⟦', '⟧', '…', 14) snip
     FROM search_index WHERE search_index MATCH ? ${typeFilter}
     ORDER BY bm25(search_index, 0.0, 0.0, 10.0, 3.0, 2.0) LIMIT ?`,
    [fts, ...(opts.types ?? []), limit],
  );
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const h = hydrate(ctx, r.entity_type, r.entity_id, r.title, r.snip);
    if (h) hits.push(h);
  }
  return { query: q, hits };
}

function hydrate(ctx: Ctx, type: string, id: string, title: string, snippet: string): SearchHit | null {
  switch (type) {
    case 'node': {
      const n = ctx.db.get<{ kind: NodeKind; archived_at: string | null; parent_id: string | null }>('SELECT kind, archived_at, parent_id FROM nodes WHERE id = ?', [id]);
      if (!n) return null;
      return { type, id, title, snippet, subtitle: NODE_KIND_LABELS[n.kind] + (n.archived_at ? ' · archiviert' : ''), link: `/projects/${id}`, meta: { kind: n.kind } };
    }
    case 'idea':
      return { type, id, title, snippet, subtitle: 'Idee', link: `/ideas/${id}` };
    case 'application':
      return { type, id, title, snippet, subtitle: 'Anwendung', link: `/apps?app=${id}` };
    case 'category':
      return { type, id, title, snippet, subtitle: 'Kategorie', link: `/ideas?category=${id}` };
    case 'knowledge': {
      const k = ctx.db.get<{ slug: string }>('SELECT slug FROM knowledge_articles WHERE id = ?', [id]);
      return k ? { type, id, title, snippet, subtitle: 'Claude Knowledge Hub', link: `/knowledge/${k.slug}` } : null;
    }
    case 'repository':
      return { type, id, title, snippet, subtitle: 'GitHub-Repository', link: `/code/${id}` };
    case 'file': {
      const [repoId, ...rest] = id.split(':');
      const path = rest.join(':');
      const repo = ctx.db.get<{ full_name: string }>('SELECT full_name FROM repositories WHERE id = ?', [repoId]);
      return repo ? { type, id, title, snippet: path, subtitle: `Datei · ${repo.full_name}`, link: `/code/${repoId}?path=${encodeURIComponent(path)}` } : null;
    }
    default:
      return null;
  }
}
