import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, ExternalLink, Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, Star, Trash2, Archive, Monitor, Globe, Package } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import type { AppDto } from '../../api/types';
import { relTime } from '../../lib/format';
import { Button, Callout, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, SkeletonCards, useToast } from '../../components/ui';
import { AvailabilityBadge } from '../../components/ui/Status';
import { ICON_NAMES, TileIcon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/layout/PageHeader';
import { CategorySelect, NodePicker } from '../projects/shared';
import { APP_KIND_LABELS, APP_KINDS } from '@shared/domain';

function AppForm({ open, onClose, app, projectId }: { open: boolean; onClose: () => void; app?: AppDto | null; projectId?: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const empty = { name: '', kind: 'hosted_web', summary: '', description: '', launchUrl: '', launchHint: '', features: '', icon: '', color: '', categoryId: null as string | null, nodeId: projectId ?? null as string | null, nodeName: '' };
  const [f, setF] = useState(empty);
  const [pick, setPick] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(app ? { name: app.name, kind: app.kind, summary: app.summary ?? '', description: app.description ?? '', launchUrl: app.launchUrl ?? '', launchHint: app.launchHint ?? '', features: app.features.join('\n'), icon: app.icon ?? '', color: app.color ?? '', categoryId: app.categoryId, nodeId: app.nodeId, nodeName: app.project?.name ?? '' } : { ...empty, nodeId: projectId ?? null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app, projectId]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, kind: f.kind, summary: f.summary || null, description: f.description || null, launchUrl: f.launchUrl.trim() || null, launchHint: f.launchHint || null, features: f.features.split('\n').map((x) => x.trim()).filter(Boolean), icon: f.icon || null, color: f.color || null, categoryId: f.categoryId, nodeId: f.nodeId };
      return app ? api.patch<AppDto>(`/api/apps/${app.id}`, { ...body, version: app.version }) : api.post<AppDto>('/api/apps', body);
    },
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['apps'] }); toast({ kind: 'success', title: app ? 'Gespeichert' : 'Anwendung angelegt', body: a.availability === 'unverified' ? 'Prüfe jetzt die Erreichbarkeit, um sie als verfügbar zu markieren.' : undefined }); onClose(); },
    onError: (e: ApiError) => setErr(Array.isArray(e.details) ? (e.details as { message: string }[]).map((d) => d.message).join(' · ') : e.message),
  });
  const set = (k: keyof typeof f) => (v: string | null) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Dialog open={open} onClose={onClose} wide title={app ? `„${app.name}“ bearbeiten` : 'Anwendung hinzufügen'} description="Eine App gilt erst als verfügbar, wenn ein Startpunkt technisch geprüft oder (bei Desktop-Apps) ausdrücklich bestätigt wurde."
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Speichern</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} data-autofocus />}</Field>
        <Field label="Anwendungsart">{(id) => <select id={id} className="select" value={f.kind} onChange={(e) => set('kind')(e.target.value)}>{APP_KINDS.map((k) => <option key={k} value={k}>{APP_KIND_LABELS[k]}</option>)}</select>}</Field>
        <Field label="Startpunkt" className="full" hint={f.kind === 'internal' ? 'Interner Pfad, z. B. /ideas' : f.kind === 'desktop' ? 'Optional: Download-/Produktseite oder App-Protokoll (z. B. myapp://)' : 'https://…'}>{(id) => <input id={id} className="input mono" value={f.launchUrl} onChange={(e) => set('launchUrl')(e.target.value)} placeholder={f.kind === 'internal' ? '/…' : 'https://…'} />}</Field>
        {f.kind === 'desktop' && <Field label="Startanleitung" className="full" hint="Wie wird die App gestartet? (wird bei „Öffnen“ angezeigt)">{(id) => <input id={id} className="input" value={f.launchHint} onChange={(e) => set('launchHint')(e.target.value)} />}</Field>}
        <Field label="Kurzbeschreibung" className="full">{(id) => <input id={id} className="input" value={f.summary} onChange={(e) => set('summary')(e.target.value)} />}</Field>
        <Field label="Funktionen" className="full" hint="Eine Funktion pro Zeile">{(id) => <textarea id={id} className="textarea" rows={3} value={f.features} onChange={(e) => set('features')(e.target.value)} />}</Field>
        <Field label="Zugehöriges Projekt">{() => (
          <div className="row"><span className="truncate small" style={{ flex: 1 }}>{f.nodeName || (f.nodeId ? 'Projekt gewählt' : 'Keines')}</span><Button size="sm" onClick={() => setPick(true)}>Wählen</Button>{f.nodeId && <Button size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, nodeId: null, nodeName: '' }))}>Entfernen</Button>}</div>
        )}</Field>
        <Field label="Kategorie">{(id) => <CategorySelect id={id} value={f.categoryId} onChange={set('categoryId')} />}</Field>
        <Field label="Icon">{(id) => <select id={id} className="select" value={f.icon} onChange={(e) => set('icon')(e.target.value)}><option value="">Automatisch</option>{ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</select>}</Field>
        <Field label="Farbe">{(id) => <input id={id} type="color" value={f.color || '#8d95ff'} onChange={(e) => set('color')(e.target.value)} style={{ width: 44, height: 38, border: 0, background: 'none' }} />}</Field>
        {err && <div className="full callout crit">{err}</div>}
        <button type="submit" hidden />
      </form>
      <Dialog open={pick} onClose={() => setPick(false)} title="Projekt wählen"><NodePicker onPick={(n) => { if (n) setF((s) => ({ ...s, nodeId: n.id, nodeName: n.name })); setPick(false); }} /></Dialog>
    </Dialog>
  );
}

function launch(app: AppDto, navigate: (to: string) => void, toast: ReturnType<typeof useToast>) {
  api.post(`/api/apps/${app.id}/opened`).catch(() => undefined);
  if (!app.launchUrl) { toast({ kind: 'info', title: 'Kein Startpunkt', body: app.launchHint ?? 'Für diese Anwendung ist kein Startpunkt hinterlegt.' }); return; }
  if (app.launchUrl.startsWith('/')) navigate(app.launchUrl);
  else window.open(app.launchUrl, '_blank', 'noopener,noreferrer');
  if (app.kind === 'desktop' && app.launchHint) toast({ kind: 'info', title: 'Start', body: app.launchHint });
}

export default function AppStorePage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [editing, setEditing] = useState<AppDto | null>(null);
  const [confirmManual, setConfirmManual] = useState<AppDto | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [trash, setTrash] = useState<AppDto | null>(null);
  const apps = useQuery({ queryKey: ['apps', q, kind, onlyAvailable], queryFn: () => api.get<AppDto[]>(`/api/apps${qs({ q, kind, availability: onlyAvailable ? 'available' : undefined })}`) });
  const check = useMutation({
    mutationFn: (id: string) => api.post<AppDto>(`/api/apps/${id}/check`),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['apps'] }); toast({ kind: a.availability === 'available' ? 'success' : 'warning', title: a.availability === 'available' ? `${a.name} ist erreichbar` : `${a.name}: ${a.lastCheck?.error ?? 'nicht erreichbar'}`, body: a.availabilityNote ?? undefined }); },
  });
  const fav = useMutation({ mutationFn: (a: AppDto) => api.patch(`/api/apps/${a.id}`, { favorite: !a.favorite }), onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }) });
  const manual = useMutation({ mutationFn: () => api.post(`/api/apps/${confirmManual!.id}/confirm`, { note: manualNote }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['apps'] }); setConfirmManual(null); setManualNote(''); } });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/apps/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['apps'] }); setTrash(null); toast({ kind: 'success', title: 'In den Papierkorb gelegt' }); } });
  const archive = useMutation({ mutationFn: (a: AppDto) => api.post(`/api/apps/${a.id}/archive`, { archived: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }) });
  const newOpen = params.get('new') === '1';
  const highlight = params.get('app');
  useEffect(() => { if (highlight) document.getElementById(`app-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [highlight, apps.data]);
  const close = () => { const p = new URLSearchParams(params); p.delete('new'); p.delete('project'); setParams(p, { replace: true }); };

  const KIND_ICON: Record<string, React.ReactNode> = { hosted_web: <Globe size={13} />, external_url: <ExternalLink size={13} />, internal: <AppWindow size={13} />, desktop: <Monitor size={13} />, product_page: <Package size={13} /> };

  return (
    <div>
      <PageHeader eyebrow={<><AppWindow size={14} /> App Store</>} title="Meine Anwendungen" lead="Dein persönlicher Katalog fertiger Anwendungen. Als verfügbar gilt nur, was nachweislich startet."
        actions={<Button variant="primary" onClick={() => setParams({ new: '1' })}><Plus /> Anwendung</Button>} />
      <div className="row" style={{ marginBottom: 20, gap: 12 }}>
        <div className="input-icon" style={{ flex: '1 1 240px' }}><Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Apps durchsuchen …" aria-label="Apps durchsuchen" /></div>
        <div className="chips">
          <button className="chip" aria-pressed={!kind} onClick={() => setKind('')}>Alle</button>
          {APP_KINDS.map((k) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}>{KIND_ICON[k]}{APP_KIND_LABELS[k]}</button>)}
          <button className="chip" aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable((v) => !v)}><ShieldCheck />Nur verfügbare</button>
        </div>
      </div>
      {apps.error ? <ErrorState error={apps.error} /> : !apps.data ? <SkeletonCards /> : apps.data.length === 0 ? (
        <EmptyState icon={<AppWindow />} title="Noch keine Anwendungen" action={<Button variant="primary" onClick={() => setParams({ new: '1' })}><Plus /> Erste App hinzufügen</Button>}>
          Füge gehostete Web-Apps, externe URLs, interne Anwendungen oder Desktop-Apps hinzu und verknüpfe sie mit ihren Projekten.
        </EmptyState>
      ) : (
        <div className="grid-cards stagger">
          {apps.data.map((a) => (
            <article key={a.id} id={`app-${a.id}`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, outline: highlight === a.id ? '2px solid var(--accent)' : undefined }}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
                <TileIcon name={a.icon} color={a.color} seed={a.id} size="lg" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 className="truncate" style={{ fontSize: 'var(--fs-lg)' }}>{a.name}</h2>
                  <div className="row subtle xsmall" style={{ gap: 6 }}>{KIND_ICON[a.kind]}{a.kindLabel}</div>
                  <div style={{ marginTop: 6 }}><AvailabilityBadge status={a.availability} /></div>
                </div>
                <button className="btn ghost icon sm" aria-pressed={a.favorite} aria-label={a.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'} onClick={() => fav.mutate(a)}><Star fill={a.favorite ? 'var(--warn)' : 'none'} color={a.favorite ? 'var(--warn)' : 'currentColor'} /></button>
              </div>
              {a.summary && <p className="muted small clamp-2">{a.summary}</p>}
              {a.features.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{a.features.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>}
              <div className="subtle xsmall">
                {a.project && <>Projekt: <Link to={`/projects/${a.project.id}`}>{a.project.name}</Link> · </>}
                {a.lastCheck ? <>geprüft {relTime(a.lastCheck.at)}{a.lastCheck.ms ? ` (${a.lastCheck.ms} ms)` : ''}</> : 'noch nie geprüft'}
                {a.lastCheck?.error && <span style={{ color: 'var(--warn)' }}> · {a.lastCheck.error}</span>}
              </div>
              <div className="row" style={{ marginTop: 'auto', gap: 6 }}>
                <Button variant="primary" size="sm" onClick={() => launch(a, navigate, toast)} disabled={!a.launchUrl && !a.launchHint}><Play /> Öffnen</Button>
                <Button size="sm" onClick={() => check.mutate(a.id)} loading={check.isPending && check.variables === a.id}><RefreshCw /> Prüfen</Button>
                {a.kind === 'desktop' && a.availability !== 'available' && <Button size="sm" variant="ghost" onClick={() => setConfirmManual(a)}>Start bestätigen</Button>}
                <span className="spacer" />
                <Button size="sm" variant="ghost" icon onClick={() => setEditing(a)} aria-label={`${a.name} bearbeiten`}><Pencil /></Button>
                <Button size="sm" variant="ghost" icon onClick={() => archive.mutate(a)} aria-label={`${a.name} archivieren`}><Archive /></Button>
                <Button size="sm" variant="ghost" icon onClick={() => setTrash(a)} aria-label={`${a.name} löschen`}><Trash2 /></Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <AppForm open={newOpen || Boolean(editing)} onClose={() => { setEditing(null); close(); }} app={editing} projectId={params.get('project')} />
      <Dialog open={Boolean(confirmManual)} onClose={() => setConfirmManual(null)} title="Start manuell bestätigen" description="Desktop-Apps können nicht vom Server geprüft werden. Bestätige nur, was du tatsächlich gestartet hast."
        footer={<><Button onClick={() => setConfirmManual(null)}>Abbrechen</Button><Button variant="primary" disabled={!manualNote.trim()} loading={manual.isPending} onClick={() => manual.mutate()}>Bestätigen</Button></>}>
        <Field label="Wie wurde die App gestartet?">{(id) => <input id={id} className="input" value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="z. B. Am MacBook über das Dock gestartet, Version 1.2" data-autofocus />}</Field>
        <div style={{ marginTop: 12 }}><Callout>Wird als „Manuell bestätigt“ angezeigt – nicht als technisch geprüft.</Callout></div>
      </Dialog>
      <ConfirmDialog open={Boolean(trash)} onClose={() => setTrash(null)} onConfirm={() => trash && del.mutate(trash.id)} danger title={`„${trash?.name}“ in den Papierkorb?`} confirmLabel="In den Papierkorb">Wiederherstellbar unter Backup & Sicherheit → Papierkorb.</ConfirmDialog>
    </div>
  );
}
