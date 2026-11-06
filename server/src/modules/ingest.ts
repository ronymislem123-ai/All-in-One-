import type { Ctx, WriteMeta } from '../context';
import { AppError, badRequest } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { newId } from '../lib/ids';
import { parseJson, stableStringify } from '../lib/json';
import { nowIso } from '../lib/time';
import { nameSimilarity } from '../lib/similarity';
import { logActivity } from './activity';
import { categoryIdBySlug } from './categories';
import { createConflict, resolveWaiting } from './conflicts';
import { createIdea, findSimilarByTitle, requireIdea, updateIdea } from './ideas';
import {
  createNode, getNode, moveNode, rootProjectId, setArchived, updateNode,
  type FieldSources, type NodeRow,
} from './nodes';
import { finishRun, startRun } from './sync-log';
import { ensureRepository, suggestLink } from './github/repos';
import { getTags, setTags } from './tags';
import { notify } from './notifications';
import {
  INGEST_SCHEMA_ID, ingestEnvelopeSchema, ingestEventSchema,
  type IngestEvent, type IngestEventResult, type IngestResponse, type IngestResultStatus,
} from '@shared/ingest';
import { LIFECYCLE_LABELS, type LifecycleStatus } from '@shared/domain';

const CLAUDE: WriteMeta = { actor: 'claude' };
const SOURCE = 'claude';

// ── Identity helpers ───────────────────────────────────────────────────────
function findIdentity(ctx: Ctx, entityType: 'node' | 'idea', externalId: string): string | null {
  return ctx.db.get<{ entity_id: string }>(
    'SELECT entity_id FROM external_identities WHERE source = ? AND entity_type = ? AND external_id = ?',
    [SOURCE, entityType, externalId],
  )?.entity_id ?? null;
}

function bindIdentity(ctx: Ctx, entityType: 'node' | 'idea', entityId: string, externalId: string, eventId: string, payload: unknown) {
  const now = nowIso();
  ctx.db.run(
    `INSERT INTO external_identities(id, source, external_id, entity_type, entity_id, confirmed, first_seen_at, last_seen_at, last_event_id, last_payload)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(source, entity_type, external_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_event_id = excluded.last_event_id, last_payload = excluded.last_payload`,
    [newId('xid'), SOURCE, externalId, entityType, entityId, now, now, eventId, JSON.stringify(payload)],
  );
}

class Rejected extends Error {}

/** Resolves an identity to a live node; trashed targets are not silently resurrected. */
function liveNodeByIdentity(ctx: Ctx, externalId: string): NodeRow | null {
  const id = findIdentity(ctx, 'node', externalId);
  if (!id) return null;
  const node = getNode(ctx, id, true);
  if (!node) return null;
  if (node.deleted_at) throw new Rejected(`Ziel „${node.name}“ (${externalId}) liegt im Papierkorb. Bitte zuerst wiederherstellen, dann erneut senden.`);
  return node;
}

// ── Authority rules ────────────────────────────────────────────────────────
interface ClaudeFields {
  name?: string;
  summary?: string;
  description?: string;
  body?: string;
  status?: LifecycleStatus;
  progress?: number;
  nature?: 'organizational' | 'technical';
  codePath?: string;
  category?: string;
  parentExternalId?: string;
}
const COLUMN: Record<string, keyof NodeRow> = {
  name: 'name', summary: 'summary', description: 'description', body: 'body', status: 'lifecycle_status',
  progress: 'progress', nature: 'nature', codePath: 'code_path',
};
const PATCH_KEY: Record<string, string> = {
  name: 'name', summary: 'summary', description: 'description', body: 'body', status: 'lifecycleStatus',
  progress: 'progress', nature: 'nature', codePath: 'codePath',
};

/**
 * Applies Claude data to an existing node following the source-of-truth rules (§9):
 *  - fields last written by Claude (or never written) are updated,
 *  - fields last edited on the website are NOT overwritten → field conflict (both values preserved),
 *  - a Claude value the owner already rejected is not re-raised,
 *  - category is only filled if empty; notes/priority/favourites are never touched.
 */
function applyClaudeUpdate(ctx: Ctx, node: NodeRow, f: ClaudeFields, eventId: string): { changed: string[]; conflicts: string[]; notes: string[] } {
  const sources = parseJson<FieldSources>(node.field_sources, {});
  const patch: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const notes: string[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const v = (f as Record<string, unknown>)[key];
    if (v === undefined) continue;
    const current = node[col];
    if (current === v) continue;
    const src = sources[col]?.src;
    if (src === 'website' || src === 'user') {
      const hash = sha256(stableStringify(v));
      if (sources[col]?.rejected === hash) { notes.push(`${key}: bereits abgelehnter Claude-Wert ignoriert`); continue; }
      conflicts.push(
        createConflict(ctx, {
          type: 'field_conflict', severity: 'warning', source: 'claude', subjectType: 'node', subjectId: node.id,
          title: `„${node.name}“: ${key} wurde auf der Website geändert und von Claude abweichend übermittelt`,
          description: 'Website-Wert bleibt aktiv. Entscheide, welcher Stand gelten soll – beide Werte bleiben erhalten.',
          details: { field: col, websiteValue: current, claudeValue: v, claudeHash: hash, eventId },
          syncEventId: eventId,
        }),
      );
      continue;
    }
    patch[PATCH_KEY[key]] = v;
  }
  if (f.category) {
    const cid = categoryIdBySlug(ctx, f.category);
    if (!cid) notes.push(`Kategorie „${f.category}“ unbekannt – ignoriert`);
    else if (!node.category_id) patch.categoryId = cid;
  }
  const changed = Object.keys(patch);
  if (changed.length) {
    updateNode(ctx, { ...CLAUDE, eventId }, node.id, patch as never, {
      summary: `Claude hat „${node.name}“ aktualisiert (${changed.join(', ')})`, action: 'claude.updated',
    });
  }
  // structural position (website-owned once the owner moved it)
  if (f.parentExternalId !== undefined) {
    const parent = liveNodeByIdentity(ctx, f.parentExternalId);
    if (!parent) notes.push(`Elternobjekt ${f.parentExternalId} unbekannt – Position unverändert`);
    else if (parent.id !== node.parent_id && parent.id !== node.id) {
      const src = sources.parent?.src;
      const hash = sha256(parent.id);
      if (src === 'website' || src === 'user') {
        if (sources.parent?.rejected !== hash) {
          conflicts.push(
            createConflict(ctx, {
              type: 'field_conflict', severity: 'warning', source: 'claude', subjectType: 'node', subjectId: node.id,
              title: `„${node.name}“: Position weicht von der Website-Zuordnung ab`,
              description: `Claude ordnet das Objekt unter „${parent.name}“ ein; auf der Website liegt es woanders.`,
              details: { field: 'parent', websiteValue: node.parent_id, claudeValue: parent.name, claudeParentId: parent.id, claudeHash: hash, eventId },
              syncEventId: eventId,
            }),
          );
        }
      } else {
        try {
          moveNode(ctx, { ...CLAUDE, eventId }, node.id, parent.id);
          changed.push('parent');
        } catch (e) {
          notes.push(`Verschieben nicht möglich: ${(e as Error).message}`);
        }
      }
    }
  }
  return { changed, conflicts, notes };
}

// ── Create path with duplicate/parent safety ───────────────────────────────
function createFromClaude(
  ctx: Ctx,
  eventId: string,
  ext: string,
  input: { kind: NodeRow['kind']; name: string; parentExternalId?: string; summary?: string; description?: string; body?: string; status?: LifecycleStatus; progress?: number; nature?: 'organizational' | 'technical'; codePath?: string; category?: string; tags?: string[] },
  payload: unknown,
): { node: NodeRow; conflicts: string[]; notes: string[] } {
  const conflicts: string[] = [];
  const notes: string[] = [];
  let parentId: string | null = null;
  let waitingFor: string | null = null;
  if (input.parentExternalId) {
    const parent = liveNodeByIdentity(ctx, input.parentExternalId);
    if (parent) parentId = parent.id;
    else waitingFor = input.parentExternalId;
  }
  // Similar names among siblings → never merge automatically, only flag (§6.3, §11.1)
  const siblingKinds = ['project', 'subproject'].includes(input.kind) ? ['project', 'subproject'] : ['module', 'submodule', 'feature', 'component', 'subproject', 'documentation'];
  const siblings = ctx.db.all<{ id: string; name: string }>(
    `SELECT id, name FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL AND kind IN (${siblingKinds.map(() => '?').join(',')})`,
    [parentId, ...siblingKinds],
  );
  const candidates = siblings
    .map((s) => ({ id: s.id, name: s.name, score: Number(nameSimilarity(s.name, input.name).toFixed(2)) }))
    .filter((s) => s.score >= 0.8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const categoryId = categoryIdBySlug(ctx, input.category);
  if (input.category && !categoryId) notes.push(`Kategorie „${input.category}“ unbekannt – ignoriert`);
  const node = createNode(
    ctx, { ...CLAUDE, eventId },
    {
      kind: input.kind, parentId, name: input.name, summary: input.summary ?? null, description: input.description ?? null,
      body: input.body ?? null, lifecycleStatus: input.status, progress: input.progress ?? null, nature: input.nature,
      codePath: input.codePath ?? null, categoryId, tags: input.tags,
    },
    { origin: 'claude', reviewState: waitingFor ? 'unassigned' : candidates.length ? 'possible_duplicate' : 'ok' },
  );
  bindIdentity(ctx, 'node', node.id, ext, eventId, payload);
  if (waitingFor) {
    conflicts.push(
      createConflict(ctx, {
        type: 'unresolved_parent', severity: 'info', source: 'claude', subjectType: 'node', subjectId: node.id,
        title: `„${input.name}“ verweist auf unbekanntes Elternobjekt ${waitingFor}`,
        description: 'Der Eintrag wurde sicher gespeichert und wird automatisch zugeordnet, sobald das Elternobjekt übermittelt wird. Alternativ manuell zuordnen.',
        details: { parentExternalId: waitingFor, eventId }, waitKey: `claude:node:${waitingFor}`, syncEventId: eventId,
      }),
    );
  }
  if (candidates.length) {
    conflicts.push(
      createConflict(ctx, {
        type: 'possible_duplicate', severity: 'warning', source: 'claude', subjectType: 'node', subjectId: node.id,
        title: `„${input.name}“ ähnelt bestehenden Einträgen`,
        description: 'Ähnliche Namen führen nie zu einer automatischen Zusammenführung. Der neue Eintrag wurde vorläufig separat gespeichert.',
        details: { incoming: { externalId: ext, name: input.name, summary: input.summary ?? null }, eventId },
        candidates: candidates.map((c) => ({ ...c, reason: 'Namensähnlichkeit' })), syncEventId: eventId,
      }),
    );
  }
  // this identity may be the parent somebody was waiting for
  const resolved = resolveWaiting(ctx, `claude:node:${ext}`, node.id);
  if (resolved) notes.push(`${resolved} wartende Einträge automatisch zugeordnet`);
  return { node, conflicts, notes };
}

// ── Event handlers ─────────────────────────────────────────────────────────
interface HandlerResult {
  status: 'applied' | 'conflict';
  message: string;
  entityType?: 'node' | 'idea';
  entityId?: string;
  conflictIds: string[];
}

function handleNodeLike(ctx: Ctx, ev: Extract<IngestEvent, { type: 'project.upsert' | 'node.upsert' }>): HandlerResult {
  const d = ev.data;
  let node = liveNodeByIdentity(ctx, d.externalId);
  let via = '';
  // Rank 3 (§11.1): a confirmed repository link may identify an existing project.
  if (!node && ev.type === 'project.upsert' && d.repository) {
    const linked = ctx.db.all<{ id: string }>(
      `SELECT n.id FROM project_repository_links l JOIN repositories r ON r.id = l.repository_id JOIN nodes n ON n.id = l.node_id
       WHERE r.full_name = ? AND l.status = 'confirmed' AND n.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM external_identities x WHERE x.entity_type = 'node' AND x.entity_id = n.id AND x.source = 'claude')`,
      [d.repository],
    );
    if (linked.length === 1) {
      node = getNode(ctx, linked[0].id)!;
      bindIdentity(ctx, 'node', node.id, d.externalId, ev.eventId, d);
      via = ` (Zuordnung über bestätigtes Repository ${d.repository})`;
      resolveWaiting(ctx, `claude:node:${d.externalId}`, node.id);
    }
  }
  const fields: ClaudeFields = {
    name: d.name, summary: d.summary, description: d.description, status: d.status, progress: d.progress,
    category: d.category, parentExternalId: d.parentExternalId,
    ...(ev.type === 'node.upsert' ? { nature: ev.data.nature, codePath: ev.data.codePath } : {}),
  };
  let conflicts: string[] = [];
  let message: string;
  if (node) {
    const r = applyClaudeUpdate(ctx, node, fields, ev.eventId);
    bindIdentity(ctx, 'node', node.id, d.externalId, ev.eventId, d);
    if (d.tags?.length) setTags(ctx, 'node', node.id, [...new Set([...getTags(ctx, 'node', node.id), ...d.tags])]);
    conflicts = r.conflicts;
    message = `„${node.name}“ ${r.changed.length ? `aktualisiert: ${r.changed.join(', ')}` : 'unverändert'}${via}${r.notes.length ? ` · ${r.notes.join(' · ')}` : ''}`;
  } else {
    const kind = ev.type === 'project.upsert' ? (d.parentExternalId ? 'subproject' : 'project') : ev.data.kind;
    const r = createFromClaude(ctx, ev.eventId, d.externalId, {
      kind, name: d.name, parentExternalId: d.parentExternalId, summary: d.summary, description: d.description, status: d.status,
      progress: d.progress, category: d.category, tags: d.tags,
      ...(ev.type === 'node.upsert' ? { nature: ev.data.nature, codePath: ev.data.codePath } : {}),
    }, d);
    node = r.node;
    conflicts = r.conflicts;
    message = `„${node.name}“ neu angelegt${r.notes.length ? ` · ${r.notes.join(' · ')}` : ''}`;
  }
  if (ev.type === 'project.upsert' && d.repository) {
    const repo = ensureRepository(ctx, d.repository, 'claude-hint');
    suggestLink(ctx, node.id, repo.id, 'claude-hint', null, `Von Claude genannt (${d.repository}) – bitte bestätigen`);
  }
  return { status: conflicts.length ? 'conflict' : 'applied', message, entityType: 'node', entityId: node.id, conflictIds: conflicts };
}

function handleIdea(ctx: Ctx, ev: Extract<IngestEvent, { type: 'idea.upsert' }>): HandlerResult {
  const d = ev.data;
  const fields = {
    title: d.title, summary: d.summary, description: d.description ?? null, problem: d.problem ?? null, goal: d.goal ?? null,
    benefit: d.benefit ?? null, audience: d.audience ?? null, categoryId: categoryIdBySlug(ctx, d.category) ?? undefined,
    features: d.features, technologies: d.technologies, complexity: d.complexity, effort: d.effort,
  };
  const existingId = findIdentity(ctx, 'idea', d.externalId);
  if (existingId && ctx.db.get('SELECT 1 FROM ideas WHERE id = ? AND deleted_at IS NULL', [existingId])) {
    updateIdea(ctx, { ...CLAUDE, eventId: ev.eventId }, existingId, { ...fields, tags: d.tags ? [...new Set([...getTags(ctx, 'idea', existingId), ...d.tags])] : undefined });
    bindIdentity(ctx, 'idea', existingId, d.externalId, ev.eventId, d);
    return { status: 'applied', message: `Idee „${d.title}“ aktualisiert`, entityType: 'idea', entityId: existingId, conflictIds: [] };
  }
  if (existingId) throw new Rejected('Die zugehörige Idee liegt im Papierkorb – bitte wiederherstellen.');
  const similar = findSimilarByTitle(ctx, d.title);
  const idea = createIdea(
    ctx, { ...CLAUDE, eventId: ev.eventId },
    {
      ...fields, tags: d.tags,
      parentIdeaId: similar[0]?.id ?? null,
      variantNote: similar[0] ? `Ähnlich zu „${similar[0].title}“ – bitte prüfen (keine automatische Zusammenführung)` : null,
    },
    { source: 'claude', sourceDetail: 'omega.ingest/v1', force: true },
  );
  bindIdentity(ctx, 'idea', idea.id, d.externalId, ev.eventId, d);
  return {
    status: 'applied',
    message: `Idee „${d.title}“ gespeichert${similar[0] ? ` (ähnlich zu „${similar[0].title}“, als mögliche Weiterentwicklung markiert)` : ''}`,
    entityType: 'idea', entityId: idea.id, conflictIds: [],
  };
}

function handleProgress(ctx: Ctx, ev: Extract<IngestEvent, { type: 'progress.report' }>): HandlerResult {
  const d = ev.data;
  const node = liveNodeByIdentity(ctx, d.externalId);
  if (!node) throw new Rejected(`Unbekanntes Ziel ${d.externalId}. Bitte zuerst das Projekt/Modul übermitteln (project.upsert / node.upsert).`);
  const r = applyClaudeUpdate(ctx, node, { status: d.status, progress: d.progress }, ev.eventId);
  logActivity(ctx, { ...CLAUDE, eventId: ev.eventId }, {
    action: 'claude.progress',
    summary: `Fortschritt „${node.name}“: ${d.summary}${d.status ? ` · Status: ${LIFECYCLE_LABELS[d.status]}` : ''}${d.progress !== undefined ? ` · ${d.progress} %` : ''}`,
    entityType: 'node', entityId: node.id, entityName: node.name, projectId: rootProjectId(ctx, node.id),
    data: { details: d.details ?? null, changed: r.changed },
  });
  ctx.db.run('UPDATE nodes SET last_activity_at = ? WHERE id = ?', [nowIso(), node.id]);
  return { status: r.conflicts.length ? 'conflict' : 'applied', message: `Fortschritt für „${node.name}“ protokolliert`, entityType: 'node', entityId: node.id, conflictIds: r.conflicts };
}

function handleDoc(ctx: Ctx, ev: Extract<IngestEvent, { type: 'doc.upsert' }>): HandlerResult {
  const d = ev.data;
  const node = liveNodeByIdentity(ctx, d.externalId);
  if (node) {
    if (node.kind !== 'documentation') throw new Rejected(`${d.externalId} ist keine Dokumentation.`);
    const r = applyClaudeUpdate(ctx, node, { name: d.title, body: d.body, parentExternalId: d.parentExternalId }, ev.eventId);
    bindIdentity(ctx, 'node', node.id, d.externalId, ev.eventId, { title: d.title });
    return { status: r.conflicts.length ? 'conflict' : 'applied', message: `Dokumentation „${d.title}“ ${r.changed.length ? 'aktualisiert' : 'unverändert'}`, entityType: 'node', entityId: node.id, conflictIds: r.conflicts };
  }
  const r = createFromClaude(ctx, ev.eventId, d.externalId, { kind: 'documentation', name: d.title, body: d.body, parentExternalId: d.parentExternalId, status: 'concept' }, { title: d.title });
  return { status: r.conflicts.length ? 'conflict' : 'applied', message: `Dokumentation „${d.title}“ angelegt`, entityType: 'node', entityId: r.node.id, conflictIds: r.conflicts };
}

function handleRename(ctx: Ctx, ev: Extract<IngestEvent, { type: 'node.rename' }>): HandlerResult {
  const node = liveNodeByIdentity(ctx, ev.data.externalId);
  if (!node) throw new Rejected(`Unbekanntes Ziel ${ev.data.externalId}.`);
  const r = applyClaudeUpdate(ctx, node, { name: ev.data.name }, ev.eventId);
  return { status: r.conflicts.length ? 'conflict' : 'applied', message: r.changed.length ? `Umbenannt in „${ev.data.name}“` : 'Name unverändert', entityType: 'node', entityId: node.id, conflictIds: r.conflicts };
}

function handleArchive(ctx: Ctx, ev: Extract<IngestEvent, { type: 'node.archive' }>): HandlerResult {
  const node = liveNodeByIdentity(ctx, ev.data.externalId);
  if (!node) throw new Rejected(`Unbekanntes Ziel ${ev.data.externalId}.`);
  setArchived(ctx, { ...CLAUDE, eventId: ev.eventId }, node.id, true);
  return { status: 'applied', message: `„${node.name}“ archiviert${ev.data.reason ? ` (${ev.data.reason})` : ''} – Daten bleiben erhalten`, entityType: 'node', entityId: node.id, conflictIds: [] };
}

function dispatch(ctx: Ctx, ev: IngestEvent): HandlerResult {
  switch (ev.type) {
    case 'project.upsert':
    case 'node.upsert':
      return handleNodeLike(ctx, ev);
    case 'idea.upsert':
      return handleIdea(ctx, ev);
    case 'progress.report':
      return handleProgress(ctx, ev);
    case 'doc.upsert':
      return handleDoc(ctx, ev);
    case 'node.rename':
      return handleRename(ctx, ev);
    case 'node.archive':
      return handleArchive(ctx, ev);
  }
}

// ── Pipeline ───────────────────────────────────────────────────────────────
interface StoredEvent { id: string; payload_hash: string; status: string; target_type: string | null; target_id: string | null; message: string | null; attempts: number }

/**
 * Processes one raw event: validate → idempotency check → identity resolution → apply in a transaction
 * → protocol. Every outcome (including validation errors) is recorded in sync_events.
 */
export function processEvent(ctx: Ctx, runId: string | null, raw: unknown, client: string): IngestEventResult {
  const eventIdRaw = (raw as { eventId?: unknown })?.eventId;
  const eventId = typeof eventIdRaw === 'string' && eventIdRaw.trim() ? eventIdRaw.trim().slice(0, 200) : null;
  const parsed = ingestEventSchema.safeParse(raw);
  const now = nowIso();
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const fallbackId = eventId ?? `invalid-${sha256(stableStringify(raw)).slice(0, 16)}`;
    if (!ctx.db.get('SELECT 1 FROM sync_events WHERE source = ? AND event_id = ?', [SOURCE, fallbackId])) {
      ctx.db.run(
        `INSERT INTO sync_events(id, run_id, source, event_id, type, payload, payload_hash, status, message, error, client, received_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected', 'Validierung fehlgeschlagen', ?, ?, ?, ?)`,
        [newId('sev'), runId, SOURCE, fallbackId, String((raw as { type?: unknown })?.type ?? 'unknown').slice(0, 60), JSON.stringify(raw ?? null).slice(0, 200_000),
          sha256(stableStringify(raw)), JSON.stringify(issues), client, now, now],
      );
    }
    return { eventId: fallbackId, status: 'rejected', message: 'Validierung fehlgeschlagen – nichts gespeichert.', issues };
  }
  const ev = parsed.data;
  const hash = sha256(stableStringify({ type: ev.type, data: ev.data }));
  const stored = ctx.db.get<StoredEvent>('SELECT id, payload_hash, status, target_type, target_id, message, attempts FROM sync_events WHERE source = ? AND event_id = ?', [SOURCE, ev.eventId]);
  if (stored) {
    if (stored.payload_hash !== hash) {
      return { eventId: ev.eventId, type: ev.type, status: 'rejected', message: 'Diese eventId wurde bereits mit anderem Inhalt verwendet. Bitte eine neue eventId vergeben.' };
    }
    if (['applied', 'conflict', 'duplicate'].includes(stored.status)) {
      ctx.db.run('UPDATE sync_events SET attempts = attempts + 1 WHERE id = ?', [stored.id]);
      return {
        eventId: ev.eventId, type: ev.type, status: 'duplicate', message: `Bereits verarbeitet (${stored.message ?? stored.status}) – keine Änderung.`,
        entityType: (stored.target_type as 'node' | 'idea') ?? undefined, entityId: stored.target_id ?? undefined,
      };
    }
  }
  const rowId = stored?.id ?? newId('sev');
  if (stored) {
    ctx.db.run(`UPDATE sync_events SET status = 'received', attempts = attempts + 1, run_id = ?, received_at = ? WHERE id = ?`, [runId, now, rowId]);
  } else {
    ctx.db.run(
      `INSERT INTO sync_events(id, run_id, source, event_id, type, payload, payload_hash, status, client, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
      [rowId, runId, SOURCE, ev.eventId, ev.type, JSON.stringify(ev), hash, client, now],
    );
  }
  let status: IngestResultStatus;
  let result: HandlerResult | null = null;
  let message: string;
  let error: string | null = null;
  try {
    result = ctx.db.write(() => dispatch(ctx, ev));
    status = result.status;
    message = result.message;
  } catch (e) {
    if (e instanceof Rejected || e instanceof AppError) {
      status = 'rejected';
      message = e.message;
    } else {
      status = 'failed';
      message = 'Interner Fehler bei der Verarbeitung – Ereignis gespeichert, Wiederholung möglich.';
      error = (e as Error).message;
      ctx.log.error('ingest event failed', { eventId: ev.eventId, error: (e as Error).message });
    }
  }
  ctx.db.run(
    'UPDATE sync_events SET status = ?, target_type = ?, target_id = ?, message = ?, error = ?, processed_at = ? WHERE id = ?',
    [status, result?.entityType ?? null, result?.entityId ?? null, message, error, nowIso(), rowId],
  );
  return {
    eventId: ev.eventId, type: ev.type, status, message,
    entityType: result?.entityType, entityId: result?.entityId, conflictId: result?.conflictIds[0],
  };
}

export function processEnvelope(ctx: Ctx, body: unknown, opts: { trigger: 'api' | 'file' | 'retry'; client?: string }): IngestResponse {
  const env = ingestEnvelopeSchema.safeParse(body);
  if (!env.success) {
    throw badRequest(`Ungültiger Umschlag – erwartet { schema: "${INGEST_SCHEMA_ID}", events: [...] }`, env.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const client = [opts.client, env.data.source?.client].filter(Boolean).join(' · ') || 'unbekannt';
  const runId = startRun(ctx, opts.trigger === 'file' ? 'file' : 'claude', opts.trigger, env.data.source?.label ?? client);
  const results = env.data.events.map((raw) => processEvent(ctx, runId, raw, client));
  const summary: Record<IngestResultStatus, number> = { applied: 0, duplicate: 0, conflict: 0, rejected: 0, failed: 0 };
  for (const r of results) summary[r.status]++;
  const runStatus = summary.failed + summary.rejected === 0 ? 'succeeded' : summary.applied + summary.conflict + summary.duplicate > 0 ? 'partial' : 'failed';
  finishRun(ctx, runId, runStatus, summary);
  ctx.db.setMeta('last_claude_ingest_at', nowIso());
  if (summary.failed) {
    notify(ctx, { level: 'error', title: 'Claude-Übermittlung teilweise fehlgeschlagen', body: `${summary.failed} Ereignisse fehlgeschlagen – im Sync Center wiederholbar.`, link: '/sync', dedupeKey: 'ingest-failed' });
  }
  return { schema: INGEST_SCHEMA_ID, runId, summary, results };
}

/** Re-processes a stored event (failed/rejected ones, e.g. after the missing parent arrived). */
export function retryEvent(ctx: Ctx, syncEventRowId: string): IngestEventResult {
  const row = ctx.db.get<{ payload: string; status: string; client: string | null }>('SELECT payload, status, client FROM sync_events WHERE id = ?', [syncEventRowId]);
  if (!row) throw badRequest('Ereignis nicht gefunden.');
  if (!['failed', 'rejected'].includes(row.status)) throw badRequest('Nur fehlgeschlagene oder abgelehnte Ereignisse können wiederholt werden.');
  const runId = startRun(ctx, 'claude', 'retry', 'Wiederholung');
  const res = processEvent(ctx, runId, parseJson(row.payload, null), row.client ?? 'retry');
  finishRun(ctx, runId, res.status === 'failed' || res.status === 'rejected' ? 'failed' : 'succeeded', { [res.status]: 1 });
  return res;
}

/** For the MCP server / scripts: known external ids so that Claude can reuse them. */
export function listKnownIdentities(ctx: Ctx) {
  return ctx.db.all<{ external_id: string; entity_type: string; entity_id: string; name: string | null; kind: string | null; parent_external_id: string | null; lifecycle_status: string | null; progress: number | null }>(
    `SELECT x.external_id, x.entity_type, x.entity_id,
       COALESCE(n.name, i.title) name, n.kind, n.lifecycle_status, n.progress,
       (SELECT px.external_id FROM external_identities px WHERE px.entity_type = 'node' AND px.entity_id = n.parent_id AND px.source = 'claude') parent_external_id
     FROM external_identities x
     LEFT JOIN nodes n ON x.entity_type = 'node' AND n.id = x.entity_id AND n.deleted_at IS NULL
     LEFT JOIN ideas i ON x.entity_type = 'idea' AND i.id = x.entity_id AND i.deleted_at IS NULL
     WHERE x.source = 'claude' AND (n.id IS NOT NULL OR i.id IS NOT NULL) ORDER BY x.entity_type, x.external_id LIMIT 2000`,
  );
}

export { requireIdea };
