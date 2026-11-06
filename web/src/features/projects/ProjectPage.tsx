import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AppWindow, Archive, ArchiveRestore, Bot, ChevronRight, Copy, ExternalLink, FileText, FolderInput, GitBranch, History, Image as ImageIcon, Link2, MoreHorizontal,
  Pencil, Plus, ShieldCheck, Star, Trash2, Upload, X, Check, Info, Boxes,
} from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import type { ActivityItem, NodeChild, NodeDetail, Repo } from '../../api/types';
import { relTime, dateTime, bytes } from '../../lib/format';
import { Button, Callout, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Menu, Progress, Ring, Skeleton, Tabs, useToast } from '../../components/ui';
import { AvailabilityBadge, CodeBadge, HealthDot, LifecycleBadge, OriginBadge, ReviewBadge, StatusPipeline } from '../../components/ui/Status';
import { Markdown } from '../../components/ui/Markdown';
import { TileIcon } from '../../components/ui/Icon';
import { KindIcon, NodeFormDialog, NodePicker } from './shared';
import { ACTOR_LABELS, NODE_KIND_LABELS, PRIORITY_LABELS, type Actor, type NodeKind } from '@shared/domain';

type Tab = 'overview' | 'structure' | 'code' | 'activity' | 'versions';

function ChildRows({ items, onAdd }: { items: NodeChild[]; onAdd: () => void }) {
  if (!items.length) return <EmptyState icon={<Boxes />} title="Noch keine Unterobjekte" action={<Button onClick={onAdd}><Plus /> Modul hinzufügen</Button>}>Module, Funktionen und Dokumentationen strukturieren das Projekt – beliebig tief.</EmptyState>;
  return (
    <div className="list">
      {items.map((c) => (
        <Link key={c.id} to={`/projects/${c.id}`} className="list-item">
          <KindIcon kind={c.kind} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="row" style={{ gap: 8 }}><strong className="truncate small">{c.name}</strong>{c.childCount > 0 && <span className="badge">{c.childCount}</span>}</span>
            <span className="subtle xsmall">{c.kindLabel}{c.nature === 'technical' ? ' · technisch' : ''}{c.codePath ? ` · ${c.codePath}` : ''}</span>
          </span>
          <span className="row hide-sm" style={{ gap: 6 }}><LifecycleBadge status={c.lifecycleStatus} />{c.codeStatus.status !== 'not_linked' && <CodeBadge status={c.codeStatus.status} detail={c.codeStatus.detail} />}</span>
          <ChevronRight size={16} className="subtle" />
        </Link>
      ))}
    </div>
  );
}

function Versions({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const v = useQuery({ queryKey: ['node', id, 'versions'], queryFn: () => api.get<{ id: number; version: number; change_kind: string; actor: string; at: string; snapshot: Record<string, unknown> }[]>(`/api/nodes/${id}/versions`) });
  const [confirm, setConfirm] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (ver: number) => api.post(`/api/nodes/${id}/versions/${ver}/restore`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['node', id] }); toast({ kind: 'success', title: 'Version wiederhergestellt', body: 'Der vorherige Stand bleibt als eigene Version erhalten.' }); setConfirm(null); },
  });
  if (!v.data) return <Skeleton h={200} />;
  const LABEL: Record<string, string> = { create: 'Angelegt', update: 'Geändert', delete: 'In Papierkorb', restore: 'Wiederhergestellt', archive: 'Archiv', move: 'Verschoben' };
  return (
    <Card title="Versionshistorie" icon={<History />}>
      <p className="subtle small" style={{ marginBottom: 12 }}>Jede Änderung wird als Version gespeichert. Ein Zurücksetzen erzeugt eine neue Version – nichts geht verloren.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Version</th><th>Änderung</th><th>Durch</th><th>Zeitpunkt</th><th>Name / Status</th><th /></tr></thead>
          <tbody>
            {v.data.map((r) => (
              <tr key={r.id}>
                <td className="mono">v{r.version}</td><td>{LABEL[r.change_kind] ?? r.change_kind}</td><td>{ACTOR_LABELS[r.actor as Actor] ?? r.actor}</td>
                <td title={dateTime(r.at)}>{relTime(r.at)}</td><td className="small">{String(r.snapshot.name ?? '')} · {String(r.snapshot.lifecycle_status ?? '')}</td>
                <td>{r.change_kind !== 'delete' && <Button size="sm" variant="ghost" onClick={() => setConfirm(r.version)}>Wiederherstellen</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm !== null && restore.mutate(confirm)} loading={restore.isPending} title={`Version v${confirm} wiederherstellen?`} confirmLabel="Wiederherstellen">
        Inhalte und Position werden auf diese Version gesetzt. Der aktuelle Stand bleibt in der Historie erhalten.
      </ConfirmDialog>
    </Card>
  );
}

function ActivityTimeline({ projectId }: { projectId: string }) {
  const a = useQuery({ queryKey: ['activity', 'project', projectId], queryFn: () => api.get<{ items: ActivityItem[] }>(`/api/activity${qs({ projectId, limit: 100 })}`) });
  if (!a.data) return <Skeleton h={200} />;
  if (!a.data.items.length) return <EmptyState icon={<Activity />} title="Noch keine Aktivität" />;
  return (
    <Card title="Projektchronik" icon={<Activity />}>
      <ol className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {a.data.items.map((e) => (
          <li key={e.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className={`badge ${e.actor === 'claude' ? 'accent' : e.actor === 'github' ? 'ion' : 'outline'}`}>{ACTOR_LABELS[e.actor as Actor] ?? e.actor}</span>
            <span className="small" style={{ flex: 1 }}>{e.summary}</span>
            <span className="meta" title={dateTime(e.at)}>{relTime(e.at)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function RepoLinkDialog({ open, onClose, nodeId }: { open: boolean; onClose: () => void; nodeId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get<Repo[]>('/api/repos'), enabled: open });
  const link = useMutation({
    mutationFn: (repositoryId: string) => api.post(`/api/nodes/${nodeId}/repos`, { repositoryId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['node', nodeId] }); toast({ kind: 'success', title: 'Repository verknüpft', body: 'Bestätigte Zuordnung über die stabile Repository-ID.' }); onClose(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Repository verknüpfen" description="Nur lesend. Fehlt ein Repository, füge es im Sync Center hinzu.">
      {repos.data?.length === 0 && <Callout>Noch keine Repositories verfolgt. <Link to="/sync?tab=repos">Im Sync Center hinzufügen →</Link></Callout>}
      <div className="list">
        {repos.data?.map((r) => (
          <button key={r.id} className="list-item" onClick={() => link.mutate(r.id)}>
            <GitBranch size={16} /><span className="truncate">{r.fullName}</span><span className="meta">{r.primaryLanguage ?? ''} {r.status !== 'ok' ? `· ${r.status}` : ''}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function Attachments({ d }: { d: NodeDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('entityType', 'node');
    form.append('entityId', d.node.id);
    try { await api.upload('/api/attachments', form); qc.invalidateQueries({ queryKey: ['node', d.node.id] }); toast({ kind: 'success', title: 'Screenshot gespeichert', body: 'Bilder sind Teil jeder Datensicherung.' }); }
    catch (e) { toast({ kind: 'error', title: 'Upload fehlgeschlagen', body: (e as Error).message }); }
  };
  return (
    <Card title="Screenshots" icon={<ImageIcon />} actions={<><input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button size="sm" onClick={() => input.current?.click()}><Upload /> Hochladen</Button></>}>
      {d.attachments.length === 0 ? <p className="subtle small">Keine Screenshots. PNG, JPEG, WebP oder GIF bis 2 MB.</p> : (
        <div className="grid-3">
          {d.attachments.map((a) => (
            <button key={a.id} className="card flush interactive" onClick={() => setPreview(a.id)} aria-label={`Screenshot ${a.filename} vergrößern`}>
              <img src={`/api/attachments/${a.id}`} alt={a.filename} style={{ aspectRatio: '16/10', objectFit: 'cover', width: '100%' }} loading="lazy" />
              <div className="subtle xsmall truncate" style={{ padding: 8 }}>{a.filename} · {bytes(a.size)}</div>
            </button>
          ))}
        </div>
      )}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title="Screenshot" wide>
        {preview && <img src={`/api/attachments/${preview}`} alt="Screenshot" style={{ width: '100%', borderRadius: 12 }} />}
        <div className="row" style={{ marginTop: 12 }}><Button variant="danger" size="sm" onClick={async () => { await api.del(`/api/attachments/${preview}`); setPreview(null); qc.invalidateQueries({ queryKey: ['node', d.node.id] }); }}><Trash2 /> Löschen</Button></div>
      </Dialog>
    </Card>
  );
}

export default function ProjectPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [edit, setEdit] = useState(false);
  const [addChild, setAddChild] = useState(false);
  const [move, setMove] = useState(false);
  const [trash, setTrash] = useState(false);
  const [linkRepo, setLinkRepo] = useState(false);
  const q = useQuery({ queryKey: ['node', id], queryFn: () => api.get<NodeDetail>(`/api/nodes/${id}`) });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['node', id] }); qc.invalidateQueries({ queryKey: ['nodes'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/api/nodes/${id}`, body), onSuccess: invalidate, onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht gespeichert', body: e.message }) });
  const archive = useMutation({ mutationFn: (archived: boolean) => api.post(`/api/nodes/${id}/archive`, { archived }), onSuccess: (_, a) => { invalidate(); toast({ kind: 'success', title: a ? 'Archiviert' : 'Reaktiviert', body: a ? 'Aus der aktiven Ansicht entfernt – alle Daten bleiben erhalten.' : undefined }); } });
  const doMove = useMutation({ mutationFn: (parentId: string | null) => api.post(`/api/nodes/${id}/move`, { parentId }), onSuccess: () => { invalidate(); setMove(false); toast({ kind: 'success', title: 'Verschoben' }); }, onError: (e: ApiError) => toast({ kind: 'error', title: 'Verschieben nicht möglich', body: e.message }) });
  const doTrash = useMutation({
    mutationFn: () => api.del<{ trashed: string[] }>(`/api/nodes/${id}?cascade=1`),
    onSuccess: (r) => { toast({ kind: 'success', title: 'In den Papierkorb gelegt', body: `${r.trashed.length} Objekt(e) – unter Backup & Sicherheit wiederherstellbar.` }); invalidate(); nav(q.data?.node.parentId ? `/projects/${q.data.node.parentId}` : '/projects'); },
  });
  const unlinkRepo = useMutation({ mutationFn: (repoId: string) => api.del(`/api/nodes/${id}/repos/${repoId}`), onSuccess: invalidate });
  const confirmRepo = useMutation({ mutationFn: (repoId: string) => api.post(`/api/nodes/${id}/repos`, { repositoryId: repoId }), onSuccess: invalidate });
  const rejectRepo = useMutation({ mutationFn: (repoId: string) => api.post(`/api/nodes/${id}/repos/${repoId}/reject`), onSuccess: invalidate });

  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <div className="stack"><Skeleton h={30} w={300} /><Skeleton h={120} r={16} /><Skeleton h={300} r={16} /></div>;
  const d = q.data;
  const n = d.node;
  const docs = d.children.filter((c) => c.kind === 'documentation');
  const claudeIdentity = d.identities.find((i) => i.source === 'claude');

  return (
    <div>
      <nav className="breadcrumbs" aria-label="Brotkrumen">
        <Link to="/projects">Projekte</Link>
        {d.ancestors.map((a) => <span key={a.id} className="row" style={{ gap: 4 }}><ChevronRight size={14} /><Link to={`/projects/${a.id}`}>{a.name}</Link></span>)}
      </nav>
      <header className="page-header" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'nowrap', minWidth: 0 }}>
          <TileIcon name={n.icon ?? d.category?.icon} color={n.color ?? d.category?.color} seed={n.id} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow row" style={{ gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
              {NODE_KIND_LABELS[n.kind as NodeKind]}{d.category && <> · {d.category.name}</>}{n.nature === 'technical' && n.kind !== 'project' && <> · technisch</>}
            </div>
            <h1 className="row" style={{ gap: 10 }}>{n.name}
              <button className="btn ghost icon sm" aria-pressed={n.favorite} aria-label={n.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten'} onClick={() => patch.mutate({ favorite: !n.favorite })}>
                <Star fill={n.favorite ? 'var(--warn)' : 'none'} color={n.favorite ? 'var(--warn)' : 'currentColor'} />
              </button>
            </h1>
            {n.summary && <p className="lead muted" style={{ marginTop: 6 }}>{n.summary}</p>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <StatusPipeline lifecycle={n.lifecycleStatus} code={d.codeStatus.status} codeDetail={d.codeStatus.detail ?? d.codeStatus.repoName} verification={n.verificationStatus} />
              <ReviewBadge state={n.reviewState} />
              <OriginBadge origin={n.origin} />
              {n.archivedAt && <span className="badge unknown"><Archive /> Archiviert</span>}
            </div>
          </div>
        </div>
        <div className="page-actions">
          <Button onClick={() => setEdit(true)}><Pencil /> Bearbeiten</Button>
          <Button onClick={() => setAddChild(true)}><Plus /> Unterobjekt</Button>
          <Menu trigger={(p) => <Button icon aria-label="Weitere Aktionen" {...p}><MoreHorizontal /></Button>}>
            {(close) => <>
              <button className="menu-item" role="menuitem" onClick={() => { close(); setMove(true); }}><FolderInput /> Verschieben …</button>
              <button className="menu-item" role="menuitem" onClick={() => { close(); setLinkRepo(true); }}><GitBranch /> Repository verknüpfen …</button>
              <button className="menu-item" role="menuitem" onClick={() => { close(); archive.mutate(!n.archivedAt); }}>{n.archivedAt ? <><ArchiveRestore /> Reaktivieren</> : <><Archive /> Archivieren</>}</button>
              <button className="menu-item" role="menuitem" onClick={() => { close(); navigator.clipboard.writeText(n.id); toast({ kind: 'info', title: 'ID kopiert', body: n.id }); }}><Copy /> Interne ID kopieren</button>
              <button className="menu-item danger" role="menuitem" onClick={() => { close(); setTrash(true); }}><Trash2 /> In den Papierkorb</button>
            </>}
          </Menu>
        </div>
      </header>

      {d.openConflicts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Callout kind="warn" title={`${d.openConflicts.length} offene Konflikte`}>
            {d.openConflicts.map((c) => <div key={c.id}><Link to={`/conflicts/${c.id}`}>{c.title} →</Link></div>)}
          </Callout>
        </div>
      )}

      <Tabs label="Projektbereiche" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Übersicht', icon: <Info /> },
        { id: 'structure', label: 'Struktur', icon: <Boxes />, badge: d.descendants ? <span className="badge">{d.descendants}</span> : undefined },
        { id: 'code', label: 'Code & Apps', icon: <GitBranch /> },
        { id: 'activity', label: 'Chronik', icon: <Activity /> },
        { id: 'versions', label: 'Versionen', icon: <History /> },
      ]} />

      {tab === 'overview' && (
        <div className="split">
          <div className="stack">
            <Card title="Beschreibung" icon={<FileText />}>
              {n.description ? <Markdown>{n.description}</Markdown> : <p className="subtle small">Noch keine Beschreibung. Claude kann sie per MCP liefern, oder du ergänzt sie selbst.</p>}
              {n.kind === 'documentation' && n.body && <><hr className="divider" /><div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}><Button size="sm" onClick={() => { navigator.clipboard.writeText(n.body ?? ''); toast({ kind: 'success', title: 'In die Zwischenablage kopiert', body: 'Bereit zum Einfügen in Claude.' }); }}><Copy /> Kopieren</Button></div><Markdown>{n.body}</Markdown></>}
            </Card>
            {docs.length > 0 && (
              <Card title="Dokumentation" icon={<FileText />}>
                <div className="list">{docs.map((c) => <Link key={c.id} to={`/projects/${c.id}`} className="list-item"><FileText size={16} /><span className="truncate">{c.name}</span><span className="meta">{relTime(c.updatedAt)}</span></Link>)}</div>
              </Card>
            )}
            <Card title="Module & Unterobjekte" icon={<Boxes />} actions={<Button size="sm" onClick={() => setAddChild(true)}><Plus /> Hinzufügen</Button>}>
              <ChildRows items={d.children.filter((c) => c.kind !== 'documentation')} onAdd={() => setAddChild(true)} />
            </Card>
            <Attachments d={d} />
          </div>
          <div className="stack">
            <Card title="Projektgesundheit" icon={<ShieldCheck />}>
              <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
                <Ring value={d.health.score} size={64} color={d.health.health === 'ok' ? 'var(--ok)' : d.health.health === 'attention' ? 'var(--warn)' : 'var(--crit)'} label={`Gesundheit ${d.health.score} von 100`} />
                <p className="subtle xsmall">Nachvollziehbar aus Aktualität, Beschreibung, Kategorie, Codebasis, Konflikten und Claude-Sync berechnet.</p>
              </div>
              <ul className="list" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
                {d.health.factors.map((f) => (
                  <li key={f.key} className="list-item" style={{ padding: '6px 0' }}>
                    {f.ok ? <Check size={15} color="var(--ok)" aria-label="erfüllt" /> : <X size={15} color="var(--warn)" aria-label="nicht erfüllt" />}
                    <span className="small" style={{ flex: 1 }}>{f.label}</span><span className="subtle xsmall">{f.detail}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Details" icon={<Info />}>
              <dl className="kv">
                <dt>Priorität</dt><dd>{PRIORITY_LABELS[n.priority]}</dd>
                <dt>Fortschritt</dt><dd>{n.progress != null ? <div className="stack-sm"><span>{n.progress} %</span><Progress value={n.progress} /></div> : '–'}</dd>
                <dt>Prüfnachweis</dt><dd>{n.verificationNote ?? '–'}{n.verifiedAt && <div className="subtle xsmall">{dateTime(n.verifiedAt)}</div>}</dd>
                <dt>Tags</dt><dd>{d.tags.length ? d.tags.map((t) => `#${t}`).join(' ') : '–'}</dd>
                <dt>Codepfad</dt><dd className="mono">{n.codePath ?? '–'}</dd>
                {n.url && <><dt>Website</dt><dd><a href={n.url} target="_blank" rel="noopener noreferrer">{n.url} <ExternalLink size={12} /></a></dd></>}
                {n.claudeProjectUrl && <><dt>Claude-Projekt</dt><dd><a href={n.claudeProjectUrl} target="_blank" rel="noopener noreferrer">Öffnen <ExternalLink size={12} /></a><div className="subtle xsmall">nur Referenz – kein Zugriff</div></dd></>}
                <dt>Angelegt</dt><dd>{dateTime(n.createdAt)}</dd>
                <dt>Geändert</dt><dd>{relTime(n.updatedAt)} · v{n.version}</dd>
                <dt>Interne ID</dt><dd className="mono xsmall">{n.id}</dd>
              </dl>
            </Card>
            <Card title="Herkunft & Identitäten" icon={<Bot />}>
              {claudeIdentity ? (
                <p className="small"><span className="badge accent">Claude</span> externalId <code>{claudeIdentity.external_id}</code><br /><span className="subtle xsmall">Zuletzt übermittelt {relTime(claudeIdentity.last_seen_at)}</span></p>
              ) : <p className="subtle small">Keine Claude-Identität. Sende über den MCP-Server <code>omega_upsert_project</code> mit einer stabilen externalId.</p>}
              {d.sourceIdea && <p className="small" style={{ marginTop: 8 }}>Entstanden aus der Idee <Link to={`/ideas/${d.sourceIdea.id}`}>{d.sourceIdea.title}</Link></p>}
            </Card>
            {n.notes && <Card title="Persönliche Notizen" icon={<Pencil />}><Markdown>{n.notes}</Markdown></Card>}
          </div>
        </div>
      )}

      {tab === 'structure' && (
        <Card title="Struktur" icon={<Boxes />} actions={<Button size="sm" onClick={() => setAddChild(true)}><Plus /> Unterobjekt</Button>}>
          <p className="subtle small" style={{ marginBottom: 12 }}>Organisatorische Struktur der Website. Sie verändert niemals Code oder Daten in GitHub.</p>
          <ChildRows items={d.children} onAdd={() => setAddChild(true)} />
        </Card>
      )}

      {tab === 'code' && (
        <div className="grid-2">
          <Card title="GitHub-Repositories" icon={<GitBranch />} actions={<Button size="sm" onClick={() => setLinkRepo(true)}><Link2 /> Verknüpfen</Button>}>
            {d.repoLinks.length === 0 ? <p className="subtle small">Kein Repository verknüpft. Verknüpfungen erfolgen über die stabile Repository-ID und deine Bestätigung.</p> : (
              <div className="list">
                {d.repoLinks.map((l) => (
                  <div key={l.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <GitBranch size={16} style={{ marginTop: 3 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/code/${l.repo_id}`}><strong className="small">{l.full_name}</strong></Link>
                      <div className="subtle xsmall">{l.status === 'suggested' ? `Vorschlag: ${l.reason ?? ''}` : `bestätigt · ${l.primary_language ?? ''} · Abgleich ${relTime(l.last_synced_at)}`}</div>
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        <HealthDot health={l.repo_status === 'ok' ? 'ok' : l.repo_status === 'pending' ? 'unknown' : 'critical'} /><span className="xsmall subtle">{l.repo_status}</span>
                      </div>
                    </div>
                    {l.status === 'suggested' ? (
                      <div className="row"><Button size="sm" variant="primary" onClick={() => confirmRepo.mutate(l.repo_id)}><Check /> Bestätigen</Button><Button size="sm" variant="ghost" onClick={() => rejectRepo.mutate(l.repo_id)}>Ablehnen</Button></div>
                    ) : <Button size="sm" variant="ghost" onClick={() => unlinkRepo.mutate(l.repo_id)} aria-label={`Verknüpfung zu ${l.full_name} lösen`}>Lösen</Button>}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 12 }}><CodeBadge status={d.codeStatus.status} detail={d.codeStatus.detail} /></div>
          </Card>
          <Card title="Anwendungen" icon={<AppWindow />} actions={<Link className="btn sm" to={`/apps?new=1&project=${n.id}`}><Plus /> App</Link>}>
            {d.apps.length === 0 ? <p className="subtle small">Keine Anwendung zugeordnet.</p> : (
              <div className="list">{d.apps.map((a) => <Link key={a.id} to={`/apps?app=${a.id}`} className="list-item"><AppWindow size={16} /><span className="truncate">{a.name}</span><span className="meta"><AvailabilityBadge status={a.availability} /></span></Link>)}</div>
            )}
          </Card>
        </div>
      )}

      {tab === 'activity' && <ActivityTimeline projectId={n.id} />}
      {tab === 'versions' && <Versions id={n.id} />}

      <NodeFormDialog open={edit} onClose={() => setEdit(false)} node={n} tags={d.tags} />
      <NodeFormDialog open={addChild} onClose={() => setAddChild(false)} parentId={n.id} onSaved={() => invalidate()} />
      <Dialog open={move} onClose={() => setMove(false)} title={`„${n.name}“ verschieben`} description="Zyklen werden automatisch verhindert.">
        <div className="stack">
          <Button onClick={() => doMove.mutate(null)} disabled={!n.parentId}>Auf oberste Ebene (als eigenes Projekt)</Button>
          <NodePicker excludeId={n.id} onPick={(p) => p && doMove.mutate(p.id)} />
        </div>
      </Dialog>
      <ConfirmDialog open={trash} onClose={() => setTrash(false)} onConfirm={() => doTrash.mutate()} loading={doTrash.isPending} danger confirmLabel="In den Papierkorb" title={`„${n.name}“ in den Papierkorb legen?`}>
        <p>{d.descendants ? `Inklusive ${d.descendants} Unterobjekten. ` : ''}Alles bleibt im Papierkorb wiederherstellbar. Verknüpfte GitHub-Repositories werden <strong>nicht</strong> verändert.</p>
      </ConfirmDialog>
      <RepoLinkDialog open={linkRepo} onClose={() => setLinkRepo(false)} nodeId={n.id} />
    </div>
  );
}
