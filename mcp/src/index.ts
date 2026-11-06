/**
 * OMEGA Infinity – MCP server (stdio).
 *
 * Lets Claude Code / Claude Desktop push structured project information into OMEGA through the
 * authenticated ingest API (omega.ingest/v1). It only ever talks to YOUR OMEGA instance and needs a
 * token with scope "ingest" (+ "read" for omega_list). It cannot read Claude conversations – Claude
 * decides what to send by calling these tools.
 *
 * Env: OMEGA_URL (default http://127.0.0.1:4317), OMEGA_TOKEN (required).
 */
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  INGEST_SCHEMA_ID, docUpsertData, ideaUpsertData, nodeArchiveData, nodeRenameData, nodeUpsertData, progressReportData,
  projectUpsertData, type IngestResponse,
} from '../../shared/src/ingest';

const BASE = (process.env.OMEGA_URL ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
const TOKEN = process.env.OMEGA_TOKEN ?? '';

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
}

/** Content-derived event id: sending identical data twice is a no-op on the server (idempotent). */
function eventId(type: string, data: unknown): string {
  const salt = type === 'progress.report' ? new Date().toISOString().slice(0, 10) : '';
  return `mcp:${createHash('sha256').update(`${type}|${salt}|${stable(data)}`).digest('hex').slice(0, 32)}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!TOKEN) throw new Error('OMEGA_TOKEN ist nicht gesetzt. Lege in OMEGA unter Einstellungen → Integrationen ein Token an.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`OMEGA nicht erreichbar unter ${BASE}: ${(e as Error).message}. Es wurde nichts übertragen.`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* keep text */ }
    throw new Error(`OMEGA antwortete ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

async function send(events: { type: string; data: unknown; eventId?: string }[]) {
  const body = {
    schema: INGEST_SCHEMA_ID,
    source: { client: 'mcp', label: 'OMEGA MCP-Server' },
    events: events.map((e) => ({ eventId: e.eventId ?? eventId(e.type, e.data), type: e.type, data: e.data })),
  };
  const res = await call<IngestResponse>('/api/ingest/v1/events', { method: 'POST', body: JSON.stringify(body) });
  const lines = res.results.map((r) => `• [${r.status}] ${r.type ?? ''} ${r.eventId}: ${r.message}${r.issues ? ` (${r.issues.map((i) => `${i.path}: ${i.message}`).join('; ')})` : ''}`);
  const s = res.summary;
  return {
    content: [{
      type: 'text' as const,
      text: `OMEGA-Übermittlung (Lauf ${res.runId}): ${s.applied} übernommen, ${s.duplicate} bereits vorhanden, ${s.conflict} mit Konflikt (zur Prüfung in OMEGA), ${s.rejected} abgelehnt, ${s.failed} fehlgeschlagen.\n${lines.join('\n')}`,
    }],
    isError: s.failed + s.rejected > 0 && s.applied + s.duplicate + s.conflict === 0,
  };
}

const wrap = <A>(fn: (a: A) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>) => async (a: A) => {
  try {
    return await fn(a);
  } catch (e) {
    return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true };
  }
};

const server = new McpServer({ name: 'omega-infinity', version: '0.1.1' });

const ID_HINT = 'Verwende stabile, wiederverwendbare externalIds (z. B. "mein-projekt" und "mein-projekt/modulname"). Nutze omega_list, um bestehende IDs zu finden. Gleiche externalId = Aktualisierung, niemals Duplikat.';

server.registerTool('omega_status', {
  title: 'OMEGA-Verbindung prüfen',
  description: 'Prüft, ob OMEGA erreichbar ist und das Token gültig ist.',
}, wrap(async () => {
  const r = await call<{ ok: boolean; user: string; scopes: string[] }>('/api/ingest/v1/ping');
  return { content: [{ type: 'text', text: `Verbunden mit OMEGA (${BASE}) als ${r.user}. Bereiche: ${r.scopes.join(', ')}.` }] };
}));

server.registerTool('omega_list', {
  title: 'Bekannte OMEGA-Objekte auflisten',
  description: 'Listet alle Projekte, Module und Ideen, die Claude bereits übermittelt hat, mit ihren externalIds (benötigt Token-Bereich "read").',
}, wrap(async () => {
  const rows = await call<{ external_id: string; entity_type: string; name: string | null; kind: string | null; parent_external_id: string | null; lifecycle_status: string | null; progress: number | null }[]>('/api/ingest/v1/identities');
  if (!rows.length) return { content: [{ type: 'text', text: 'Noch keine von Claude übermittelten Objekte.' }] };
  const text = rows.map((r) => `${r.entity_type === 'idea' ? 'Idee' : r.kind}: ${r.name} — externalId "${r.external_id}"${r.parent_external_id ? ` (unter "${r.parent_external_id}")` : ''}${r.lifecycle_status ? ` · ${r.lifecycle_status}` : ''}${r.progress != null ? ` · ${r.progress} %` : ''}`).join('\n');
  return { content: [{ type: 'text', text }] };
}));

server.registerTool('omega_upsert_project', {
  title: 'Projekt anlegen/aktualisieren',
  description: `Legt ein Projekt (oder Unterprojekt mit parentExternalId) in OMEGA an oder aktualisiert es. ${ID_HINT} Optional "repository" als "owner/name" – OMEGA schlägt die Verknüpfung vor, der Besitzer bestätigt.`,
  inputSchema: projectUpsertData.shape,
}, wrap(async (data) => send([{ type: 'project.upsert', data }])));

server.registerTool('omega_upsert_module', {
  title: 'Modul/Funktion anlegen/aktualisieren',
  description: `Legt ein Modul, Untermodul, eine Funktion oder Komponente unter einem bestehenden Objekt an (parentExternalId). ${ID_HINT} "codePath" ist der Pfad im verknüpften Repository (z. B. "server/src/modules"), damit OMEGA den Code-Status prüfen kann.`,
  inputSchema: nodeUpsertData.shape,
}, wrap(async (data) => send([{ type: 'node.upsert', data }])));

server.registerTool('omega_report_progress', {
  title: 'Fortschritt melden',
  description: 'Meldet einen Entwicklungsfortschritt zu einem Projekt/Modul (Zusammenfassung, optional Status und Prozent). Status "claude_reported_done" bedeutet: von Claude als abgeschlossen beschrieben – nicht technisch geprüft.',
  inputSchema: progressReportData.shape,
}, wrap(async (data) => send([{ type: 'progress.report', data }])));

server.registerTool('omega_add_idea', {
  title: 'Idee speichern',
  description: `Speichert eine Idee im AI Idea Hub von OMEGA. ${ID_HINT}`,
  inputSchema: ideaUpsertData.shape,
}, wrap(async (data) => send([{ type: 'idea.upsert', data }])));

server.registerTool('omega_upsert_doc', {
  title: 'Dokumentation speichern',
  description: 'Speichert eine Markdown-Dokumentation unter einem Projekt/Modul (z. B. Architektur, Entscheidungen, Übergabe).',
  inputSchema: docUpsertData.shape,
}, wrap(async (data) => send([{ type: 'doc.upsert', data }])));

server.registerTool('omega_rename', {
  title: 'Objekt umbenennen',
  description: 'Benennt ein Projekt/Modul um. Wurde der Name auf der Website geändert, entsteht ein Konflikt statt eines stillen Überschreibens.',
  inputSchema: nodeRenameData.shape,
}, wrap(async (data) => send([{ type: 'node.rename', data }])));

server.registerTool('omega_archive', {
  title: 'Objekt archivieren',
  description: 'Archiviert ein Projekt/Modul (nichts wird gelöscht; jederzeit reaktivierbar).',
  inputSchema: nodeArchiveData.shape,
}, wrap(async (data) => send([{ type: 'node.archive', data }])));

server.registerTool('omega_send_events', {
  title: 'Mehrere Ereignisse senden',
  description: `Sendet bis zu 100 Ereignisse im Format ${INGEST_SCHEMA_ID} auf einmal (Typen: project.upsert, node.upsert, idea.upsert, progress.report, doc.upsert, node.rename, node.archive).`,
  inputSchema: { events: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()), eventId: z.string().optional() })).min(1).max(100) },
}, wrap(async ({ events }) => send(events)));

await server.connect(new StdioServerTransport());
