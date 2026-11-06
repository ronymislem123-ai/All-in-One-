import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCheck, ExternalLink, Flag, Hammer, Image as ImageIcon, ListChecks, MonitorPlay, RefreshCw, ScrollText, Smartphone, Monitor, Trash2,
} from 'lucide-react';
import { api, qs } from '../../api/client';
import { dateTime, relTime } from '../../lib/format';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Progress, Ring, Skeleton, useToast } from '../../components/ui';
import { PageHeader } from '../../components/layout/PageHeader';
import { LIVE_EVENT_KIND_LABELS, LIVE_STATE_LABELS, TASK_STATUS_LABELS, type LiveEventKind, type LiveState, type TaskStatus } from '@shared/devlive';
import './live.css';

// ── Types (mirror server DTOs) ─────────────────────────────────────────────
interface LiveSession {
  id: string; externalId: string; title: string; goal: string | null; state: LiveState; stateLabel: string; phase: string | null; progress: number; progressExplicit: boolean;
  now: string | null; previewUrl: string | null; previewNote: string | null; projectId: string | null; projectName: string | null; source: string;
  startedAt: string; updatedAt: string; lastEventAt: string | null; endedAt: string | null; counts: { events: number; media: number; tasksDone: number; tasksTotal: number };
}
interface Milestone { key: string; label: string; order: number; progress: number; status: 'pending' | 'active' | 'done'; updatedAt: string }
interface Task { key: string; title: string; detail: string | null; order: number; status: TaskStatus; updatedAt: string }
interface Media { id: string; mime: string; size: number; width: number | null; height: number | null; createdAt: string; title: string | null; caption: string | null; eventId: number | null }
interface LiveEvent { id: number; eventId: string | null; at: string; kind: LiveEventKind; title: string; body: string | null; data: Record<string, unknown> | null; mediaId: string | null }
interface Detail { session: LiveSession; milestones: Milestone[]; tasks: Task[]; media: Media[] }

const STATE_BADGE: Record<LiveState, string> = { planning: 'warn', building: 'accent', testing: 'ion', done: 'ok', paused: 'unknown' };
const LOG_FILTERS: LiveEventKind[] = ['research', 'plan', 'decision', 'build', 'test', 'problem', 'milestone', 'task', 'screenshot', 'log'];
const ACTIVE: LiveState[] = ['planning', 'building', 'testing'];
const mediaUrl = (id: string) => `/api/live/media/${id}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function elapsed(from: string, to?: string | null): string {
  const ms = Math.max(0, new Date(to ?? Date.now()).getTime() - new Date(from).getTime());
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/** Plain text with `code` spans – no HTML from the stream is ever rendered. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return <>{parts.map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}</>;
}

/** Keeps the view current: Server-Sent Events first, polling as the fallback. Returns the connection mode. */
function useLiveStream(sessionId: string | undefined, active: boolean): 'sse' | 'poll' | 'idle' {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'sse' | 'poll' | 'idle'>('idle');
  useEffect(() => {
    if (!sessionId || !active) { setMode('idle'); return; }
    let es: EventSource | null = null;
    let timer: number | undefined;
    let closed = false;
    const refresh = () => { qc.invalidateQueries({ queryKey: ['live', sessionId] }); qc.invalidateQueries({ queryKey: ['live', 'sessions'] }); };
    const startPolling = () => { if (timer) return; setMode('poll'); timer = window.setInterval(refresh, 5000); };
    try {
      es = new EventSource(`/api/live/sessions/${sessionId}/stream`);
      es.addEventListener('hello', () => { setMode('sse'); if (timer) { clearInterval(timer); timer = undefined; } });
      es.addEventListener('event', refresh);
      es.addEventListener('session', refresh);
      es.addEventListener('deleted', () => { refresh(); es?.close(); });
      es.onerror = () => { if (!closed) startPolling(); };
    } catch {
      startPolling();
    }
    return () => { closed = true; es?.close(); if (timer) clearInterval(timer); };
  }, [sessionId, active, qc]);
  return mode;
}

export default function LivePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const sessions = useQuery({ queryKey: ['live', 'sessions'], queryFn: () => api.get<LiveSession[]>('/api/live/sessions'), refetchInterval: 30_000 });
  const current = id ?? sessions.data?.[0]?.id;

  if (sessions.error) return <ErrorState error={sessions.error} retry={() => sessions.refetch()} />;
  if (sessions.isLoading) return <div className="stack"><Skeleton h={34} w={280} /><Skeleton h={160} r={16} /><Skeleton h={300} r={16} /></div>;
  if (!sessions.data?.length) return <Onboarding />;
  if (!current) return null;
  return <SessionView id={current} sessions={sessions.data} onPick={(s) => nav(`/live/${s}`)} />;
}

function Onboarding() {
  return (
    <div>
      <PageHeader eyebrow={<><Hammer size={14} /> Werkstatt</>} title="Live-Entwicklung" lead="Hier siehst du in Echtzeit, was Claude gerade baut: Fortschritt, Aufgaben, Recherche, Entscheidungen, Screenshots und eine laufende Vorschau." />
      <Card className="live-help">
        <EmptyState icon={<MonitorPlay />} title="Noch keine Live-Sitzung">
          Sobald Claude eine Entwicklungsaufgabe über die OMEGA-Werkzeuge streamt, erscheint sie hier automatisch.
        </EmptyState>
        <div className="stack" style={{ maxWidth: 760, margin: '0 auto' }}>
          <p className="small"><strong>So verbindest du Claude:</strong> Token mit Bereich <code>ingest</code> unter <Link to="/settings">Einstellungen → Integrationen</Link> erzeugen, MCP-Server verbinden (siehe Doku) und Claude bitten, die Werkzeuge <code>omega_live_start</code>, <code>omega_live_log</code>, <code>omega_live_milestone</code>, <code>omega_live_task</code>, <code>omega_live_screenshot</code>, <code>omega_live_preview</code> und <code>omega_live_status</code> zu verwenden.</p>
          <p className="small">Ohne MCP geht es auch aus jeder Shell:</p>
          <pre tabIndex={0} aria-label="Beispielbefehle">{`export OMEGA_URL=http://127.0.0.1:4317 OMEGA_TOKEN=<Token> OMEGA_LIVE_ID=mein-projekt/heute
node scripts/omega-live.mjs start "Mein Projekt" --state building --milestones "design:Design,frontend:Frontend,backend:Backend"
node scripts/omega-live.mjs log research "Codebasis gelesen" "Was gefunden wurde …"
node scripts/omega-live.mjs shot ./screenshot.png "Startseite"
node scripts/omega-live.mjs preview http://localhost:5173`}</pre>
          <p className="small muted">Empfohlene Anweisung für Claude: „Streame deinen Entwicklungsprozess in die OMEGA-Werkstatt: zu Beginn <code>omega_live_start</code> mit Meilensteinen und Aufgaben, danach laufend Protokolleinträge, Meilenstein-Updates, Screenshots und am Ende den Status <code>done</code>.“</p>
        </div>
      </Card>
    </div>
  );
}

function SessionView({ id, sessions, onPick }: { id: string; sessions: LiveSession[]; onPick: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const detail = useQuery({ queryKey: ['live', id, 'detail'], queryFn: () => api.get<Detail>(`/api/live/sessions/${id}`) });
  const active = detail.data ? ACTIVE.includes(detail.data.session.state) : true;
  const mode = useLiveStream(id, active);
  const [limit, setLimit] = useState(200);
  const [filter, setFilter] = useState<LiveEventKind | ''>('');
  const events = useQuery({ queryKey: ['live', id, 'events', limit], queryFn: () => api.get<{ items: LiveEvent[]; nextCursor: number | null; latestId: number }>(`/api/live/sessions/${id}/events${qs({ limit })}`), refetchInterval: active && mode !== 'sse' ? 5000 : false });
  const [shot, setShot] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Media | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [frameKey, setFrameKey] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const end = useMutation({ mutationFn: () => api.post(`/api/live/sessions/${id}/end`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['live'] }); toast({ kind: 'success', title: 'Sitzung abgeschlossen' }); } });
  const remove = useMutation({ mutationFn: () => api.del(`/api/live/sessions/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['live'] }); toast({ kind: 'success', title: 'Sitzung gelöscht' }); nav('/live'); } });

  const media = detail.data?.media ?? [];
  const currentShot = media.find((m) => m.id === shot) ?? media[media.length - 1];
  const visibleEvents = useMemo(() => (events.data?.items ?? []).filter((e) => !filter || e.kind === filter), [events.data, filter]);
  const presentKinds = useMemo(() => new Set((events.data?.items ?? []).map((e) => e.kind)), [events.data]);

  if (detail.error) return <ErrorState error={detail.error} retry={() => detail.refetch()} />;
  const d = detail.data;
  const s = d?.session;
  const sortedTasks = d ? [...d.tasks].sort((a, b) => (rank(a.status) - rank(b.status)) || a.order - b.order) : [];

  return (
    <div>
      <PageHeader
        eyebrow={<><Hammer size={14} /> Werkstatt · Live-Entwicklung</>}
        title={s?.title ?? <Skeleton h={30} w={320} />}
        lead={s?.goal ?? undefined}
        actions={s ? (
          <>
            {sessions.length > 1 && (
              <select className="select" value={id} onChange={(e) => onPick(e.target.value)} aria-label="Sitzung wählen" style={{ maxWidth: 260 }}>
                {sessions.map((x) => <option key={x.id} value={x.id}>{x.title} · {LIVE_STATE_LABELS[x.state]}</option>)}
              </select>
            )}
            {s.state !== 'done' && <Button onClick={() => end.mutate()} loading={end.isPending}><CheckCheck /> <span className="hide-sm">Abschließen</span></Button>}
            <Button variant="ghost" icon onClick={() => setConfirmDelete(true)} aria-label="Sitzung löschen" data-tip="Sitzung löschen"><Trash2 /></Button>
          </>
        ) : undefined}
      />

      {/* status band */}
      <Card>
        {!s ? <Skeleton h={90} /> : (
          <div className="live-status">
            <Ring value={s.progress} size={76} color={s.state === 'done' ? 'var(--ok)' : 'var(--accent)'} label={`Gesamtfortschritt ${s.progress} von 100`} />
            <div className="live-now">
              <div className="row" style={{ gap: 10 }}>
                <span className={`badge ${STATE_BADGE[s.state]}`}>{s.stateLabel}</span>
                {s.phase && <span className="small muted">Phase: {s.phase}</span>}
                <span className="row small subtle" style={{ gap: 6 }} aria-live="polite">
                  <span className={`live-dot ${mode === 'sse' ? 'on' : mode === 'poll' ? 'poll' : ''}`} aria-hidden />
                  {mode === 'sse' ? 'live verbunden' : mode === 'poll' ? 'aktualisiert alle 5 s' : s.state === 'done' ? 'abgeschlossen' : 'pausiert'}
                </span>
              </div>
              {s.now ? <strong>{s.now}</strong> : <span className="muted">{s.state === 'done' ? 'Diese Sitzung ist abgeschlossen.' : 'Warte auf den nächsten Eintrag …'}</span>}
              <div className="live-meta">
                <span>{s.state === 'done' ? 'Dauer' : 'läuft seit'} {elapsed(s.startedAt, s.endedAt)}</span>
                <span>{s.counts.events} Einträge · {s.counts.media} Bilder · {s.counts.tasksDone}/{s.counts.tasksTotal} Aufgaben</span>
                {s.lastEventAt && <span>zuletzt {relTime(s.lastEventAt)}</span>}
                {s.projectId && <Link to={`/projects/${s.projectId}`}>Projekt: {s.projectName}</Link>}
                <span>Quelle: {s.source}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* milestones */}
      <Card title="Meilensteine" icon={<Flag />} style={{ marginTop: 'var(--sp-4)' }}>
        {!d ? <Skeleton h={80} /> : d.milestones.length === 0 ? <p className="muted small">Noch keine Meilensteine gemeldet.</p> : (
          <div className="live-miles">
            {d.milestones.map((m) => (
              <div key={m.key} className="live-mile" data-status={m.status}>
                <div className="live-mile-top"><strong>{m.label}</strong><span>{m.progress} %</span></div>
                <Progress value={m.progress} label={`${m.label}: ${m.progress} %`} />
                <small>{m.status === 'done' ? 'abgeschlossen' : m.status === 'active' ? 'in Arbeit' : 'offen'}</small>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="live-cols" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="stack">
          {/* preview */}
          <Card title="Live-Vorschau" icon={<MonitorPlay />} actions={s?.previewUrl ? (
            <>
              <div className="segmented" role="group" aria-label="Gerät">
                <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')} aria-label="Desktop"><Monitor /></button>
                <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')} aria-label="Smartphone"><Smartphone /></button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setFrameKey((k) => k + 1)} aria-label="Vorschau neu laden"><RefreshCw /></Button>
              <a className="btn sm" href={s.previewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Öffnen</a>
            </>
          ) : undefined}>
            {!s ? <Skeleton h={200} /> : s.previewUrl ? (
              <div className="stack-sm">
                <iframe key={frameKey} className="live-preview-frame" data-device={device} src={s.previewUrl} title="Live-Vorschau" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" />
                <div className="row-between">
                  <span className="live-url">{s.previewUrl}</span>
                  {s.previewNote && <span className="small muted">{s.previewNote}</span>}
                </div>
                <p className="xsmall subtle">Zeigt die Vorschau nichts an, erlaubt der Vorschau-Server keine Einbettung – dann „Öffnen“ verwenden.</p>
              </div>
            ) : (
              <p className="muted small">{s.previewNote ?? 'Noch keine laufende Vorschau. Sobald Claude eine Adresse meldet, erscheint sie hier.'}</p>
            )}
          </Card>

          {/* screenshots */}
          <Card title="Screenshots & Zwischenstände" icon={<ImageIcon />} actions={media.length > 0 ? <span className="badge outline">{media.length}</span> : undefined}>
            {!d ? <Skeleton h={240} /> : media.length === 0 ? (
              <p className="muted small">Noch keine Bilder. Screenshots der Oberfläche, Mockups und Diagramme erscheinen hier, sobald Claude sie sendet.</p>
            ) : currentShot && (
              <>
                <div className="live-hero">
                  <img src={mediaUrl(currentShot.id)} alt={currentShot.title ?? 'Screenshot'} onClick={() => setZoom(currentShot)} />
                  <div className="live-cap"><strong>{currentShot.title}</strong>{currentShot.caption}{currentShot.caption ? ' · ' : ''}{time(currentShot.createdAt)}</div>
                </div>
                <div className="live-thumbs">
                  {media.map((m, i) => (
                    <button key={m.id} type="button" className="live-thumb" aria-current={m.id === currentShot.id} aria-label={`${i + 1} ${m.title ?? 'Bild'}`} onClick={() => setShot(m.id)}>
                      <span>{i + 1}</span><img src={mediaUrl(m.id)} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          {/* tasks */}
          <Card title="Aufgaben" icon={<ListChecks />} actions={s && s.counts.tasksTotal > 0 ? <span className="badge outline">{s.counts.tasksDone} / {s.counts.tasksTotal}</span> : undefined}>
            {!d ? <Skeleton h={160} /> : sortedTasks.length === 0 ? <p className="muted small">Noch keine Aufgaben gemeldet.</p> : (
              <div className="live-tasks">
                {sortedTasks.map((t) => (
                  <div key={t.key} className="live-task" data-status={t.status}>
                    <span className="live-box" aria-hidden>{t.status === 'done' ? '✓' : ''}</span>
                    <span><span className="live-task-title">{t.title}</span>{t.detail && <><br /><span className="live-task-detail">{t.detail}</span></>}</span>
                    <span className={`badge ${t.status === 'doing' ? 'accent' : t.status === 'done' ? 'ok' : t.status === 'blocked' ? 'crit' : 'outline'}`}>{t.status === 'doing' ? 'jetzt' : TASK_STATUS_LABELS[t.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* log */}
          <Card title="Protokoll" icon={<ScrollText />} actions={events.data ? <span className="badge outline">{events.data.items.length}</span> : undefined}>
            <div className="chips" style={{ marginBottom: 'var(--sp-3)' }}>
              <button className="chip" aria-pressed={!filter} onClick={() => setFilter('')}>Alles</button>
              {LOG_FILTERS.filter((k) => presentKinds.has(k)).map((k) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? '' : k)}>{LIVE_EVENT_KIND_LABELS[k]}</button>)}
            </div>
            {events.error ? <ErrorState error={events.error} retry={() => events.refetch()} /> : events.isLoading ? <Skeleton h={300} /> : visibleEvents.length === 0 ? (
              <p className="muted small">{filter ? 'Keine Einträge in dieser Kategorie.' : 'Das Protokoll füllt sich mit Recherche, Planung, Entscheidungen, Code und Tests.'}</p>
            ) : (
              <div className="live-log" tabIndex={0} aria-label="Protokolleinträge">
                {visibleEvents.map((e) => (
                  <article key={e.id} className="live-entry" data-kind={e.kind}>
                    <time dateTime={e.at} title={dateTime(e.at)}>{time(e.at)}</time>
                    <span className="live-stripe" aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <div className="live-kind">{LIVE_EVENT_KIND_LABELS[e.kind] ?? e.kind}</div>
                      <div className="live-title">{e.title}</div>
                      {e.body && <div className="live-body"><InlineText text={e.body} /></div>}
                      {e.mediaId && <img className="live-inline-shot" src={mediaUrl(e.mediaId)} alt={e.title} loading="lazy" onClick={() => { const m = media.find((x) => x.id === e.mediaId); if (m) setZoom(m); }} />}
                    </div>
                  </article>
                ))}
                {events.data?.nextCursor && <div style={{ textAlign: 'center', padding: 'var(--sp-3) 0' }}><Button size="sm" onClick={() => setLimit(500)}>Ältere Einträge laden</Button></div>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} title={zoom?.title ?? 'Bild'} description={zoom ? `${zoom.caption ? zoom.caption + ' · ' : ''}${dateTime(zoom.createdAt)}${zoom.width ? ` · ${zoom.width}×${zoom.height} px` : ''}` : undefined} wide>
        {zoom && <div className="live-lightbox"><img src={mediaUrl(zoom.id)} alt={zoom.title ?? ''} /></div>}
      </Dialog>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); remove.mutate(); }} title="Live-Sitzung löschen?" confirmLabel="Löschen" danger loading={remove.isPending}>
        <p className="small">Protokoll, Aufgaben und Screenshots dieser Sitzung werden gelöscht. Projekte und andere Daten sind nicht betroffen.</p>
      </ConfirmDialog>
    </div>
  );
}

const rank = (st: TaskStatus) => (st === 'doing' ? 0 : st === 'blocked' ? 1 : st === 'todo' ? 2 : 3);

