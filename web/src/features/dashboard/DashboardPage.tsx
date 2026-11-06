import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, AppWindow, ArrowDown, ArrowUp, ArrowRight, Boxes, GitMerge, HardDriveDownload, Lightbulb, Plus, RefreshCw,
  SlidersHorizontal, Sparkles, Star, Zap, Database, Bot, GitBranch,
} from 'lucide-react';
import { api } from '../../api/client';
import type { Dashboard, IdeaDto } from '../../api/types';
import { useSession, usePrefs } from '../../lib/session';
import { greeting, relTime, num } from '../../lib/format';
import { Button, Card, Dialog, EmptyState, ErrorState, Ring, Skeleton, Switch } from '../../components/ui';
import { HealthDot, HEALTH_LABELS, LifecycleBadge } from '../../components/ui/Status';
import { TileIcon, Icon } from '../../components/ui/Icon';
import { ACTOR_LABELS, type Actor, type Health } from '@shared/domain';

const WIDGETS: Record<string, string> = {
  welcome: 'Begrüßung & Schnellzugriffe', stats: 'Kennzahlen', attention: 'Aufmerksamkeit', recent: 'Zuletzt aktive Projekte', activity: 'Letzte Aktivitäten',
  sync: 'Synchronisierung', backup: 'Datensicherung', favorites: 'Favoriten', recommendations: 'Empfehlungen', ideas: 'Ideen-Impuls',
};

const healthColor = (h: Health) => (h === 'ok' ? 'var(--ok)' : h === 'attention' ? 'var(--warn)' : h === 'critical' ? 'var(--crit)' : 'var(--unknown)');

function Stat({ icon, label, value, sub, to }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; to: string }) {
  return (
    <Link to={to} className="card interactive glow">
      <div className="stat-icon">{icon}</div>
      <div className="stat">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </Link>
  );
}

function IntegrationRow({ icon, label, health, description, to }: { icon: ReactNode; label: string; health: Health; description: string; to: string }) {
  return (
    <Link to={to} className="list-item">
      <span className="kind-icon">{icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="row" style={{ gap: 8 }}><HealthDot health={health} /><strong className="small">{label}</strong></span>
        <span className="subtle xsmall clamp-2">{description}</span>
      </span>
      <span className="meta">{HEALTH_LABELS[health].split(' ')[0]}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const { auth } = useSession();
  const [prefs, setPrefs] = usePrefs();
  const [customize, setCustomize] = useState(false);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard'), refetchInterval: 60_000 });
  const ideas = useQuery({ queryKey: ['ideas', 'impulse'], queryFn: () => api.get<{ ideas: IdeaDto[] }>('/api/ideas/discover?mode=discover&limit=3'), staleTime: 5 * 60_000 });

  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const order = prefs.dashboardWidgets.filter((w) => WIDGETS[w] && !prefs.hiddenWidgets.includes(w));

  const widgets: Record<string, ReactNode> = {
    welcome: (
      <section className="card" style={{ background: 'linear-gradient(135deg, var(--accent-softer), transparent 60%), var(--surface-1)' }}>
        <div className="row-between">
          <div>
            <div className="subtle xsmall" style={{ letterSpacing: '.06em', textTransform: 'uppercase' }}>My Digital World</div>
            <h1 style={{ marginTop: 6 }}>{greeting()}, {auth?.user?.displayName?.split(' ')[0]}.</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {d ? <>{num(d.counts.projects)} Projekte · {num(d.counts.active)} in Entwicklung · {num(d.counts.appsAvailable)} nutzbare Apps · {num(d.ideas.total)} Ideen</> : <Skeleton h={16} w={320} />}
            </p>
          </div>
          <div className="page-actions">
            <Button variant="primary" onClick={() => nav('/projects?new=1')}><Plus /> Projekt</Button>
            <Button onClick={() => nav('/ideas?new=1')}><Lightbulb /> Idee</Button>
            <Button variant="ghost" onClick={() => setCustomize(true)} aria-label="Dashboard anpassen"><SlidersHorizontal /> <span className="hide-sm">Anpassen</span></Button>
          </div>
        </div>
      </section>
    ),
    stats: d ? (
      <div className="grid-4 stagger">
        <Stat to="/projects" icon={<Boxes />} label="Projekte" value={num(d.counts.projects)} sub={`${num(d.counts.planned)} geplant · ${num(d.counts.archived)} archiviert`} />
        <Stat to="/projects?status=in_development" icon={<Zap />} label="In Entwicklung" value={num(d.counts.active)} sub={`${num(d.counts.modules)} Module & Bausteine`} />
        <Stat to="/apps" icon={<AppWindow />} label="Nutzbare Apps" value={num(d.counts.appsAvailable)} sub={`von ${num(d.counts.apps)} erfassten Anwendungen`} />
        <Stat to="/ideas" icon={<Lightbulb />} label="Ideen" value={num(d.ideas.total)} sub={`${num(d.ideas.saved)} gespeichert · ${num(d.ideas.converted)} umgesetzt`} />
      </div>
    ) : <div className="grid-4"><Skeleton h={140} r={16} /><Skeleton h={140} r={16} /><Skeleton h={140} r={16} /><Skeleton h={140} r={16} /></div>,
    attention: d && (d.counts.openConflicts > 0 || d.quality.total > 0) ? (
      <Card title="Aufmerksamkeit erforderlich" icon={<AlertTriangle />} actions={<Link to="/conflicts" className="btn sm ghost">Alle <ArrowRight /></Link>}>
        <div className="list">
          {d.counts.openConflicts > 0 && (
            <Link to="/conflicts" className="list-item"><span className="dot attention" /><span><strong className="small">{d.counts.openConflicts} offene Konflikte</strong><span className="subtle xsmall" style={{ display: 'block' }}>Mehrdeutige Zuordnungen warten auf deine Entscheidung.</span></span><span className="meta"><GitMerge size={14} /></span></Link>
          )}
          {d.quality.top.map((i) => (
            <Link key={i.id} to={i.link} className="list-item"><span className={`dot ${i.severity === 'warning' ? 'attention' : 'unknown'}`} /><span style={{ minWidth: 0 }}><span className="small truncate" style={{ display: 'block' }}>{i.title}</span><span className="subtle xsmall">{i.detail}</span></span></Link>
          ))}
        </div>
        {d.quality.total > d.quality.top.length && <p className="subtle xsmall" style={{ marginTop: 8 }}>+ {d.quality.total - d.quality.top.length} weitere Datenqualitäts-Hinweise im Sync Center.</p>}
      </Card>
    ) : null,
    recent: (
      <Card title="Zuletzt aktive Projekte" icon={<Boxes />} actions={<Link to="/projects" className="btn sm ghost">Bibliothek <ArrowRight /></Link>}>
        {!d ? <Skeleton h={180} /> : d.recent.length === 0 ? (
          <EmptyState icon={<Boxes />} title="Noch keine Projekte" action={<Button variant="primary" onClick={() => nav('/projects?new=1')}><Plus /> Erstes Projekt</Button>}>
            Lege ein Projekt an, übernimm eine Idee aus dem Idea Hub oder lass Claude Projekte per MCP übermitteln.
          </EmptyState>
        ) : (
          <div className="list">
            {d.recent.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="list-item">
                <TileIcon name={p.icon} color={p.color} seed={p.id} size="sm" />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="row" style={{ gap: 8 }}><strong className="truncate">{p.name}</strong><LifecycleBadge status={p.status} /></span>
                  <span className="subtle xsmall truncate" style={{ display: 'block' }}>{p.summary ?? p.category ?? '—'} · {relTime(p.lastActivityAt)}</span>
                </span>
                <Ring value={p.health.score} size={40} color={healthColor(p.health.health)} label={`Projektgesundheit ${p.health.score} von 100`} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    ),
    activity: (
      <Card title="Letzte Aktivitäten" icon={<Activity />} actions={<Link to="/activity" className="btn sm ghost">Chronik <ArrowRight /></Link>}>
        {!d ? <Skeleton h={180} /> : (
          <ol className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {d.activity.slice(0, 8).map((a) => (
              <li key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span className={`badge ${a.actor === 'claude' ? 'accent' : a.actor === 'github' ? 'ion' : 'outline'}`} style={{ flex: 'none' }}>{ACTOR_LABELS[a.actor as Actor] ?? a.actor}</span>
                <span className="small clamp-2" style={{ flex: 1 }}>{a.summary}</span>
                <span className="meta">{relTime(a.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    ),
    sync: (
      <Card title="Synchronisierung" icon={<RefreshCw />} actions={<Link to="/sync" className="btn sm ghost">Sync Center <ArrowRight /></Link>}>
        {!d ? <Skeleton h={160} /> : (
          <div className="list">
            <IntegrationRow to="/settings?tab=integrations" icon={<Bot />} label={d.integrations.claude.label} health={d.integrations.claude.health} description={d.integrations.claude.description} />
            <IntegrationRow to="/sync?tab=repos" icon={<GitBranch />} label={d.integrations.github.label} health={d.integrations.github.health} description={d.integrations.github.description} />
            <IntegrationRow to="/settings?tab=integrations" icon={<Sparkles />} label={d.integrations.ai.label} health={d.integrations.ai.health} description={d.integrations.ai.description} />
            <IntegrationRow to="/backups" icon={<Database />} label={d.integrations.database.label} health={d.integrations.database.health} description={d.integrations.database.description} />
          </div>
        )}
      </Card>
    ),
    backup: (
      <Card title="Datensicherung" icon={<HardDriveDownload />} actions={<Link to="/backups" className="btn sm ghost">Backups <ArrowRight /></Link>}>
        {!d ? <Skeleton h={120} /> : (
          <div className="stack-sm">
            <div className="status-line"><HealthDot health={d.integrations.backup.health} /><div><strong className="small">{HEALTH_LABELS[d.integrations.backup.health]}</strong><p className="subtle xsmall">{d.integrations.backup.description}</p></div></div>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Letzte Sicherung</dt><dd>{d.integrations.backup.last ? relTime(d.integrations.backup.last.createdAt) : '–'}</dd>
              <dt>Nächste Prüfung</dt><dd>{d.integrations.backup.nextScheduledAt ? relTime(d.integrations.backup.nextScheduledAt) : `alle ${d.integrations.backup.intervalMinutes} Min.`}</dd>
              <dt>Sicherungspunkte</dt><dd>{d.integrations.backup.count}</dd>
            </dl>
          </div>
        )}
      </Card>
    ),
    favorites: (
      <Card title="Favoriten" icon={<Star />}>
        {!d ? <Skeleton h={100} /> : d.favorites.length === 0 ? <p className="subtle small">Markiere Projekte, Apps oder Ideen mit dem Stern, um sie hier zu sehen.</p> : (
          <div className="chips">{d.favorites.map((f) => <Link key={`${f.type}-${f.id}`} to={f.link} className="chip"><Star size={12} />{f.name}<span className="subtle">· {f.sub}</span></Link>)}</div>
        )}
      </Card>
    ),
    recommendations: d && d.recommendations.length ? (
      <Card title="Empfehlungen" icon={<Sparkles />}>
        <div className="grid-2">
          {d.recommendations.map((r) => (
            <Link key={r.id} to={r.link} className="card interactive" style={{ padding: 'var(--sp-4)', background: 'var(--surface-2)' }}>
              <strong className="small">{r.title}</strong>
              <p className="subtle xsmall" style={{ margin: '4px 0 10px' }}>{r.reason}</p>
              <span className="small" style={{ color: 'var(--accent)' }}>{r.action} →</span>
            </Link>
          ))}
        </div>
        <p className="subtle xsmall" style={{ marginTop: 10 }}>Regelbasiert aus deinen Daten abgeleitet – jede Empfehlung nennt ihren Grund.</p>
      </Card>
    ) : null,
    ideas: (
      <Card title="Ideen-Impuls" icon={<Lightbulb />} actions={<Link to="/ideas?mode=discover" className="btn sm ghost">Mehr entdecken <ArrowRight /></Link>}>
        {!ideas.data ? <Skeleton h={120} /> : (
          <div className="grid-3">
            {ideas.data.ideas.map((i) => (
              <Link key={i.id} to={`/ideas/${i.id}`} className="card interactive" style={{ padding: 'var(--sp-4)', background: 'var(--surface-2)' }}>
                <div className="row" style={{ marginBottom: 6 }}><Icon name={i.category?.icon} size={14} /><span className="subtle xsmall truncate">{i.category?.name}</span></div>
                <strong className="small">{i.title}</strong>
                <p className="subtle xsmall clamp-2" style={{ marginTop: 4 }}>{i.summary}</p>
              </Link>
            ))}
          </div>
        )}
        <p className="subtle xsmall" style={{ marginTop: 10 }}>Aus der lokalen, kuratierten Bibliothek – keine KI-Generierung.</p>
      </Card>
    ),
  };

  // two-column layout for widgets that pair well on desktop
  const pairs: [string, string][] = [['recent', 'activity'], ['sync', 'backup']];
  const rendered: ReactNode[] = [];
  const used = new Set<string>();
  for (const w of order) {
    if (used.has(w)) continue;
    const pair = pairs.find((p) => p.includes(w));
    const partner = pair?.find((x) => x !== w);
    if (pair && partner && order.includes(partner) && !used.has(partner)) {
      used.add(w); used.add(partner);
      rendered.push(<div key={w} className="grid-2">{widgets[w]}{widgets[partner]}</div>);
    } else {
      used.add(w);
      if (widgets[w]) rendered.push(<div key={w}>{widgets[w]}</div>);
    }
  }

  const move = (w: string, dir: -1 | 1) => {
    const list = [...prefs.dashboardWidgets];
    const i = list.indexOf(w);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPrefs({ dashboardWidgets: list });
  };

  return (
    <div className="stack">
      {rendered}
      <Dialog open={customize} onClose={() => setCustomize(false)} title="Dashboard anpassen" description="Wähle, welche Bereiche erscheinen und in welcher Reihenfolge." footer={<Button variant="primary" onClick={() => setCustomize(false)}>Fertig</Button>}>
        <div className="list">
          {prefs.dashboardWidgets.filter((w) => WIDGETS[w]).map((w, i, arr) => (
            <div key={w} className="list-item">
              <Switch checked={!prefs.hiddenWidgets.includes(w)} label={WIDGETS[w]} onChange={(on) => setPrefs({ hiddenWidgets: on ? prefs.hiddenWidgets.filter((x) => x !== w) : [...prefs.hiddenWidgets, w] })} />
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon disabled={i === 0} onClick={() => move(w, -1)} aria-label={`${WIDGETS[w]} nach oben`}><ArrowUp /></Button>
              <Button size="sm" variant="ghost" icon disabled={i === arr.length - 1} onClick={() => move(w, 1)} aria-label={`${WIDGETS[w]} nach unten`}><ArrowDown /></Button>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
