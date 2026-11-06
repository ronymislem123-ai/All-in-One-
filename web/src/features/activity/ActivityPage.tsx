import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, Search } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { ActivityItem } from '../../api/types';
import { dateTime, relTime, date } from '../../lib/format';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { PageHeader } from '../../components/layout/PageHeader';
import { ACTOR_LABELS, ACTORS, type Actor } from '@shared/domain';

const ENTITY_LINK: Record<string, (id: string) => string> = { node: (id) => `/projects/${id}`, idea: (id) => `/ideas/${id}`, application: (id) => `/apps?app=${id}`, repository: (id) => `/code/${id}`, knowledge: (id) => `/knowledge/${id}` };

export default function ActivityPage() {
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['activity', 'all', actor, entityType, dq],
    queryFn: ({ pageParam }) => api.get<{ items: ActivityItem[]; nextCursor: number | null }>(`/api/activity${qs({ actor, entityType, q: dq, before: pageParam ?? undefined, limit: 60 })}`),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  let lastDay = '';
  return (
    <div>
      <PageHeader eyebrow={<><Activity size={14} /> Activity & History</>} title="Chronik" lead="Durchsuchbarer Verlauf aller relevanten Veränderungen – wer (du, Claude, GitHub, System) hat wann was geändert." />
      <div className="row" style={{ marginBottom: 18, gap: 10 }}>
        <div className="input-icon" style={{ flex: '1 1 240px' }}><Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chronik durchsuchen …" aria-label="Chronik durchsuchen" /></div>
        <div className="chips">
          <button className="chip" aria-pressed={!actor} onClick={() => setActor('')}>Alle</button>
          {ACTORS.map((a) => <button key={a} className="chip" aria-pressed={actor === a} onClick={() => setActor(actor === a ? '' : a)}>{ACTOR_LABELS[a]}</button>)}
        </div>
        <select className="select" style={{ flex: '0 1 200px' }} value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Objekttyp">
          <option value="">Alle Objekte</option><option value="node">Projekte & Module</option><option value="idea">Ideen</option><option value="application">Apps</option><option value="repository">Repositories</option>
        </select>
      </div>
      {list.error ? <ErrorState error={list.error} /> : list.isLoading ? <Skeleton h={400} r={16} /> : items.length === 0 ? <EmptyState icon={<Activity />} title="Keine Einträge" /> : (
        <div className="card">
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((a) => {
              const day = a.at.slice(0, 10);
              const header = day !== lastDay ? <li className="nav-label" style={{ padding: '14px 4px 6px' }} aria-hidden>{date(a.at)}</li> : null;
              lastDay = day;
              const link = a.entity_type && a.entity_id ? ENTITY_LINK[a.entity_type]?.(a.entity_id) : undefined;
              return (
                <li key={a.id} style={{ display: 'contents' }}>
                  {header}
                  <div className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className={`badge ${a.actor === 'claude' ? 'accent' : a.actor === 'github' ? 'ion' : a.actor === 'system' ? 'unknown' : 'outline'}`} style={{ minWidth: 64, justifyContent: 'center' }}>{ACTOR_LABELS[a.actor as Actor] ?? a.actor}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="small">{a.summary}</span>
                      <span className="subtle xsmall" style={{ display: 'block' }}>{a.action}{link && a.entity_name ? <> · <Link to={link}>{a.entity_name}</Link></> : null}</span>
                    </span>
                    <time className="meta" dateTime={a.at} title={dateTime(a.at)}>{relTime(a.at)}</time>
                  </div>
                </li>
              );
            })}
          </ol>
          {list.hasNextPage && <div style={{ textAlign: 'center', paddingTop: 12 }}><Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Ältere laden</Button></div>}
        </div>
      )}
    </div>
  );
}
