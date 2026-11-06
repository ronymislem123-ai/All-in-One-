import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Database, FileUp, GitBranch, HardDriveDownload, ListChecks, Plus, RefreshCw, RotateCcw, Search, Sparkles, Upload, X, Radar, ScrollText, Gauge } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import type { Integrations, QualityIssue, Repo } from '../../api/types';
import { dateTime, relTime } from '../../lib/format';
import { Button, Callout, Card, Dialog, EmptyState, ErrorState, Field, Skeleton, Tabs, useToast } from '../../components/ui';
import { HEALTH_LABELS, HealthDot } from '../../components/ui/Status';
import { PageHeader } from '../../components/layout/PageHeader';
import { SYNC_EVENT_STATUS_LABELS, type Health, type SyncEventStatus } from '@shared/domain';

type Tab = 'overview' | 'repos' | 'events' | 'import' | 'quality';

function Connection({ icon, info, children }: { icon: React.ReactNode; info: { health: Health; label: string; description: string }; children?: React.ReactNode }) {
  return (
    <div className="card stack-sm">
      <div className="row" style={{ gap: 10 }}><span className="kind-icon">{icon}</span><strong>{info.label}</strong><span className="spacer" /><HealthDot health={info.health} pulse={info.health === 'critical'} /></div>
      <span className={`badge ${info.health === 'ok' ? 'ok' : info.health === 'attention' ? 'warn' : info.health === 'critical' ? 'crit' : 'unknown'}`} style={{ alignSelf: 'flex-start' }}>{HEALTH_LABELS[info.health]}</span>
      <p className="muted small">{info.description}</p>
      {children}
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integrations>('/api/integrations'), refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ['sync', 'runs'], queryFn: () => api.get<{ id: string; source: string; trigger: string; label: string | null; started_at: string; finished_at: string | null; status: string; stats: Record<string, number>; error: string | null }[]>('/api/sync/runs?limit=15') });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton h={300} r={16} />;
  const i = q.data;
  return (
    <div className="stack">
      <div className="grid-3">
        <Connection icon={<Bot />} info={i.claude}><p className="subtle xsmall">{i.claude.note}</p><Link className="small" to="/settings?tab=integrations">MCP & Tokens einrichten →</Link></Connection>
        <Connection icon={<GitBranch />} info={i.github}><p className="subtle xsmall">Token: {i.github.tokenSource === 'env' ? 'aus Umgebungsvariable' : i.github.tokenSource === 'stored' ? 'verschlüsselt gespeichert' : 'keins (nur öffentliche/freigegebene Repos)'} · Webhook: {i.github.webhookConfigured ? 'eingerichtet' : 'nicht eingerichtet'}</p></Connection>
        <Connection icon={<Sparkles />} info={i.ai} />
        <Connection icon={<Database />} info={i.database} />
        <Connection icon={<HardDriveDownload />} info={i.backup}><Link className="small" to="/backups">Backups ansehen →</Link></Connection>
      </div>
      <Card title="Letzte Synchronisierungsläufe" icon={<ScrollText />}>
        {!runs.data?.length ? <p className="subtle small">Noch keine Läufe.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Quelle</th><th>Auslöser</th><th>Status</th><th>Ergebnis</th><th>Zeit</th></tr></thead>
            <tbody>{runs.data.map((r) => (
              <tr key={r.id}>
                <td>{r.source === 'github' ? 'GitHub' : r.source === 'file' ? 'Datei' : 'Claude'}{r.label ? <div className="subtle xsmall">{r.label}</div> : null}</td>
                <td>{r.trigger}</td>
                <td><span className={`badge ${r.status === 'succeeded' ? 'ok' : r.status === 'partial' ? 'warn' : r.status === 'running' ? 'accent' : 'crit'}`}>{r.status}</span></td>
                <td className="xsmall mono">{Object.entries(r.stats).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || '–'}{r.error && <div style={{ color: 'var(--warn)' }}>{r.error}</div>}</td>
                <td title={dateTime(r.started_at)}>{relTime(r.started_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function Repos() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get<Repo[]>('/api/repos') });
  const suggestions = useQuery({ queryKey: ['link-suggestions'], queryFn: () => api.get<{ id: string; node_id: string; node_name: string; repository_id: string; full_name: string; score: number | null; reason: string; created_by: string }[]>('/api/link-suggestions') });
  const status = useQuery({ queryKey: ['github', 'status'], queryFn: () => api.get<{ tokenSource: string | null; rateLimit: { remaining: number | null; limit: number | null; resetAt: string | null }; permissions: string }>('/api/github/status') });
  const inv = () => { qc.invalidateQueries({ queryKey: ['repos'] }); qc.invalidateQueries({ queryKey: ['link-suggestions'] }); qc.invalidateQueries({ queryKey: ['integrations'] }); };
  const add = useMutation({
    mutationFn: () => api.post<{ repo: Repo; result: { message: string; status: string } | null }>('/api/repos', { fullName: name.trim() }),
    onSuccess: (r) => { inv(); setName(''); toast({ kind: r.result?.status === 'ok' ? 'success' : 'warning', title: r.repo.fullName, body: r.result?.message ?? 'Hinzugefügt' }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht hinzugefügt', body: e.message }),
  });
  const syncAll = useMutation({ mutationFn: () => api.post<{ ok: number; failed: number; newCommits: number; error?: string }>('/api/github/sync'), onSuccess: (r) => { inv(); toast({ kind: r.failed ? 'warning' : 'success', title: 'GitHub-Abgleich abgeschlossen', body: `${r.ok} ok · ${r.failed} fehlgeschlagen · ${r.newCommits} neue Commits${r.error ? ` · ${r.error}` : ''}` }); } });
  const syncOne = useMutation({ mutationFn: (id: string) => api.post<{ message: string; status: string }>(`/api/repos/${id}/sync?force=1`), onSuccess: (r) => { inv(); toast({ kind: r.status === 'ok' ? 'success' : 'warning', title: r.message }); } });
  const discover = useMutation({ mutationFn: () => api.post<{ found: number; added: number }>('/api/github/discover'), onSuccess: (r) => { inv(); toast({ kind: 'success', title: `${r.found} Repositories gefunden`, body: `${r.added} neu hinzugefügt` }); }, onError: (e: ApiError) => toast({ kind: 'warning', title: 'Erkennung nicht möglich', body: e.message }) });
  const track = useMutation({ mutationFn: (r: Repo) => api.patch(`/api/repos/${r.id}`, { tracked: !r.tracked }), onSuccess: inv });
  const accept = useMutation({ mutationFn: (s: { node_id: string; repository_id: string }) => api.post(`/api/nodes/${s.node_id}/repos`, { repositoryId: s.repository_id }), onSuccess: () => { inv(); toast({ kind: 'success', title: 'Verknüpfung bestätigt' }); } });
  const reject = useMutation({ mutationFn: (s: { node_id: string; repository_id: string }) => api.post(`/api/nodes/${s.node_id}/repos/${s.repository_id}/reject`), onSuccess: inv });

  return (
    <div className="stack">
      <Callout title="Nur lesend">{status.data?.permissions ?? 'OMEGA liest Repositories ausschließlich.'} {status.data?.rateLimit.remaining != null && <span className="subtle">· API-Kontingent: {status.data.rateLimit.remaining}/{status.data.rateLimit.limit}</span>}</Callout>
      <Card title="Repository hinzufügen" icon={<Plus />} actions={<><Button size="sm" onClick={() => discover.mutate()} loading={discover.isPending} disabled={!status.data?.tokenSource} title={status.data?.tokenSource ? '' : 'Benötigt ein GitHub-Token (Einstellungen → Integrationen)'}><Radar /> Automatisch erkennen</Button><Button size="sm" variant="primary" onClick={() => syncAll.mutate()} loading={syncAll.isPending}><RefreshCw /> Alle abgleichen</Button></>}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
          <input className="input" style={{ flex: '1 1 260px' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="owner/repository oder https://github.com/owner/repo" aria-label="Repository" />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!name.trim()}><Plus /> Hinzufügen & abgleichen</Button>
        </form>
      </Card>
      {suggestions.data && suggestions.data.length > 0 && (
        <Card title="Zuordnungsvorschläge – bitte bestätigen" icon={<ListChecks />}>
          <p className="subtle small" style={{ marginBottom: 10 }}>Vorschläge entstehen aus Namensähnlichkeit oder Claude-Hinweisen. Ohne deine Bestätigung wird nichts verknüpft.</p>
          <div className="list">
            {suggestions.data.map((s) => (
              <div key={s.id} className="list-item">
                <GitBranch size={16} /><span style={{ flex: 1, minWidth: 0 }}><strong className="small">{s.full_name}</strong> ↔ <Link to={`/projects/${s.node_id}`}>{s.node_name}</Link><div className="subtle xsmall">{s.reason}{s.score ? ` · ${Math.round(s.score * 100)} %` : ''}</div></span>
                <Button size="sm" variant="primary" onClick={() => accept.mutate(s)}><Check /> Bestätigen</Button>
                <Button size="sm" variant="ghost" onClick={() => reject.mutate(s)} aria-label="Vorschlag ablehnen"><X /></Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Verfolgte Repositories" icon={<GitBranch />}>
        {repos.isLoading ? <Skeleton h={120} /> : !repos.data?.length ? <EmptyState icon={<GitBranch />} title="Noch keine Repositories">Füge oben ein Repository hinzu. Mit Token können alle autorisierten Repositories automatisch erkannt werden.</EmptyState> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Repository</th><th>Status</th><th>Sprache</th><th>Dateien</th><th>Letzter Abgleich</th><th>Projekt</th><th /></tr></thead>
            <tbody>{repos.data.map((r) => (
              <tr key={r.id} style={{ opacity: r.tracked ? 1 : 0.55 }}>
                <td><Link to={`/code/${r.id}`}><strong>{r.fullName}</strong></Link>{r.private && <span className="badge outline" style={{ marginLeft: 6 }}>privat</span>}<div className="subtle xsmall clamp-2">{r.description}</div></td>
                <td><span className="row" style={{ gap: 6 }}><HealthDot health={r.status === 'ok' ? 'ok' : r.status === 'pending' ? 'unknown' : 'critical'} /><span className="small">{r.status}</span></span>{r.statusDetail && <div className="subtle xsmall">{r.statusDetail}</div>}</td>
                <td>{r.primaryLanguage ?? '–'}</td>
                <td>{r.fileCount ?? '–'}</td>
                <td title={dateTime(r.lastSyncedAt)}>{relTime(r.lastSyncedAt)}</td>
                <td>{r.linked ? <span className="badge ok">verknüpft</span> : <span className="badge unknown">offen</span>}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}><Button size="sm" onClick={() => syncOne.mutate(r.id)} loading={syncOne.isPending && syncOne.variables === r.id}><RefreshCw /> Abgleichen</Button><Button size="sm" variant="ghost" onClick={() => track.mutate(r)}>{r.tracked ? 'Pausieren' : 'Aktivieren'}</Button></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function Events() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const ev = useQuery({ queryKey: ['sync', 'events', status, q], queryFn: () => api.get<{ total: number; items: Record<string, string>[] }>(`/api/sync/events${qs({ status, q, limit: 100 })}`) });
  const retry = useMutation({ mutationFn: (id: string) => api.post<{ status: string; message: string }>(`/api/sync/events/${id}/retry`), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sync'] }); toast({ kind: r.status === 'applied' ? 'success' : 'warning', title: `Wiederholung: ${r.status}`, body: r.message }); } });
  const tone: Record<string, string> = { applied: 'ok', duplicate: 'unknown', conflict: 'warn', rejected: 'crit', failed: 'crit', received: 'accent' };
  return (
    <Card title="Synchronisierungsprotokoll" icon={<ScrollText />}>
      <div className="row" style={{ marginBottom: 12, gap: 10 }}>
        <div className="input-icon" style={{ flex: '1 1 220px' }}><Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ereignis-ID, Typ, Inhalt …" aria-label="Protokoll durchsuchen" /></div>
        <div className="chips">{['', 'applied', 'conflict', 'rejected', 'failed', 'duplicate'].map((s) => <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? SYNC_EVENT_STATUS_LABELS[s as SyncEventStatus] : 'Alle'}</button>)}</div>
      </div>
      {!ev.data ? <Skeleton h={200} /> : !ev.data.items.length ? <p className="subtle small">Keine Ereignisse.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ereignis</th><th>Typ</th><th>Status</th><th>Ergebnis</th><th>Quelle</th><th>Empfangen</th><th /></tr></thead>
          <tbody>{ev.data.items.map((e) => (
            <tr key={e.id}>
              <td className="mono xsmall"><button className="btn ghost sm" onClick={() => setDetail(e)} style={{ padding: 0, height: 'auto' }}>{e.event_id.slice(0, 28)}</button></td>
              <td className="xsmall">{e.type}</td>
              <td><span className={`badge ${tone[e.status] ?? 'unknown'}`}>{SYNC_EVENT_STATUS_LABELS[e.status as SyncEventStatus] ?? e.status}</span>{Number(e.attempts) > 1 && <div className="subtle xsmall">{e.attempts}×</div>}</td>
              <td className="small">{e.message}{e.target_type === 'node' && e.target_id && <> · <Link to={`/projects/${e.target_id}`}>öffnen</Link></>}{e.target_type === 'idea' && e.target_id && <> · <Link to={`/ideas/${e.target_id}`}>öffnen</Link></>}</td>
              <td className="xsmall">{e.source} · {e.client}</td>
              <td title={dateTime(e.received_at)}>{relTime(e.received_at)}</td>
              <td>{['failed', 'rejected'].includes(e.status) && <Button size="sm" onClick={() => retry.mutate(e.id)}><RotateCcw /> Wiederholen</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} wide title="Ereignisdetails">
        <pre className="code-view" style={{ padding: 16, whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail, null, 2)}</pre>
      </Dialog>
    </Card>
  );
}

function Import() {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<{ kind: string; notes: string[]; envelope: { events: { type: string; data: Record<string, unknown> }[] } } | null>(null);
  const [result, setResult] = useState<{ summary: Record<string, number>; results: { eventId: string; status: string; message: string; type?: string }[] } | null>(null);
  const [text, setText] = useState('');
  const load = async (f: File) => { if (f.size > 2_000_000) { toast({ kind: 'error', title: 'Datei zu groß (max. 2 MB)' }); return; } setFile({ name: f.name, content: await f.text() }); setPreview(null); setResult(null); };
  const dry = useMutation({ mutationFn: (fl: { name: string; content: string }) => api.post<typeof preview & { dryRun: boolean }>('/api/import/file', { filename: fl.name, content: fl.content, dryRun: true }), onSuccess: (r) => setPreview(r), onError: (e: ApiError) => toast({ kind: 'error', title: 'Datei nicht lesbar', body: e.message }) });
  const apply = useMutation({ mutationFn: (fl: { name: string; content: string }) => api.post<{ result: NonNullable<typeof result> }>('/api/import/file', { filename: fl.name, content: fl.content }), onSuccess: (r) => { setResult(r.result); qc.invalidateQueries(); toast({ kind: 'success', title: 'Import verarbeitet' }); } });
  const current = file ?? (text.trim() ? { name: 'eingabe.md', content: text } : null);
  return (
    <div className="grid-2">
      <Card title="Datei oder Text importieren" icon={<FileUp />}>
        <p className="muted small" style={{ marginBottom: 12 }}>Alternative zum MCP-Server: Claude-Exporte als <code>omega.ingest/v1</code>-JSON, Markdown mit Kopfbereich (<code>omega: project</code>) oder einfacher Text (wird als Idee erfasst). Wiederholte Importe erzeugen keine Duplikate.</p>
        <input ref={input} type="file" accept=".json,.md,.markdown,.txt" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <div className="row"><Button onClick={() => input.current?.click()}><Upload /> Datei wählen</Button>{file && <span className="small">{file.name}</span>}</div>
        <Field label="… oder Markdown/Text einfügen" className="" >{(id) => <textarea id={id} className="textarea mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setFile(null); setPreview(null); }} placeholder={'---\nomega: project\nexternalId: mein-projekt\nname: Mein Projekt\nstatus: in_development\n---\n# Mein Projekt\n\nBeschreibung …\n\n## Module\n- Login | in_development\n- Export'} />}</Field>
        <div className="row" style={{ marginTop: 12 }}>
          <Button disabled={!current} onClick={() => current && dry.mutate(current)} loading={dry.isPending}>Vorschau</Button>
          <Button variant="primary" disabled={!current || !preview} onClick={() => current && apply.mutate(current)} loading={apply.isPending}>Importieren</Button>
        </div>
      </Card>
      <Card title="Vorschau & Ergebnis" icon={<ListChecks />}>
        {!preview && !result && <p className="subtle small">Erst Vorschau ansehen, dann importieren. Nichts wird ohne deine Bestätigung gespeichert.</p>}
        {preview && !result && (
          <div className="stack-sm">
            <span className="badge accent">{preview.kind}</span>
            {preview.notes.map((n) => <p key={n} className="subtle xsmall">{n}</p>)}
            <div className="list">{preview.envelope.events.map((e, i) => <div key={i} className="list-item small"><span className="badge outline">{e.type}</span><span className="truncate">{String(e.data.name ?? e.data.title ?? e.data.externalId)}</span></div>)}</div>
          </div>
        )}
        {result && (
          <div className="stack-sm">
            <div className="row">{Object.entries(result.summary).map(([k, v]) => <span key={k} className={`badge ${k === 'applied' ? 'ok' : k === 'conflict' ? 'warn' : k === 'duplicate' ? 'unknown' : v ? 'crit' : 'outline'}`}>{SYNC_EVENT_STATUS_LABELS[k as SyncEventStatus] ?? k}: {v}</span>)}</div>
            <div className="list">{result.results.map((r) => <div key={r.eventId} className="list-item small"><span className="badge outline">{r.status}</span><span>{r.message}</span></div>)}</div>
            {result.summary.conflict > 0 && <Link to="/conflicts">Konflikte prüfen →</Link>}
          </div>
        )}
      </Card>
    </div>
  );
}

function Quality() {
  const q = useQuery({ queryKey: ['quality'], queryFn: () => api.get<QualityIssue[]>('/api/quality') });
  if (!q.data) return <Skeleton h={200} />;
  if (!q.data.length) return <EmptyState icon={<Gauge />} title="Keine Datenqualitäts-Hinweise">Beschreibungen, Zuordnungen und GitHub-Daten sind in Ordnung.</EmptyState>;
  return (
    <Card title={`${q.data.length} Hinweise zur Datenqualität`} icon={<Gauge />}>
      <div className="list">{q.data.map((i) => <Link key={i.id} to={i.link} className="list-item"><span className={`dot ${i.severity === 'warning' ? 'attention' : 'unknown'}`} /><span style={{ flex: 1, minWidth: 0 }}><span className="small">{i.title}</span><span className="subtle xsmall" style={{ display: 'block' }}>{i.detail}</span></span></Link>)}</div>
    </Card>
  );
}

export default function SyncCenterPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  return (
    <div>
      <PageHeader eyebrow={<><RefreshCw size={14} /> Sync Center</>} title="Synchronisierung & Integrationen" lead="Alle Datenquellen an einem Ort: Was wurde wann übermittelt, was ist veraltet, was braucht deine Entscheidung." />
      <Tabs label="Sync-Bereiche" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[
        { id: 'overview', label: 'Verbindungen', icon: <Radar /> }, { id: 'repos', label: 'GitHub', icon: <GitBranch /> }, { id: 'events', label: 'Protokoll', icon: <ScrollText /> },
        { id: 'import', label: 'Import', icon: <FileUp /> }, { id: 'quality', label: 'Datenqualität', icon: <Gauge /> },
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'repos' && <Repos />}
      {tab === 'events' && <Events />}
      {tab === 'import' && <Import />}
      {tab === 'quality' && <Quality />}
    </div>
  );
}
