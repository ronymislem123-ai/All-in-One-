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
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  INGEST_SCHEMA_ID, docUpsertData, ideaUpsertData, nodeArchiveData, nodeRenameData, nodeUpsertData, progressReportData,
  projectUpsertData, type IngestResponse,
} from '../../shared/src/ingest';
import {
  LIVE_EVENT_KIND_LABELS, LIVE_IMAGE_MAX_BYTES, LIVE_STATES, MILESTONE_STATUSES, TASK_STATUSES, liveSessionUpsertData,
  type LiveEventInput, type LiveEventResult,
} from '../../shared/src/devlive';

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

const server = new McpServer({ name: 'omega-infinity', version: '0.1.0' });

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

// ── Werkstatt (omega.live/v1): live development stream ───────────────────
const LIVE_HINT = 'Die Sitzung wird über "sessionId" (die externalId aus omega_live_start, z. B. "mein-projekt/2026-11-06") angesprochen.';
const liveSessionId = z.string().trim().min(1).max(200).describe('externalId der Live-Sitzung (aus omega_live_start)');

async function sendLive(sessionId: string, events: LiveEventInput[]) {
  const res = await call<{ summary: Record<string, number>; results: LiveEventResult[] }>(`/api/ingest/v1/live/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST', body: JSON.stringify({ schema: 'omega.live/v1', events }),
  });
  const lines = res.results.map((r) => `• [${r.status}] ${r.message}${r.issues ? ` (${r.issues.map((i) => `${i.path}: ${i.message}`).join('; ')})` : ''}`);
  const s = res.summary;
  return { content: [{ type: 'text' as const, text: `Werkstatt: ${s.applied} übernommen, ${s.duplicate} bereits vorhanden, ${s.rejected} abgelehnt.\n${lines.join('\n')}` }], isError: s.applied + s.duplicate === 0 };
}

server.registerTool('omega_live_start', {
  title: 'Live-Sitzung starten/aktualisieren',
  description: `Startet (oder aktualisiert) eine Live-Entwicklungssitzung in der OMEGA-Werkstatt. Der Besitzer sieht Fortschritt, Aufgaben, Protokoll, Screenshots und Vorschau in Echtzeit. Rufe dies zu Beginn einer Entwicklungsaufgabe auf und übergib Meilensteine (z. B. design, frontend, backend, datenbank, funktionen, optimierung) und die geplanten Aufgaben. Gleiche externalId = Aktualisierung. ${ID_HINT}`,
  inputSchema: liveSessionUpsertData.shape,
}, wrap(async (data) => {
  const r = await call<{ session: { id: string; title: string; progress: number }; created: boolean }>('/api/ingest/v1/live/sessions', { method: 'POST', body: JSON.stringify(data) });
  return { content: [{ type: 'text', text: `Live-Sitzung „${r.session.title}“ ${r.created ? 'gestartet' : 'aktualisiert'} (Fortschritt ${r.session.progress} %). Ansicht in OMEGA: ${BASE}/live/${r.session.id}` }] };
}));

server.registerTool('omega_live_log', {
  title: 'Protokolleintrag senden',
  description: `Schreibt einen Eintrag ins Live-Protokoll: Recherche-Erkenntnisse (research), Pläne (plan), Entscheidungen mit Begründung (decision), was gerade programmiert wird (build), Testergebnisse (test), Probleme und ihre Lösung (problem) oder Notizen (log). Sende regelmäßig kurze Einträge, damit der Besitzer den Prozess mitverfolgen kann. ${LIVE_HINT}`,
  inputSchema: {
    sessionId: liveSessionId,
    kind: z.enum(['log', 'research', 'plan', 'decision', 'build', 'test', 'problem']).describe(Object.entries(LIVE_EVENT_KIND_LABELS).map(([k, v]) => `${k}=${v}`).join(', ')),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(20000).optional().describe('Details (Klartext, `Code` in Backticks)'),
    eventId: z.string().trim().max(160).optional().describe('Optional: eigene stabile ID (sonst aus dem Inhalt abgeleitet)'),
  },
}, wrap(async ({ sessionId, eventId, ...e }) => sendLive(sessionId, [{ ...e, eventId: eventId ?? eventId_(e) }])));

server.registerTool('omega_live_milestone', {
  title: 'Meilenstein aktualisieren',
  description: `Setzt den Fortschritt eines Meilensteins (0–100) – z. B. design, frontend, backend, datenbank, funktionen, optimierung. Beim ersten Mal ein label mitgeben. ${LIVE_HINT}`,
  inputSchema: {
    sessionId: liveSessionId, key: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120).optional(),
    progress: z.number().min(0).max(100).optional(), status: z.enum(MILESTONE_STATUSES).optional(),
    title: z.string().trim().max(200).optional().describe('Protokolltext, z. B. „Backend fertig“'),
  },
}, wrap(async ({ sessionId, title, ...m }) => sendLive(sessionId, [{ kind: 'milestone', title: title ?? `${m.label ?? m.key}: ${m.progress ?? ''} %`.trim(), milestone: m, eventId: `live:${Date.now()}:${m.key}` }])));

server.registerTool('omega_live_task', {
  title: 'Aufgabe anlegen/aktualisieren',
  description: `Legt eine Aufgabe an oder setzt ihren Status (todo, doing, done, blocked). Markiere die aktuelle Aufgabe als "doing", damit sichtbar ist, was gerade passiert. ${LIVE_HINT}`,
  inputSchema: {
    sessionId: liveSessionId, key: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(TASK_STATUSES).optional(), detail: z.string().trim().max(1000).optional(), order: z.number().int().min(0).max(10000).optional(),
  },
}, wrap(async ({ sessionId, ...t }) => sendLive(sessionId, [{ kind: 'task', title: `${t.title ?? t.key}${t.status ? ` → ${t.status}` : ''}`, task: t, eventId: `live:${Date.now()}:${t.key}` }])));

const MIMES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
server.registerTool('omega_live_screenshot', {
  title: 'Screenshot/Bild senden',
  description: `Sendet ein Bild (Screenshot der Oberfläche, Mockup, Diagramm) in die Werkstatt. Entweder "path" (Datei auf dieser Maschine, max. ${Math.round(LIVE_IMAGE_MAX_BYTES / 1024 / 1024)} MB; PNG/JPEG/WebP/GIF/SVG) oder "base64". ${LIVE_HINT}`,
  inputSchema: {
    sessionId: liveSessionId, title: z.string().trim().min(1).max(200), caption: z.string().trim().max(500).optional(),
    path: z.string().trim().min(1).optional().describe('Dateipfad'), base64: z.string().min(1).optional(), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']).optional(),
    width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  },
}, wrap(async ({ sessionId, title, caption, path, base64, mime, width, height }) => {
  let data = base64;
  let type = mime;
  if (path) {
    const buf = await readFile(path);
    if (buf.length > LIVE_IMAGE_MAX_BYTES) throw new Error(`Datei ist zu groß (${(buf.length / 1024 / 1024).toFixed(1)} MB, max. ${Math.round(LIVE_IMAGE_MAX_BYTES / 1024 / 1024)} MB).`);
    data = buf.toString('base64');
    type = type ?? MIMES[extname(path).toLowerCase()];
  }
  if (!data || !type) throw new Error('Bitte "path" (mit bekannter Endung) oder "base64" + "mime" angeben.');
  return sendLive(sessionId, [{ kind: 'screenshot', title, image: { mime: type, base64: data, caption, width, height }, eventId: `live:shot:${createHash('sha256').update(data).digest('hex').slice(0, 24)}` }]);
}));

server.registerTool('omega_live_preview', {
  title: 'Vorschau-Adresse setzen',
  description: `Teilt OMEGA mit, unter welcher Adresse die laufende Vorschau (Dev-Server, Staging) erreichbar ist. Nur http(s). ${LIVE_HINT}`,
  inputSchema: { sessionId: liveSessionId, url: z.string().trim().url().nullable(), note: z.string().trim().max(300).optional() },
}, wrap(async ({ sessionId, url, note }) => sendLive(sessionId, [{ kind: 'preview', title: url ? `Vorschau: ${url}` : 'Vorschau beendet', preview: { url, note }, eventId: `live:preview:${Date.now()}` }])));

server.registerTool('omega_live_status', {
  title: 'Status/Phase melden',
  description: `Setzt Zustand (${LIVE_STATES.join(', ')}), Phase (z. B. „Frontend“), Gesamtfortschritt und den Satz „Gerade in Arbeit“. Melde "done" am Ende. ${LIVE_HINT}`,
  inputSchema: {
    sessionId: liveSessionId, state: z.enum(LIVE_STATES).optional(), phase: z.string().trim().max(120).optional(),
    progress: z.number().min(0).max(100).nullable().optional(), now: z.string().trim().max(300).nullable().optional(), title: z.string().trim().max(200).optional(),
  },
}, wrap(async ({ sessionId, title, ...status }) => sendLive(sessionId, [{ kind: 'status', title: title ?? status.now ?? status.phase ?? status.state ?? 'Status', status, eventId: `live:status:${Date.now()}` }])));

/** Content-derived id for log entries so a repeated identical entry is a no-op. */
function eventId_(e: { kind: string; title: string; body?: string }): string {
  return `live:${createHash('sha256').update(`${e.kind}|${e.title}|${e.body ?? ''}`).digest('hex').slice(0, 24)}`;
}

await server.connect(new StdioServerTransport());
