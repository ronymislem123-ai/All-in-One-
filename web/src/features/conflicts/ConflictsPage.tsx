import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CheckCircle, GitMerge, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { ConflictDto } from '../../api/types';
import { dateTime, relTime } from '../../lib/format';
import { Button, Callout, Card, EmptyState, ErrorState, Field, Segmented, Skeleton, useToast } from '../../components/ui';
import { PageHeader } from '../../components/layout/PageHeader';
import { NodePicker } from '../projects/shared';

const NEEDS_TARGET = new Set(['use_existing', 'as_submodule', 'assign_parent', 'link_candidate']);

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '— (leer)';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

function ConflictDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['conflict', id], queryFn: () => api.get<ConflictDto>(`/api/conflicts/${id}`) });
  const [choice, setChoice] = useState('');
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { setChoice(''); setTarget(null); setNote(''); }, [id]);
  const resolve = useMutation({
    mutationFn: (resolution: string) => api.post<ConflictDto>(`/api/conflicts/${id}/resolve`, { resolution, targetId: target?.id, note: note || undefined }),
    onSuccess: () => { qc.invalidateQueries(); toast({ kind: 'success', title: 'Entscheidung gespeichert', body: 'Im Aktivitätsprotokoll nachvollziehbar.' }); nav('/conflicts'); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht möglich', body: e.message }),
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton h={300} r={16} />;
  const c = q.data;
  const incoming = (c.details.incoming ?? null) as Record<string, unknown> | null;
  const isField = c.type === 'field_conflict';
  return (
    <div className="stack">
      <Card title={c.title} icon={<GitMerge />}>
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <span className="badge warn">{c.typeLabel}</span><span className="badge outline">Quelle: {c.source}</span>
          <span className={`badge ${c.status === 'open' ? 'accent' : 'ok'}`}>{c.status === 'open' ? 'Offen' : c.status === 'resolved' ? 'Gelöst' : 'Verworfen'}</span>
          <span className="subtle xsmall">{dateTime(c.createdAt)}</span>
        </div>
        {c.description && <p className="muted small">{c.description}</p>}
        {c.subject && <p className="small" style={{ marginTop: 8 }}>Betroffen: {c.subjectType === 'node' ? <Link to={`/projects/${c.subject.id}`}>{c.subject.name}</Link> : c.subjectType === 'repository' ? <Link to={`/code/${c.subject.id}`}>{c.subject.name}</Link> : c.subject.name}</p>}
      </Card>

      {isField && (
        <div className="grid-2">
          <Card title="Website-Stand (aktiv)" icon={<ShieldCheck />}><pre className="code-view" style={{ padding: 12, whiteSpace: 'pre-wrap' }}>{show(c.details.websiteValue)}</pre></Card>
          <Card title="Von Claude übermittelt" icon={<ArrowLeftRight />}><pre className="code-view" style={{ padding: 12, whiteSpace: 'pre-wrap' }}>{show(c.details.claudeValue)}</pre></Card>
        </div>
      )}
      {incoming && (
        <Card title="Eingehender Datensatz (vorläufig separat gespeichert)"><pre className="code-view" style={{ padding: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(incoming, null, 2)}</pre></Card>
      )}
      {c.candidates.length > 0 && (
        <Card title="Mögliche Zuordnungen">
          <div className="list">
            {c.candidates.map((cand) => (
              <label key={cand.id} className="list-item" style={{ cursor: 'pointer' }}>
                <input type="radio" name="cand" checked={target?.id === cand.id} onChange={() => setTarget({ id: cand.id, name: cand.name })} />
                <span style={{ flex: 1 }}><Link to={`/projects/${cand.id}`}>{cand.name}</Link><span className="subtle xsmall" style={{ display: 'block' }}>{cand.reason}{cand.score !== undefined ? ` · ${Math.round(cand.score * 100)} % Ähnlichkeit` : ''}</span></span>
              </label>
            ))}
          </div>
          <p className="subtle xsmall" style={{ marginTop: 8 }}>Ähnlichkeit ist nur ein Hinweis – entscheide selbst.</p>
        </Card>
      )}

      {c.status === 'open' ? (
        <Card title="Entscheidung" icon={<CheckCircle />}>
          <div className="stack">
            <div className="list">
              {c.options.map((o) => (
                <label key={o.id} className="list-item" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input type="radio" name="res" checked={choice === o.id} onChange={() => setChoice(o.id)} style={{ marginTop: 4 }} />
                  <span><strong className="small">{o.label}</strong><span className="subtle xsmall" style={{ display: 'block' }}>{o.description}</span></span>
                </label>
              ))}
            </div>
            {NEEDS_TARGET.has(choice) && (
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <p className="small" style={{ marginBottom: 8 }}>Ziel: <strong>{target?.name ?? 'bitte wählen'}</strong></p>
                {c.subjectType !== 'repository' || choice === 'link_candidate' ? <NodePicker excludeId={c.subjectType === 'node' ? c.subjectId : undefined} onPick={(n) => n && setTarget({ id: n.id, name: n.name })} /> : null}
              </div>
            )}
            <Field label="Notiz (optional, wird protokolliert)">{(fid) => <input id={fid} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <div className="row">
              <Button variant="primary" disabled={!choice || (NEEDS_TARGET.has(choice) && !target)} loading={resolve.isPending} onClick={() => resolve.mutate(choice)}>Entscheidung anwenden</Button>
              <Button variant="ghost" onClick={() => resolve.mutate('dismiss')}>Verwerfen</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Callout kind="ok" title="Abgeschlossen">Entscheidung: {c.resolution} {c.resolutionNote && `– ${c.resolutionNote}`} · {dateTime(c.resolvedAt)}</Callout>
      )}
    </div>
  );
}

export default function ConflictsPage() {
  const { id } = useParams();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const list = useQuery({ queryKey: ['conflicts', status], queryFn: () => api.get<ConflictDto[]>(`/api/conflicts?status=${status}`) });
  return (
    <div>
      <PageHeader eyebrow={<><GitMerge size={14} /> Konfliktmanagement</>} title="Konflikte & Entscheidungen" lead="Mehrdeutige Zuordnungen werden nie still überschrieben. Beide Stände bleiben erhalten, bis du entscheidest." actions={<Segmented label="Filter" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Offen' }, { value: 'resolved', label: 'Gelöst' }, { value: 'all', label: 'Alle' }]} />} />
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)' }}>
        <div className="card flush" style={{ alignSelf: 'start' }}>
          {list.isLoading ? <div style={{ padding: 16 }}><Skeleton h={160} /></div> : !list.data?.length ? (
            <EmptyState icon={<CheckCircle />} title={status === 'open' ? 'Keine offenen Konflikte' : 'Keine Einträge'}>Alles eindeutig zugeordnet.</EmptyState>
          ) : (
            <div className="list" style={{ padding: 6 }}>
              {list.data.map((c) => (
                <Link key={c.id} to={`/conflicts/${c.id}`} className="list-item" aria-current={id === c.id ? 'page' : undefined} style={{ background: id === c.id ? 'var(--accent-soft)' : undefined, alignItems: 'flex-start' }}>
                  <span className={`dot ${c.status !== 'open' ? 'ok' : c.severity === 'critical' ? 'critical' : 'attention'}`} style={{ marginTop: 6 }} />
                  <span style={{ minWidth: 0, flex: 1 }}><span className="small clamp-2" style={{ fontWeight: 600 }}>{c.title}</span><span className="subtle xsmall">{c.typeLabel} · {relTime(c.createdAt)}</span></span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div>{id ? <ConflictDetail id={id} /> : <div className="card"><EmptyState icon={<GitMerge />} title="Konflikt wählen">Wähle links einen Eintrag, um beide Datenstände zu vergleichen und zu entscheiden.</EmptyState></div>}</div>
      </div>
    </div>
  );
}
