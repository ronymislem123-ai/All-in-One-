import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Archive, Boxes, ChevronRight, GitBranch, LayoutGrid, List, ListTree, Plus, Search, Star, AppWindow, AlertTriangle } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { NodeChild, NodeListItem } from '../../api/types';
import { usePrefs } from '../../lib/session';
import { relTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, Progress, Segmented, SkeletonCards } from '../../components/ui';
import { CodeBadge, LifecycleBadge, ReviewBadge } from '../../components/ui/Status';
import { TileIcon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/layout/PageHeader';
import { CategorySelect, KindIcon, NodeFormDialog } from './shared';
import { LIFECYCLE_LABELS, type LifecycleStatus } from '@shared/domain';

const PAGE = 48;
const STATUS_FILTERS: LifecycleStatus[] = ['idea', 'planned', 'concept', 'in_development', 'claude_reported_done', 'released'];

function ProjectCard({ n }: { n: NodeListItem }) {
  const color = n.color ?? n.category?.color;
  return (
    <Link to={`/projects/${n.id}`} className="card interactive glow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'nowrap' }}>
        <TileIcon name={n.icon ?? n.category?.icon} color={color} seed={n.id} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6 }}>
            <strong className="truncate" style={{ fontSize: 'var(--fs-lg)' }}>{n.name}</strong>
            {n.favorite && <Star size={14} fill="var(--warn)" color="var(--warn)" aria-label="Favorit" />}
          </div>
          <div className="subtle xsmall truncate">{n.category?.name ?? n.kindLabel} · {relTime(n.lastActivityAt)}</div>
        </div>
      </div>
      <p className="muted small clamp-2" style={{ minHeight: '2.9em' }}>{n.summary ?? n.description ?? 'Keine Beschreibung'}</p>
      <div className="row" style={{ gap: 6 }}>
        <LifecycleBadge status={n.lifecycleStatus} />
        <ReviewBadge state={n.reviewState} />
        {n.archivedAt && <span className="badge unknown"><Archive />Archiviert</span>}
        {n.openConflicts > 0 && <span className="badge warn"><AlertTriangle />{n.openConflicts}</span>}
      </div>
      {n.progress != null && <Progress value={n.progress} label={`Fortschritt ${n.progress} %`} />}
      <div className="row subtle xsmall" style={{ gap: 14, marginTop: 'auto' }}>
        <span className="row" style={{ gap: 4 }}><Boxes size={13} /> {n.childCount}</span>
        <span className="row" style={{ gap: 4 }}><GitBranch size={13} /> {n.repoCount}</span>
        <span className="row" style={{ gap: 4 }}><AppWindow size={13} /> {n.appCount}</span>
        {n.tags.slice(0, 2).map((t) => <span key={t}>#{t}</span>)}
      </div>
    </Link>
  );
}

function VirtualList({ items, hasMore, onMore }: { items: NodeListItem[]; hasMore: boolean; onMore: () => void }) {
  const virt = useWindowVirtualizer({ count: items.length, estimateSize: () => 64, overscan: 10 });
  const last = virt.getVirtualItems().at(-1);
  useEffect(() => { if (last && last.index >= items.length - 5 && hasMore) onMore(); }, [last, items.length, hasMore, onMore]);
  return (
    <div className="card flush" role="list" aria-label="Projekte">
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((v) => {
          const n = items[v.index];
          return (
            <Link key={n.id} role="listitem" to={`/projects/${n.id}`} className="list-item" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 64, transform: `translateY(${v.start}px)`, padding: '0 16px', borderTop: v.index ? '1px solid var(--divider)' : 0 }}>
              <TileIcon name={n.icon ?? n.category?.icon} color={n.color ?? n.category?.color} seed={n.id} size="sm" />
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong className="truncate" style={{ display: 'block' }}>{n.name}</strong>
                <span className="subtle xsmall truncate" style={{ display: 'block' }}>{n.summary ?? n.category?.name ?? n.kindLabel}</span>
              </span>
              <span className="hide-sm"><LifecycleBadge status={n.lifecycleStatus} /></span>
              <span className="meta hide-sm" style={{ width: 110, textAlign: 'right' }}>{relTime(n.lastActivityAt)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function TreeLevel({ parentId, depth }: { parentId: string | null; depth: number }) {
  const q = useQuery({ queryKey: ['nodes', 'children', parentId], queryFn: () => api.get<NodeChild[]>(`/api/nodes/children${qs({ parent: parentId ?? 'root' })}`) });
  if (q.isLoading) return <div className="subtle small" style={{ paddingLeft: depth * 22 + 30 }}>Lädt …</div>;
  return <>{q.data?.map((n) => <TreeRow key={n.id} n={n} depth={depth} />)}</>;
}
function TreeRow({ n, depth }: { n: NodeChild; depth: number }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div role="treeitem" aria-expanded={n.childCount ? open : undefined} aria-level={depth + 1}>
      <div className="tree-row">
        <span className="tree-indent" style={{ width: depth * 22 }} />
        {n.childCount ? (
          <button className="tree-toggle" aria-expanded={open} aria-label={open ? `${n.name} zuklappen` : `${n.name} aufklappen`} onClick={() => setOpen((o) => !o)}><ChevronRight /></button>
        ) : <span style={{ width: 24 }} />}
        <KindIcon kind={n.kind} />
        <Link to={`/projects/${n.id}`} className="truncate" style={{ fontWeight: depth === 0 ? 600 : 400 }}>{n.name}</Link>
        <span className="subtle xsmall hide-sm">{n.kindLabel}</span>
        <span className="spacer" />
        <span className="hide-sm row" style={{ gap: 6 }}><LifecycleBadge status={n.lifecycleStatus} />{n.codeStatus.status !== 'not_linked' && <CodeBadge status={n.codeStatus.status} detail={n.codeStatus.detail} />}</span>
        {n.childCount > 0 && <span className="badge">{n.childCount}</span>}
      </div>
      {open && <div role="group"><TreeLevel parentId={n.id} depth={depth + 1} /></div>}
    </div>
  );
}

export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const [prefs, setPrefs] = usePrefs();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [dq, setDq] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const view = prefs.libraryView;
  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const archived = params.get('archived') ?? 'exclude';
  const favorite = params.get('favorite') === '1';
  const review = params.get('review') ?? '';
  const sort = params.get('sort') ?? prefs.librarySort ?? 'activity';
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const filters = useMemo(() => ({ kinds: 'project,subproject', parent: status || category || dq || favorite || review || archived !== 'exclude' ? undefined : 'root', q: dq, status, category, archived, favorite: favorite ? '1' : undefined, review, sort }), [dq, status, category, archived, favorite, review, sort]);
  const list = useInfiniteQuery({
    queryKey: ['nodes', 'library', filters],
    queryFn: ({ pageParam }) => api.get<{ total: number; items: NodeListItem[] }>(`/api/nodes${qs({ ...filters, limit: PAGE, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length * PAGE : undefined),
    enabled: view !== 'tree',
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const newOpen = params.get('new') === '1';

  return (
    <div>
      <PageHeader
        eyebrow={<><Boxes size={14} /> Project Library</>}
        title="Projektbibliothek"
        lead="Alle Projekte, Unterprojekte und Module – organisiert auf der Website, angereichert durch Claude, verknüpft mit GitHub."
        actions={<>
          <Segmented label="Ansicht" value={view} onChange={(v) => setPrefs({ libraryView: v })} options={[{ value: 'grid', label: <span className="hide-sm">Karten</span>, icon: <LayoutGrid /> }, { value: 'list', label: <span className="hide-sm">Liste</span>, icon: <List /> }, { value: 'tree', label: <span className="hide-sm">Struktur</span>, icon: <ListTree /> }]} />
          <Button variant="primary" onClick={() => setParam('new', '1')}><Plus /> Neues Projekt</Button>
        </>}
      />

      {view !== 'tree' && (
        <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="input-icon" style={{ flex: '1 1 260px' }}>
              <Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Projekte durchsuchen …" aria-label="Projekte durchsuchen" />
            </div>
            <div style={{ flex: '0 1 220px' }}><CategorySelect value={category || null} onChange={(v) => setParam('category', v)} label="Alle Kategorien" /></div>
            <select className="select" style={{ flex: '0 1 180px' }} value={sort} onChange={(e) => { setParam('sort', e.target.value); setPrefs({ librarySort: e.target.value }); }} aria-label="Sortierung">
              <option value="activity">Zuletzt aktiv</option><option value="name">Name</option><option value="priority">Priorität</option><option value="created">Neueste</option><option value="progress">Fortschritt</option>
            </select>
          </div>
          <div className="chips" style={{ marginTop: 12 }}>
            {STATUS_FILTERS.map((s) => (
              <button key={s} className="chip" aria-pressed={status === s} onClick={() => setParam('status', status === s ? null : s)}>{LIFECYCLE_LABELS[s]}</button>
            ))}
            <button className="chip" aria-pressed={favorite} onClick={() => setParam('favorite', favorite ? null : '1')}><Star />Favoriten</button>
            <button className="chip" aria-pressed={review === 'needs_review' || review === 'unassigned'} onClick={() => setParam('review', review ? null : 'unassigned')}><AlertTriangle />Nicht zugeordnet</button>
            <button className="chip" aria-pressed={archived === 'only'} onClick={() => setParam('archived', archived === 'only' ? null : 'only')}><Archive />Archiv</button>
          </div>
        </div>
      )}

      {view === 'tree' ? (
        <div className="card" role="tree" aria-label="Projektstruktur"><TreeLevel parentId={null} depth={0} /></div>
      ) : list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : list.isLoading ? <SkeletonCards /> : items.length === 0 ? (
        <EmptyState icon={<Boxes />} title={dq || status || category ? 'Keine Treffer' : 'Deine Bibliothek ist noch leer'} action={!dq && <Button variant="primary" onClick={() => setParam('new', '1')}><Plus /> Erstes Projekt anlegen</Button>}>
          {dq || status || category ? 'Passe die Filter an oder suche nach einem anderen Begriff.' : 'Lege Projekte an, übernimm Ideen aus dem Idea Hub oder lass Claude Projekte über den MCP-Server übermitteln.'}
        </EmptyState>
      ) : (
        <>
          <p className="subtle small" style={{ marginBottom: 12 }} aria-live="polite">{total} {total === 1 ? 'Projekt' : 'Projekte'}</p>
          {view === 'grid' ? (
            <div className="grid-cards stagger">{items.map((n) => <ProjectCard key={n.id} n={n} />)}</div>
          ) : <VirtualList items={items} hasMore={Boolean(list.hasNextPage)} onMore={() => !list.isFetchingNextPage && list.fetchNextPage()} />}
          {view === 'grid' && list.hasNextPage && <div style={{ textAlign: 'center', marginTop: 20 }}><Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Weitere laden</Button></div>}
        </>
      )}

      <NodeFormDialog open={newOpen} onClose={() => setParam('new', null)} onSaved={(id) => { qc.invalidateQueries({ queryKey: ['nodes'] }); nav(`/projects/${id}`); }} />
    </div>
  );
}
