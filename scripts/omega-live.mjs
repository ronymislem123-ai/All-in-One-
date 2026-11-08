#!/usr/bin/env node
/**
 * omega-live – stream a development session into the OMEGA Werkstatt from any shell (no dependencies).
 *
 *   export OMEGA_URL=http://127.0.0.1:4317 OMEGA_TOKEN=<Token mit Bereich ingest> OMEGA_LIVE_ID=mein-projekt/2026-11-06
 *   node scripts/omega-live.mjs start "Titel" --goal "…" --state building --phase Backend --milestones "design:Design,frontend:Frontend,backend:Backend"
 *   node scripts/omega-live.mjs log research "Codebasis gelesen" "Hono + SQLite …"
 *   node scripts/omega-live.mjs log decision "SSE statt WebSocket" "Begründung …"
 *   node scripts/omega-live.mjs milestone backend 70 [--label "Backend"]
 *   node scripts/omega-live.mjs task t1 doing [--title "Routen schreiben"] [--detail "…"]
 *   node scripts/omega-live.mjs shot ./screenshot.png "Startseite" ["Bildunterschrift"]
 *   node scripts/omega-live.mjs preview http://localhost:5173 ["Dev-Server"]
 *   node scripts/omega-live.mjs status --state testing --phase QA --now "Tests laufen" [--progress 80]
 *
 * Session id: --id <externalId> or OMEGA_LIVE_ID. Exit code 1 on rejection.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';

const BASE = (process.env.OMEGA_URL ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
const TOKEN = process.env.OMEGA_TOKEN ?? '';
const MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  } else positional.push(a);
}
const [command, ...rest] = positional;
const sessionId = flags.id ?? process.env.OMEGA_LIVE_ID;

function fail(msg) { console.error(msg); process.exit(1); }
if (!TOKEN) fail('OMEGA_TOKEN ist nicht gesetzt (Einstellungen → Integrationen → Token mit Bereich "ingest").');
if (!command) fail('Befehl fehlt. Siehe Kopf der Datei für die Verwendung.');
if (!sessionId) fail('Sitzung fehlt: --id <externalId> oder OMEGA_LIVE_ID setzen.');

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  } catch (e) { fail(`OMEGA nicht erreichbar unter ${BASE}: ${e.message}`); }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) fail(`OMEGA antwortete ${res.status}: ${json?.error?.message ?? text}${json?.error?.details ? '\n' + JSON.stringify(json.error.details) : ''}`);
  return json;
}

async function send(events) {
  const r = await post(`/api/ingest/v1/live/sessions/${encodeURIComponent(sessionId)}/events`, { schema: 'omega.live/v1', events });
  for (const x of r.results) console.log(`[${x.status}] ${x.message}${x.issues ? ' ' + JSON.stringify(x.issues) : ''}`);
  if (r.summary.rejected) process.exit(1);
}

const hashId = (...parts) => `live:${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`;
const num = (v) => (v === undefined ? undefined : Number(v));

switch (command) {
  case 'start': {
    const [title] = rest;
    if (!title) fail('start: Titel fehlt.');
    const milestones = flags.milestones ? String(flags.milestones).split(',').map((m, i) => { const [key, label] = m.split(':'); return { key: key.trim(), label: (label ?? key).trim(), order: i }; }) : undefined;
    const tasks = flags.tasks ? String(flags.tasks).split(',').map((t, i) => { const [key, title] = t.split(':'); return { key: key.trim(), title: (title ?? key).trim(), order: i }; }) : undefined;
    const r = await post('/api/ingest/v1/live/sessions', {
      externalId: sessionId, title, goal: flags.goal, state: flags.state, phase: flags.phase, previewUrl: flags.preview, now: flags.now, progress: num(flags.progress),
      projectExternalId: flags.project, milestones, tasks,
    });
    console.log(`${r.created ? 'Gestartet' : 'Aktualisiert'}: ${r.session.title} → ${BASE}/live/${r.session.id}`);
    break;
  }
  case 'log': {
    const [kind, title, body] = rest;
    if (!kind || !title) fail('log: <kind> "Titel" ["Text"]');
    await send([{ eventId: flags.event ?? hashId(kind, title, body ?? ''), kind, title, body }]);
    break;
  }
  case 'milestone': {
    const [key, progress] = rest;
    if (!key) fail('milestone: <key> [progress]');
    await send([{ eventId: `live:${Date.now()}:${key}`, kind: 'milestone', title: flags.title ?? `${flags.label ?? key}: ${progress ?? ''} %`.trim(), milestone: { key, label: flags.label, progress: num(progress), status: flags.status } }]);
    break;
  }
  case 'task': {
    const [key, status] = rest;
    if (!key) fail('task: <key> [status] [--title …]');
    await send([{ eventId: `live:${Date.now()}:${key}`, kind: 'task', title: `${flags.title ?? key}${status ? ` → ${status}` : ''}`, task: { key, status, title: flags.title, detail: flags.detail, order: num(flags.order) } }]);
    break;
  }
  case 'shot': {
    const [file, title, caption] = rest;
    if (!file || !title) fail('shot: <datei> "Titel" ["Bildunterschrift"]');
    const mime = flags.mime ?? MIMES[extname(file).toLowerCase()];
    if (!mime) fail(`Unbekannter Bildtyp für ${file} (--mime angeben).`);
    const buf = await readFile(file);
    const base64 = buf.toString('base64');
    await send([{ eventId: `live:shot:${createHash('sha256').update(buf).digest('hex').slice(0, 24)}`, kind: 'screenshot', title, image: { mime, base64, caption, width: num(flags.width), height: num(flags.height) } }]);
    break;
  }
  case 'preview': {
    const [url, note] = rest;
    await send([{ eventId: `live:preview:${Date.now()}`, kind: 'preview', title: url && url !== 'none' ? `Vorschau: ${url}` : 'Vorschau beendet', preview: { url: url && url !== 'none' ? url : null, note } }]);
    break;
  }
  case 'status': {
    const status = { state: flags.state, phase: flags.phase, progress: flags.progress === 'none' ? null : num(flags.progress), now: flags.now === 'none' ? null : flags.now };
    await send([{ eventId: `live:status:${Date.now()}`, kind: 'status', title: flags.title ?? status.now ?? status.phase ?? status.state ?? 'Status', status }]);
    break;
  }
  default:
    fail(`Unbekannter Befehl „${command}“. Befehle: start, log, milestone, task, shot, preview, status.`);
}
