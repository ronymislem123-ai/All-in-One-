import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bookmark, CheckCircle, ClipboardCopy, FolderPlus, Lightbulb, Rocket, Star, Trash2, TriangleAlert, Wrench, Users, Target, Sparkles } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { IdeaDto } from '../../api/types';
import { dateTime } from '../../lib/format';
import { Button, Callout, Card, ConfirmDialog, Dialog, ErrorState, Field, Skeleton, useToast } from '../../components/ui';
import { Icon } from '../../components/ui/Icon';
import { Markdown } from '../../components/ui/Markdown';
import { CategorySelect, NodePicker } from '../projects/shared';
import { IdeaCard, ScoreDots } from './IdeaHubPage';
import { EFFORT_LABELS, IDEA_STATUS_LABELS, IDEA_STATUSES, type IdeaStatus } from '@shared/domain';

const CONF_LABEL: Record<string, { label: string; tone: string; text: string }> = {
  plausibel: { label: 'Plausibel', tone: 'ok', text: 'Nachvollziehbare Einschätzung – keine Garantie.' },
  spekulativ: { label: 'Spekulativ', tone: 'warn', text: 'Unsicher – vor jeder Investition prüfen.' },
  'nicht-vorgesehen': { label: 'Nicht vorgesehen', tone: 'unknown', text: 'Primär für den Eigennutzen gedacht.' },
};

function List({ items, empty = '–' }: { items: string[]; empty?: string }) {
  return items.length ? <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{items.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul> : <p className="subtle small">{empty}</p>;
}

export default function IdeaPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['idea', id], queryFn: () => api.get<{ idea: IdeaDto; similar: IdeaDto[]; variants: IdeaDto[] }>(`/api/ideas/${id}`) });
  const [convert, setConvert] = useState(false);
  const [convertOpts, setConvertOpts] = useState({ name: '', categoryId: null as string | null, parentId: null as string | null, parentName: '' });
  const [pickParent, setPickParent] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['idea', id] }); qc.invalidateQueries({ queryKey: ['ideas'] }); };
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/api/ideas/${id}`, b), onSuccess: invalidate });
  const showBrief = useMutation({ mutationFn: () => api.get<{ brief: string }>(`/api/ideas/${id}/brief`), onSuccess: (r) => setBrief(r.brief) });
  const doConvert = useMutation({
    mutationFn: () => api.post<{ projectId: string; brief: string }>(`/api/ideas/${id}/convert`, { name: convertOpts.name || undefined, categoryId: convertOpts.categoryId ?? undefined, parentId: convertOpts.parentId }),
    onSuccess: (r) => { invalidate(); qc.invalidateQueries({ queryKey: ['nodes'] }); toast({ kind: 'success', title: 'Projekt angelegt', body: 'Der Entwicklungsauftrag liegt als Dokumentation im Projekt.' }); nav(`/projects/${r.projectId}`); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Übernahme nicht möglich', body: e.message }),
  });
  const del = useMutation({ mutationFn: () => api.del(`/api/ideas/${id}`), onSuccess: () => { invalidate(); nav('/ideas'); toast({ kind: 'success', title: 'In den Papierkorb gelegt' }); } });

  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton h={400} r={16} />;
  const { idea: i, similar, variants } = q.data;
  const conf = i.monetization.confidence ? CONF_LABEL[i.monetization.confidence] : null;
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast({ kind: 'success', title: 'Kopiert', body: 'Füge den Auftrag in Claude ein, um die Entwicklung zu starten.' }); };

  return (
    <div>
      <nav className="breadcrumbs" aria-label="Brotkrumen"><Link to="/ideas">AI Idea Hub</Link>{i.category && <><span>›</span><Link to={`/ideas?category=${i.category.id}`}>{i.category.name}</Link></>}</nav>
      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="row subtle xsmall" style={{ gap: 6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}><Icon name={i.category?.icon} size={14} />{i.subcategoryName ?? i.category?.name}</div>
          <h1>{i.title}</h1>
          <p className="lead muted" style={{ marginTop: 8, maxWidth: '70ch' }}>{i.summary}</p>
          <div className="row" style={{ marginTop: 12, gap: 6 }}>
            <span className="badge accent">{IDEA_STATUS_LABELS[i.status as IdeaStatus]}</span>
            <span className="badge outline">{i.sourceLabel}</span>
            {i.sourceDetail && <span className="badge outline">{i.sourceDetail}</span>}
            {i.parentIdeaId && <span className="badge warn">Weiterentwicklung</span>}
          </div>
        </div>
        <div className="page-actions">
          <Button aria-pressed={i.favorite} onClick={() => patch.mutate({ favorite: !i.favorite })}><Star fill={i.favorite ? 'var(--warn)' : 'none'} color={i.favorite ? 'var(--warn)' : 'currentColor'} /> {i.favorite ? 'Favorit' : 'Merken'}</Button>
          {i.status === 'discovered' && <Button onClick={() => patch.mutate({ status: 'saved' })}><Bookmark /> Speichern</Button>}
          <Button onClick={() => showBrief.mutate()} loading={showBrief.isPending}><ClipboardCopy /> Entwicklungsauftrag</Button>
          {i.projectNodeId ? <Link className="btn primary" to={`/projects/${i.projectNodeId}`}><Rocket /> Zum Projekt</Link> : <Button variant="primary" onClick={() => { setConvertOpts({ name: i.title, categoryId: i.categoryId, parentId: null, parentName: '' }); setConvert(true); }}><FolderPlus /> Als Projekt übernehmen</Button>}
        </div>
      </header>

      <Card className="" title="Von der Idee zum Projekt" icon={<Rocket />}>
        <ol className="row" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }} aria-label="Ablauf">
          {['Idee entdeckt', 'Gespeichert', 'Projekt erstellt', 'Entwicklungsauftrag', 'Weiter in Claude', 'GitHub verbinden', 'App Library'].map((s, idx) => {
            const reached = idx === 0 || (idx === 1 && i.status !== 'discovered') || (idx >= 2 && idx <= 3 && Boolean(i.projectNodeId));
            return <li key={s} className={`badge ${reached ? 'ok' : 'outline'}`}>{reached && <CheckCircle />}{idx + 1}. {s}</li>;
          })}
        </ol>
      </Card>

      <div className="split" style={{ marginTop: 20 }}>
        <div className="stack">
          <Card title="Beschreibung" icon={<Lightbulb />}><Markdown>{i.description ?? i.summary}</Markdown></Card>
          <div className="grid-2">
            <Card title="Problemstellung" icon={<TriangleAlert />}><p className="small">{i.problem ?? '–'}</p></Card>
            <Card title="Zielsetzung" icon={<Target />}><p className="small">{i.goal ?? '–'}</p></Card>
            <Card title="Konkreter Nutzen" icon={<CheckCircle />}><p className="small">{i.benefit ?? '–'}</p></Card>
            <Card title="Zielgruppe" icon={<Users />}><p className="small">{i.audience ?? '–'}</p></Card>
          </div>
          <div className="grid-2">
            <Card title="Mögliche Funktionen"><List items={i.features} /></Card>
            <Card title="Besondere Merkmale" icon={<Sparkles />}><List items={i.highlights} /></Card>
            <Card title="Mögliche Technologien" icon={<Wrench />}><div className="chips">{i.technologies.map((t) => <span key={t} className="badge outline">{t}</span>)}</div></Card>
            <Card title="Voraussetzungen"><List items={i.prerequisites} /></Card>
            <Card title="Potenzielle Erweiterungen"><List items={i.extensions} /></Card>
            <Card title="Risiken & Grenzen" icon={<TriangleAlert />}><List items={i.risks} /></Card>
          </div>
          <Card title="Persönliche Notizen">
            <textarea className="textarea" rows={4} value={notes ?? i.notes ?? ''} onChange={(e) => setNotes(e.target.value)} aria-label="Notizen zur Idee" />
            <div className="row" style={{ marginTop: 8 }}><Button size="sm" disabled={notes === null} onClick={() => { patch.mutate({ notes }); setNotes(null); }}>Notiz speichern</Button></div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Einschätzung">
            <p className="subtle xsmall" style={{ marginBottom: 12 }}>Bewertungen sind Einschätzungen, keine Fakten.</p>
            <div className="stack-sm">
              <ScoreDots label="Nutzen" value={i.scores.usefulness} />
              <ScoreDots label="Originalität" value={i.scores.originality} />
              <ScoreDots label="Umsetzbarkeit" value={i.scores.feasibility} />
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Komplexität</dt><dd>{i.complexity ? `${i.complexity}/5` : '–'}</dd>
              <dt>Aufwand</dt><dd>{i.effort ? EFFORT_LABELS[i.effort as keyof typeof EFFORT_LABELS] : '–'}</dd>
              <dt>Status</dt><dd><select className="select" value={i.status} onChange={(e) => patch.mutate({ status: e.target.value })} aria-label="Status">{IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_LABELS[s]}</option>)}</select></dd>
              <dt>Erfasst</dt><dd>{dateTime(i.createdAt)}</dd>
            </dl>
          </Card>
          <Card title="Wirtschaftliche Verwertbarkeit">
            {conf && <span className={`badge ${conf.tone}`}>{conf.label}</span>}
            <p className="small" style={{ marginTop: 8 }}>{i.monetization.assessment ?? 'Keine Einschätzung.'}</p>
            {conf && <p className="subtle xsmall" style={{ marginTop: 6 }}>{conf.text}</p>}
          </Card>
          {variants.length > 0 && <Card title="Varianten & Weiterentwicklungen"><div className="stack-sm">{variants.map((v) => <Link key={v.id} to={`/ideas/${v.id}`} className="small">{v.title} →</Link>)}</div></Card>}
          <Card title="Ähnliche Ideen">
            <div className="stack-sm">{similar.map((s) => <Link key={s.id} to={`/ideas/${s.id}`} className="list-item small"><Icon name={s.category?.icon} size={14} /><span className="truncate" style={{ flex: 1 }}>{s.title}</span><ArrowRight size={14} /></Link>)}</div>
          </Card>
          <Button variant="ghost" onClick={() => setTrash(true)}><Trash2 /> In den Papierkorb</Button>
        </div>
      </div>

      {similar.length > 2 && <div style={{ marginTop: 24 }}><h2 style={{ marginBottom: 12 }}>Weiter stöbern</h2><div className="grid-cards">{similar.slice(0, 3).map((s) => <IdeaCard key={s.id} idea={s} />)}</div></div>}

      <Dialog open={Boolean(brief)} onClose={() => setBrief(null)} wide title="Strukturierter Entwicklungsauftrag" description="Kopiere den Auftrag und füge ihn in Claude ein. Eine automatische Chat-Erstellung gibt es bewusst nicht."
        footer={<><Button onClick={() => setBrief(null)}>Schließen</Button><Button variant="primary" onClick={() => brief && copy(brief)}><ClipboardCopy /> Kopieren</Button></>}>
        <div className="code-view" style={{ maxHeight: '55vh', padding: 16, whiteSpace: 'pre-wrap' }}>{brief}</div>
      </Dialog>
      <Dialog open={convert} onClose={() => setConvert(false)} title="Als Projekt übernehmen" description="Legt ein Projekt mit Entwicklungsauftrag an. Die Idee bleibt erhalten und wird verknüpft."
        footer={<><Button onClick={() => setConvert(false)}>Abbrechen</Button><Button variant="primary" loading={doConvert.isPending} onClick={() => doConvert.mutate()}><FolderPlus /> Projekt anlegen</Button></>}>
        <div className="stack">
          <Field label="Projektname">{(fid) => <input id={fid} className="input" value={convertOpts.name} onChange={(e) => setConvertOpts((s) => ({ ...s, name: e.target.value }))} data-autofocus />}</Field>
          <Field label="Kategorie">{(fid) => <CategorySelect id={fid} value={convertOpts.categoryId} onChange={(v) => setConvertOpts((s) => ({ ...s, categoryId: v }))} />}</Field>
          <Field label="Übergeordnetes Projekt (optional)">{() => <div className="row"><span className="small" style={{ flex: 1 }}>{convertOpts.parentName || 'Eigenständiges Projekt'}</span><Button size="sm" onClick={() => setPickParent(true)}>Wählen</Button></div>}</Field>
          <Callout>Danach: Auftrag in Claude einfügen → Code entsteht in Claude/GitHub → Repository im Projekt verknüpfen → App im App Store eintragen.</Callout>
        </div>
      </Dialog>
      <Dialog open={pickParent} onClose={() => setPickParent(false)} title="Übergeordnetes Projekt"><NodePicker onPick={(n) => { if (n) setConvertOpts((s) => ({ ...s, parentId: n.id, parentName: n.name })); setPickParent(false); }} /></Dialog>
      <ConfirmDialog open={trash} onClose={() => setTrash(false)} onConfirm={() => del.mutate()} danger title="Idee in den Papierkorb legen?" confirmLabel="In den Papierkorb">Wiederherstellbar unter Backup & Sicherheit → Papierkorb.</ConfirmDialog>
    </div>
  );
}
