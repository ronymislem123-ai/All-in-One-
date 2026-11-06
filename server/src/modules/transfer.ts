import type { Ctx, WriteMeta } from '../context';
import { sha256 } from '../lib/crypto';
import { badRequest } from '../lib/errors';
import { slugify } from '../lib/ids';
import { stableStringify } from '../lib/json';
import { nowIso } from '../lib/time';
import { SCHEMA_VERSION } from '../db/database';
import { logActivity } from './activity';
import { createBackup } from './backup';
import { processEnvelope } from './ingest';
import { rebuildSearchIndex } from './search';
import { INGEST_SCHEMA_ID, ingestEnvelopeSchema } from '@shared/ingest';
import { LIFECYCLE_STATUSES } from '@shared/domain';

export const EXPORT_FORMAT = 'omega.export/v1';

/** Tables that belong to the owner's administrative data (no secrets, sessions, tokens, caches). */
const EXPORT_TABLES = [
  'categories', 'nodes', 'applications', 'ideas', 'knowledge_articles', 'tags', 'entity_tags', 'external_identities',
  'repositories', 'project_repository_links', 'conflicts',
] as const;

export function exportData(ctx: Ctx, opts: { includeActivity?: boolean } = {}) {
  const data: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) data[t] = ctx.db.all(`SELECT * FROM ${t}`);
  if (opts.includeActivity) data.activity = ctx.db.all('SELECT * FROM activity ORDER BY id DESC LIMIT 20000');
  return {
    format: EXPORT_FORMAT,
    exportedAt: nowIso(),
    schemaVersion: SCHEMA_VERSION,
    note: 'Enthält keine Passwörter, Sitzungen, API-Tokens oder gespeicherten Geheimnisse.',
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}

/**
 * Merges an OMEGA export into the live data. Existing records (same id) are never overwritten or deleted –
 * they are reported as "bereits vorhanden". A safety backup is created first.
 */
export async function importExport(ctx: Ctx, meta: WriteMeta, payload: unknown) {
  const p = payload as { format?: string; schemaVersion?: number; data?: Record<string, Record<string, unknown>[]> };
  if (p?.format !== EXPORT_FORMAT || !p.data) throw badRequest(`Keine OMEGA-Exportdatei (erwartet format "${EXPORT_FORMAT}").`);
  if ((p.schemaVersion ?? 0) > SCHEMA_VERSION) throw badRequest('Export stammt aus einer neueren Programmversion.');
  const backup = await createBackup(ctx, 'pre_import', 'Automatisch vor Import einer Exportdatei');
  const report: Record<string, { inserted: number; existing: number; invalid: number }> = {};
  // Records with natural keys (slug / name / full_name) map onto existing ones instead of colliding.
  const NATURAL: Record<string, string> = { categories: 'slug', tags: 'name', ideas: 'slug', repositories: 'full_name', knowledge_articles: 'slug' };
  const idMap: Record<string, Map<string, string>> = { categories: new Map(), tags: new Map(), ideas: new Map(), repositories: new Map(), knowledge_articles: new Map() };
  const mapId = (table: string, id: unknown) => (typeof id === 'string' ? idMap[table]?.get(id) ?? id : id);
  const remap = (table: string, row: Record<string, unknown>): Record<string, unknown> => {
    const r = { ...row };
    if (table === 'categories') r.parent_id = mapId('categories', r.parent_id);
    if (table === 'nodes' || table === 'applications') r.category_id = mapId('categories', r.category_id);
    if (table === 'ideas') { r.category_id = mapId('categories', r.category_id); r.subcategory_id = mapId('categories', r.subcategory_id); r.parent_idea_id = mapId('ideas', r.parent_idea_id); }
    if (table === 'entity_tags') { r.tag_id = mapId('tags', r.tag_id); if (r.entity_type === 'idea') r.entity_id = mapId('ideas', r.entity_id); }
    if (table === 'external_identities' && r.entity_type === 'idea') r.entity_id = mapId('ideas', r.entity_id);
    if (table === 'project_repository_links') r.repository_id = mapId('repositories', r.repository_id);
    if (table === 'conflicts' && r.subject_type === 'repository') r.subject_id = mapId('repositories', r.subject_id);
    return r;
  };
  ctx.db.write(() => {
    ctx.db.run('PRAGMA defer_foreign_keys = ON');
    for (const table of EXPORT_TABLES) {
      const rows = p.data![table];
      if (!Array.isArray(rows)) continue;
      const columns = new Set(ctx.db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
      const r = { inserted: 0, existing: 0, invalid: 0 };
      // parents first for self-referencing categories
      const ordered = table === 'categories' ? [...rows].sort((a, b) => Number(Boolean(a.parent_id)) - Number(Boolean(b.parent_id))) : rows;
      for (const original of ordered) {
        const key = NATURAL[table];
        if (key && original[key] !== undefined) {
          const existing = ctx.db.get<{ id: string }>(`SELECT id FROM ${table} WHERE ${key} = ?`, [original[key] as string]);
          if (existing) { idMap[table].set(String(original.id), existing.id); if (existing.id !== original.id) { r.existing++; continue; } }
        }
        const row = remap(table, original);
        const cols = Object.keys(row).filter((c) => columns.has(c));
        if (!cols.length) { r.invalid++; continue; }
        try {
          const res = ctx.db.run(`INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c] as never));
          if (res.changes) r.inserted++; else r.existing++;
        } catch {
          r.invalid++;
        }
      }
      report[table] = r;
    }
    const fk = ctx.db.all('PRAGMA foreign_key_check');
    if (fk.length) throw badRequest(`Import abgebrochen: ${fk.length} ungültige Verweise. Es wurde nichts übernommen.`, fk.slice(0, 10));
    logActivity(ctx, meta, { action: 'import.export', summary: `Exportdatei importiert (vorher gesichert als ${backup.name})`, data: report });
  });
  rebuildSearchIndex(ctx);
  return { backup: backup.name, report };
}

// ── File import (alternative to MCP / API) ─────────────────────────────────
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

const evId = (filename: string, part: unknown) => `file:${sha256(`${filename}|${stableStringify(part)}`).slice(0, 24)}`;

/**
 * Converts an uploaded file into an omega.ingest/v1 envelope.
 * Event ids are derived from the content → re-importing the same file never creates duplicates.
 */
export function fileToEnvelope(filename: string, content: string): { envelope: Record<string, unknown>; kind: string; notes: string[] } {
  const notes: string[] = [];
  const lower = filename.toLowerCase();
  if (content.length > 2_000_000) throw badRequest('Datei ist zu groß (max. 2 MB).');
  if (lower.endsWith('.json')) {
    let json: unknown;
    try { json = JSON.parse(content); } catch { throw badRequest('JSON-Datei ist nicht gültig.'); }
    const obj = json as Record<string, unknown>;
    if (obj.schema === INGEST_SCHEMA_ID) {
      const env = ingestEnvelopeSchema.safeParse(obj);
      if (!env.success) throw badRequest('Ingest-Datei ungültig', env.error.issues);
      // fill missing event ids deterministically
      const events = (obj.events as Record<string, unknown>[]).map((e) => (e.eventId ? e : { ...e, eventId: evId(filename, e) }));
      return { envelope: { ...obj, events, source: { client: 'file', label: filename } }, kind: 'ingest-json', notes };
    }
    if (obj.format === EXPORT_FORMAT) throw badRequest('Das ist eine OMEGA-Exportdatei – bitte über „Export importieren“ einspielen.');
    throw badRequest(`Unbekanntes JSON-Format. Erwartet: { "schema": "${INGEST_SCHEMA_ID}", "events": [...] }`);
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
    const { meta, body } = parseFrontmatter(content);
    const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const firstLine = body.split('\n').map((l) => l.trim()).find(Boolean) ?? filename;
    const name = (meta.name ?? meta.title ?? firstHeading ?? firstLine.replace(/^#+\s*/, '')).slice(0, 200);
    const [descPart, modulePart] = body.split(/^##\s+Module\s*$/im);
    const description = descPart.replace(/^#\s+.+$/m, '').trim();
    const summary = (meta.summary ?? description.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? name).slice(0, 400) || name;
    const status = LIFECYCLE_STATUSES.includes(meta.status as never) ? meta.status : undefined;
    if (meta.status && !status) notes.push(`Unbekannter Status „${meta.status}“ ignoriert`);
    if ((meta.omega ?? '').toLowerCase() === 'project') {
      const ext = meta.externalId ?? slugify(name);
      const events: Record<string, unknown>[] = [];
      const projectData = { externalId: ext, name, summary, description: description || undefined, status, category: meta.category, repository: meta.repository };
      events.push({ eventId: evId(filename, projectData), type: 'project.upsert', data: projectData });
      for (const line of (modulePart ?? '').split('\n')) {
        const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
        if (!item) continue;
        const [modName, modStatus] = item[1].split('|').map((s) => s.trim());
        const data = {
          externalId: `${ext}/${slugify(modName)}`, parentExternalId: ext, kind: 'module', name: modName,
          ...(LIFECYCLE_STATUSES.includes(modStatus as never) ? { status: modStatus } : {}),
        };
        events.push({ eventId: evId(filename, data), type: 'node.upsert', data });
      }
      notes.push(`${events.length - 1} Module erkannt`);
      return { envelope: { schema: INGEST_SCHEMA_ID, source: { client: 'file', label: filename }, events }, kind: 'markdown-project', notes };
    }
    // default: quick idea capture
    const data = { externalId: meta.externalId ?? `file-idea:${slugify(name)}`, title: name, summary, description: description || undefined, category: meta.category };
    notes.push('Ohne „omega: project“ im Kopfbereich wird die Datei als Idee erfasst.');
    return { envelope: { schema: INGEST_SCHEMA_ID, source: { client: 'file', label: filename }, events: [{ eventId: evId(filename, data), type: 'idea.upsert', data }] }, kind: 'markdown-idea', notes };
  }
  throw badRequest('Nicht unterstütztes Dateiformat. Erlaubt: .json (omega.ingest/v1), .md, .txt');
}

export function importFile(ctx: Ctx, filename: string, content: string, opts: { dryRun?: boolean } = {}) {
  const { envelope, kind, notes } = fileToEnvelope(filename, content);
  if (opts.dryRun) return { dryRun: true, kind, notes, envelope };
  const result = processEnvelope(ctx, envelope, { trigger: 'file', client: `Datei ${filename}` });
  return { dryRun: false, kind, notes, result };
}
