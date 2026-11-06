import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, BookOpen, ExternalLink, Search, TriangleAlert, Clock } from 'lucide-react';
import { api, qs } from '../../api/client';
import { date } from '../../lib/format';
import { Button, Callout, EmptyState, ErrorState, Skeleton, useToast } from '../../components/ui';
import { Markdown } from '../../components/ui/Markdown';
import { PageHeader } from '../../components/layout/PageHeader';

interface Article { id: string; slug: string; title: string; topic: string; difficulty: string; summary: string; body: string; sources: { title: string; url: string }[]; verification: string; verifiedAt: string | null; origin: string; updatedAt: string; stale: boolean }

const TOPICS: Record<string, string> = { 'claude-code': 'Claude Code', mcp: 'MCP', api: 'Claude API', prompting: 'Prompt-Techniken', workflows: 'Workflows', 'claude-apps': 'Claude Apps' };

function VerificationBadge({ a }: { a: Article }) {
  if (a.verification === 'outdated') return <span className="badge crit"><TriangleAlert />Veraltet</span>;
  if (a.verification !== 'verified') return <span className="badge warn"><TriangleAlert />Ungeprüft</span>;
  if (a.stale) return <span className="badge warn"><Clock />Erneut prüfen ({date(a.verifiedAt)})</span>;
  return <span className="badge ok"><BadgeCheck />Geprüft {date(a.verifiedAt)}</span>;
}

function ArticleView({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const a = useQuery({ queryKey: ['knowledge', slug], queryFn: () => api.get<Article>(`/api/knowledge/${slug}`) });
  const verify = useMutation({ mutationFn: (state: string) => api.post(`/api/knowledge/${slug}/verification`, { state }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); toast({ kind: 'success', title: 'Prüfstatus aktualisiert' }); } });
  if (a.error) return <ErrorState error={a.error} />;
  if (!a.data) return <Skeleton h={400} r={16} />;
  const art = a.data;
  return (
    <article>
      <nav className="breadcrumbs"><Link to="/knowledge">Claude Knowledge Hub</Link><span>›</span><span>{TOPICS[art.topic] ?? art.topic}</span></nav>
      <header className="page-header"><div><h1>{art.title}</h1><p className="lead muted" style={{ marginTop: 8 }}>{art.summary}</p><div className="row" style={{ marginTop: 12 }}><VerificationBadge a={art} /><span className="badge outline">{art.difficulty}</span></div></div></header>
      <div className="split">
        <div className="card"><Markdown>{art.body}</Markdown></div>
        <div className="stack">
          <div className="card stack-sm">
            <h2 className="card-title">Offizielle Quellen</h2>
            {art.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="small">{s.title} <ExternalLink size={12} /></a>)}
            <p className="subtle xsmall">Funktionen ändern sich. Prüfe aktualitätsabhängige Details in der offiziellen Dokumentation.</p>
          </div>
          <div className="card stack-sm">
            <h2 className="card-title">Prüfstatus pflegen</h2>
            <Button size="sm" onClick={() => verify.mutate('verified')}><BadgeCheck /> Heute gegen die Doku geprüft</Button>
            <Button size="sm" variant="ghost" onClick={() => verify.mutate('outdated')}><TriangleAlert /> Als veraltet markieren</Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function KnowledgePage() {
  const { slug } = useParams();
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['knowledge', 'list', topic, q], queryFn: () => api.get<Article[]>(`/api/knowledge${qs({ topic, q })}`), enabled: !slug });
  if (slug) return <ArticleView slug={slug} />;
  return (
    <div>
      <PageHeader eyebrow={<><BookOpen size={14} /> Claude Knowledge Hub</>} title="Claude-Wissen & Workflows" lead="Kompaktes Wissen zu Claude Code, MCP, Claude API und Prompt-Techniken – mit Quellen und Prüfdatum. Veraltete oder ungeprüfte Inhalte sind gekennzeichnet." />
      <Callout>Diese Inhalte wurden gegen offizielle Dokumentationen geprüft (Datum je Artikel). Nach 120 Tagen wird eine erneute Prüfung empfohlen.</Callout>
      <div className="row" style={{ margin: '20px 0', gap: 10 }}>
        <div className="input-icon" style={{ flex: '1 1 240px' }}><Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Wissen durchsuchen …" aria-label="Wissen durchsuchen" /></div>
        <div className="chips">
          <button className="chip" aria-pressed={!topic} onClick={() => setTopic('')}>Alle</button>
          {Object.entries(TOPICS).map(([k, v]) => <button key={k} className="chip" aria-pressed={topic === k} onClick={() => setTopic(topic === k ? '' : k)}>{v}</button>)}
        </div>
      </div>
      {list.error ? <ErrorState error={list.error} /> : !list.data ? <Skeleton h={300} r={16} /> : list.data.length === 0 ? <EmptyState icon={<BookOpen />} title="Keine Artikel gefunden" /> : (
        <div className="grid-cards stagger">
          {list.data.map((a) => (
            <Link key={a.id} to={`/knowledge/${a.slug}`} className="card interactive glow stack-sm">
              <div className="row-between"><span className="badge accent">{TOPICS[a.topic] ?? a.topic}</span><VerificationBadge a={a} /></div>
              <h3>{a.title}</h3>
              <p className="muted small clamp-3">{a.summary}</p>
              <span className="subtle xsmall">{a.difficulty} · {a.sources.length} Quelle(n)</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
