import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Lightbulb, Plus, Search, Sparkles, Star, Wand2, Zap, Shuffle, Gauge, Layers } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import type { Category, IdeaDto } from '../../api/types';
import { Button, Callout, Card, Dialog, EmptyState, ErrorState, Field, SkeletonCards, useToast } from '../../components/ui';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/layout/PageHeader';
import { CategorySelect, NodePicker, useCategories } from '../projects/shared';
import { EFFORT_LABELS, EFFORTS, IDEA_DISCOVERY_MODES, IDEA_STATUS_LABELS, type IdeaStatus } from '@shared/domain';

const PAGE = 36;

export function ScoreDots({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="row" style={{ gap: 4 }} title={`${label}: ${value ?? '–'} von 5 (Einschätzung)`} aria-label={`${label} ${value ?? 'unbewertet'} von 5`}>
      <span className="subtle xsmall">{label}</span>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 2, background: value && i <= value ? 'var(--accent)' : 'var(--surface-3)' }} />)}
    </span>
  );
}

export function IdeaCard({ idea, onFavorite }: { idea: IdeaDto; onFavorite?: (i: IdeaDto) => void }) {
  return (
    <article className="card interactive glow" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 22 }}>
      <span className="card-accent" style={{ background: idea.category?.color ?? 'var(--accent)' }} aria-hidden />
      <div className="row-between" style={{ flexWrap: 'nowrap' }}>
        <span className="row subtle xsmall" style={{ gap: 6, minWidth: 0 }}><Icon name={idea.category?.icon} size={14} /><span className="truncate">{idea.subcategoryName ?? idea.category?.name ?? 'Ohne Kategorie'}</span></span>
        {onFavorite && (
          <button className="btn ghost icon sm" aria-pressed={idea.favorite} aria-label={idea.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'} onClick={(e) => { e.preventDefault(); onFavorite(idea); }}>
            <Star fill={idea.favorite ? 'var(--warn)' : 'none'} color={idea.favorite ? 'var(--warn)' : 'currentColor'} size={16} />
          </button>
        )}
      </div>
      <Link to={`/ideas/${idea.id}`} style={{ color: 'inherit' }} className="stack-sm">
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>{idea.title}</h3>
        <p className="muted small clamp-3">{idea.summary}</p>
      </Link>
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        {idea.effort && <span className="badge outline">{EFFORT_LABELS[idea.effort as keyof typeof EFFORT_LABELS].split(' · ')[0]}</span>}
        {idea.complexity && <span className="badge outline">Komplexität {idea.complexity}/5</span>}
        {idea.status !== 'discovered' && <span className={`badge ${idea.status === 'converted' ? 'ok' : 'accent'}`}>{IDEA_STATUS_LABELS[idea.status as IdeaStatus]}</span>}
        {idea.source !== 'library' && <span className="badge ion">{idea.sourceLabel}</span>}
        {idea.parentIdeaId && <span className="badge warn">Weiterentwicklung</span>}
      </div>
      <div className="row" style={{ gap: 14 }}>
        <ScoreDots label="Nutzen" value={idea.scores.usefulness} />
        <ScoreDots label="Originalität" value={idea.scores.originality} />
      </div>
    </article>
  );
}

function NewIdeaDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Partial<{ title: string; summary: string; features: string[]; technologies: string[]; parentIdeaId: string }> }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ title: '', summary: '', description: '', problem: '', benefit: '', audience: '', categoryId: null as string | null, features: '', effort: '' });
  const [similar, setSimilar] = useState<{ id: string; title: string; score: number }[] | null>(null);
  useEffect(() => { if (open) { setF({ title: initial?.title ?? '', summary: initial?.summary ?? '', description: '', problem: '', benefit: '', audience: '', categoryId: null, features: (initial?.features ?? []).join('\n'), effort: '' }); setSimilar(null); } }, [open, initial]);
  const save = useMutation({
    mutationFn: (opts: { force?: boolean; parentIdeaId?: string }) => api.post<IdeaDto>('/api/ideas', {
      title: f.title, summary: f.summary || f.title, description: f.description || null, problem: f.problem || null, benefit: f.benefit || null, audience: f.audience || null,
      categoryId: f.categoryId, features: f.features.split('\n').map((x) => x.trim()).filter(Boolean), technologies: initial?.technologies, effort: f.effort || null,
      status: 'saved', force: opts.force, parentIdeaId: opts.parentIdeaId ?? initial?.parentIdeaId, variantNote: opts.parentIdeaId ? 'Als Weiterentwicklung erfasst' : undefined,
    }),
    onSuccess: (i) => { qc.invalidateQueries({ queryKey: ['ideas'] }); toast({ kind: 'success', title: 'Idee gespeichert' }); onClose(); nav(`/ideas/${i.id}`); },
    onError: (e: ApiError) => { if (e.status === 409) setSimilar((e.details as { similar: { id: string; title: string; score: number }[] }).similar); else toast({ kind: 'error', title: 'Nicht gespeichert', body: e.message }); },
  });
  const set = (k: keyof typeof f) => (v: string | null) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Dialog open={open} onClose={onClose} wide title="Neue Idee erfassen" description="Schnell festhalten – Details kannst du später ergänzen oder in Claude ausarbeiten."
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate({})}>Speichern</Button></>}>
      <div className="form-grid">
        <Field label="Titel" className="full">{(id) => <input id={id} className="input" value={f.title} onChange={(e) => set('title')(e.target.value)} data-autofocus />}</Field>
        <Field label="Kurzbeschreibung" className="full">{(id) => <input id={id} className="input" value={f.summary} onChange={(e) => set('summary')(e.target.value)} />}</Field>
        <Field label="Problemstellung">{(id) => <textarea id={id} className="textarea" rows={2} value={f.problem} onChange={(e) => set('problem')(e.target.value)} />}</Field>
        <Field label="Konkreter Nutzen">{(id) => <textarea id={id} className="textarea" rows={2} value={f.benefit} onChange={(e) => set('benefit')(e.target.value)} />}</Field>
        <Field label="Zielgruppe">{(id) => <input id={id} className="input" value={f.audience} onChange={(e) => set('audience')(e.target.value)} />}</Field>
        <Field label="Kategorie">{(id) => <CategorySelect id={id} value={f.categoryId} onChange={set('categoryId')} />}</Field>
        <Field label="Mögliche Funktionen" className="full" hint="Eine pro Zeile">{(id) => <textarea id={id} className="textarea" rows={3} value={f.features} onChange={(e) => set('features')(e.target.value)} />}</Field>
        <Field label="Geschätzter Aufwand">{(id) => <select id={id} className="select" value={f.effort} onChange={(e) => set('effort')(e.target.value)}><option value="">–</option>{EFFORTS.map((x) => <option key={x} value={x}>{EFFORT_LABELS[x]}</option>)}</select>}</Field>
      </div>
      {similar && (
        <div style={{ marginTop: 16 }}>
          <Callout kind="warn" title="Sehr ähnliche Idee vorhanden">
            {similar.map((s) => <div key={s.id}><Link to={`/ideas/${s.id}`} target="_blank">{s.title}</Link> <span className="subtle xsmall">({Math.round(s.score * 100)} % Ähnlichkeit)</span></div>)}
            <div className="row" style={{ marginTop: 10 }}>
              <Button size="sm" variant="primary" onClick={() => save.mutate({ parentIdeaId: similar[0].id })}>Als Weiterentwicklung speichern</Button>
              <Button size="sm" onClick={() => save.mutate({ force: true })}>Trotzdem separat speichern</Button>
            </div>
          </Callout>
        </div>
      )}
    </Dialog>
  );
}

interface DiscoverResult { engine: 'local-library' | 'claude-api'; mode: string; explanation?: string; ideas: IdeaDto[]; suggestions?: { ideaId: string; ideaTitle: string; suggestion: string }[]; combination?: { title: string; summary: string; features: string[]; technologies: string[]; sourceIdeaIds: string[]; note: string }; model?: string }

export default function IdeaHubPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useCategories();
  const stats = useQuery({ queryKey: ['ideas', 'stats'], queryFn: () => api.get<{ total: number; saved: number; favorites: number; converted: number; unseen: number; ai: { configured: boolean; model: string; note: string } }>('/api/ideas/stats') });
  const [mode, setMode] = useState(params.get('mode') ?? 'discover');
  const [modeInput, setModeInput] = useState({ category: '', q: '', projectId: '', projectName: '' });
  const [pickProject, setPickProject] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [combineDraft, setCombineDraft] = useState<DiscoverResult['combination'] | null>(null);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [dsearch, setDsearch] = useState(search);
  useEffect(() => { const t = setTimeout(() => setDsearch(search), 250); return () => clearTimeout(t); }, [search]);
  const category = params.get('category') ?? '';
  const effort = params.get('effort') ?? '';
  const favorite = params.get('favorite') === '1';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'score';
  const minUse = params.get('minUsefulness') ?? '';
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const filters = useMemo(() => ({ q: dsearch, category, effort, favorite: favorite ? '1' : undefined, status, sort, minUsefulness: minUse }), [dsearch, category, effort, favorite, status, sort, minUse]);
  const list = useInfiniteQuery({
    queryKey: ['ideas', 'list', filters],
    queryFn: ({ pageParam }) => api.get<{ total: number; items: IdeaDto[] }>(`/api/ideas${qs({ ...filters, limit: PAGE, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length * PAGE : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const fav = useMutation({ mutationFn: (i: IdeaDto) => api.patch(`/api/ideas/${i.id}`, { favorite: !i.favorite, ...(i.status === 'discovered' && !i.favorite ? { status: 'saved' } : {}) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ideas'] }) });

  const discoverM = useMutation({
    mutationFn: () => api.get<DiscoverResult>(`/api/ideas/discover${qs({ mode, category: modeInput.category, q: modeInput.q, projectId: modeInput.projectId, limit: 6, ideaIds: mode === 'combine' ? items.slice(0, 0).map((i) => i.id).join(',') : undefined })}`),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['ideas', 'stats'] }); },
    onError: (e: ApiError) => toast({ kind: 'warning', title: 'Entdecken nicht möglich', body: e.message }),
  });
  const generateM = useMutation({
    mutationFn: () => api.post<DiscoverResult>('/api/ideas/generate', { mode, category: modeInput.category || undefined, problem: modeInput.q || undefined, audience: mode === 'audience' ? modeInput.q : undefined, projectId: modeInput.projectId || undefined, count: 3 }),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['ideas'] }); toast({ kind: 'success', title: `${r.ideas.length} Ideen mit Claude generiert`, body: `Modell: ${r.model}` }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'KI-Generierung nicht verfügbar', body: e.message }),
  });
  useEffect(() => { if (params.get('mode') === 'discover' && !result) discoverM.mutate(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modeDef = IDEA_DISCOVERY_MODES.find((m) => m.id === mode)!;
  const needsCategory = mode === 'category';
  const needsText = mode === 'problem' || mode === 'audience';
  const needsProject = mode === 'extend-project';
  const canRun = (!needsCategory || modeInput.category) && (!needsText || modeInput.q.trim()) && (!needsProject || modeInput.projectId);
  const ai = stats.data?.ai;
  const catList: Category[] = cats.data ?? [];

  return (
    <div>
      <PageHeader eyebrow={<><Lightbulb size={14} /> AI Idea Hub</>} title="Ideen- und Innovationsbibliothek"
        lead={<>{stats.data ? `${stats.data.total} Ideen in ${catList.length} Kategorien · ${stats.data.saved} gespeichert · ${stats.data.converted} als Projekt übernommen.` : '…'} Fakten, Einschätzungen und Spekulation sind gekennzeichnet.</>}
        actions={<Button variant="primary" onClick={() => setParam('new', '1')}><Plus /> Idee erfassen</Button>} />

      <Card className="" title="Ideen entdecken" icon={<Wand2 />} actions={
        <span className={`badge ${ai?.configured ? 'ok' : 'unknown'}`} title={ai?.note}>{ai?.configured ? <><Sparkles /> Claude API verbunden</> : 'KI nicht eingerichtet · lokale Bibliothek'}</span>
      }>
        <div className="chips" role="group" aria-label="Entdeckungsmodus">
          {IDEA_DISCOVERY_MODES.map((m) => <button key={m.id} className="chip" aria-pressed={mode === m.id} onClick={() => { setMode(m.id); setResult(null); }} title={m.description}>{m.label}</button>)}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 10, alignItems: 'flex-end' }}>
          {needsCategory && <div style={{ minWidth: 240 }}><CategorySelect value={modeInput.category || null} onChange={(v) => setModeInput((s) => ({ ...s, category: v ?? '' }))} label="Kategorie wählen" /></div>}
          {needsText && <input className="input" style={{ flex: '1 1 280px' }} value={modeInput.q} onChange={(e) => setModeInput((s) => ({ ...s, q: e.target.value }))} placeholder={mode === 'problem' ? 'Beschreibe das Problem, z. B. „Rechnungen gehen unter“' : 'Zielgruppe, z. B. „Familien“'} aria-label="Eingabe für den Modus" />}
          {needsProject && <Button onClick={() => setPickProject(true)}>{modeInput.projectName || 'Projekt wählen'}</Button>}
          <Button variant="primary" onClick={() => discoverM.mutate()} disabled={!canRun} loading={discoverM.isPending}><Shuffle /> Aus Bibliothek</Button>
          <Button onClick={() => generateM.mutate()} disabled={!ai?.configured || !canRun || mode === 'combine' || mode === 'improve'} loading={generateM.isPending} title={ai?.configured ? 'Neue Ideen mit der Claude API generieren' : ai?.note}><Sparkles /> Mit Claude generieren</Button>
        </div>
        <p className="subtle xsmall" style={{ marginTop: 10 }}>{modeDef.description}{!ai?.configured && ' · Für echte KI-Generierung ANTHROPIC_API_KEY auf dem Server setzen – ohne Schlüssel wird nichts vorgetäuscht.'}</p>
        {result && (
          <div style={{ marginTop: 18 }} className="stack">
            <div className="row-between">
              <span className="small muted">{result.engine === 'claude-api' ? <><Sparkles size={14} /> Generiert mit {result.model}</> : <>Lokale Bibliothek · {result.explanation}</>}</span>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Ausblenden</Button>
            </div>
            {result.combination && (
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <span className="badge accent"><Layers /> Kombinationsvorschlag (regelbasiert)</span>
                <h3 style={{ marginTop: 8 }}>{result.combination.title}</h3>
                <p className="muted small" style={{ marginTop: 6 }}>{result.combination.summary}</p>
                <ul className="small muted">{result.combination.features.map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="subtle xsmall">{result.combination.note}</p>
                <Button size="sm" variant="primary" style={{ marginTop: 8 }} onClick={() => setCombineDraft(result.combination!)}><Bookmark /> Als Idee speichern</Button>
              </div>
            )}
            {result.suggestions && (result.suggestions.length ? (
              <div className="list">{result.suggestions.map((s, i) => <Link key={i} to={`/ideas/${s.ideaId}`} className="list-item"><Zap size={15} /><span className="small" style={{ flex: 1 }}>{s.suggestion}</span><span className="meta">{s.ideaTitle}</span></Link>)}</div>
            ) : <p className="subtle small">Speichere oder favorisiere Ideen, um hier Erweiterungsvorschläge zu sehen.</p>)}
            {result.ideas.length > 0 && <div className="grid-cards">{result.ideas.map((i) => <IdeaCard key={i.id} idea={i} onFavorite={(x) => fav.mutate(x)} />)}</div>}
            {result.ideas.length === 0 && !result.combination && !result.suggestions && <p className="subtle small">Keine passenden Ideen gefunden.</p>}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 24, marginTop: 24 }} className="idea-browser">
        <nav aria-label="Kategorien" className="card desktop-only" style={{ padding: 8, alignSelf: 'start', position: 'sticky', top: 76, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' }}>
          <button className="list-item" style={{ fontWeight: !category ? 600 : 400 }} aria-current={!category ? 'page' : undefined} onClick={() => setParam('category', null)}><Lightbulb size={16} /> Alle Kategorien</button>
          {catList.map((c) => (
            <button key={c.id} className="list-item" aria-current={category === c.id ? 'page' : undefined} style={{ fontWeight: category === c.id ? 600 : 400, background: category === c.id ? 'var(--accent-soft)' : undefined }} onClick={() => setParam('category', c.id)}>
              <Icon name={c.icon} size={15} /><span className="truncate small" style={{ flex: 1 }}>{c.name}</span><span className="meta">{c.idea_count}</span>
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, marginBottom: 14 }}>
            <div className="input-icon" style={{ flex: '1 1 240px' }}><Search /><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Volltextsuche in Ideen …" aria-label="Ideen durchsuchen" /></div>
            <div className="mobile-only" style={{ flex: '1 1 200px' }}><CategorySelect value={category || null} onChange={(v) => setParam('category', v)} label="Alle Kategorien" /></div>
            <select className="select" style={{ flex: '0 1 190px' }} value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sortierung">
              <option value="score">Gesamtbewertung</option><option value="usefulness">Nutzen</option><option value="originality">Originalität</option><option value="feasibility">Umsetzbarkeit</option><option value="effort">Aufwand (klein zuerst)</option><option value="recent">Kürzlich hinzugefügt</option><option value="title">Titel</option>
            </select>
          </div>
          <div className="chips" style={{ marginBottom: 16 }}>
            {EFFORTS.map((e) => <button key={e} className="chip" aria-pressed={effort === e} onClick={() => setParam('effort', effort === e ? null : e)}><Gauge />{EFFORT_LABELS[e].split(' · ')[0]}</button>)}
            <button className="chip" aria-pressed={minUse === '5'} onClick={() => setParam('minUsefulness', minUse === '5' ? null : '5')}>Höchster Nutzen</button>
            <button className="chip" aria-pressed={favorite} onClick={() => setParam('favorite', favorite ? null : '1')}><Star />Favoriten</button>
            <button className="chip" aria-pressed={status === 'saved,evaluating'} onClick={() => setParam('status', status ? null : 'saved,evaluating')}><Bookmark />Gespeichert</button>
            <button className="chip" aria-pressed={status === 'converted'} onClick={() => setParam('status', status === 'converted' ? null : 'converted')}>Umgesetzt</button>
          </div>
          {list.error ? <ErrorState error={list.error} /> : list.isLoading ? <SkeletonCards /> : items.length === 0 ? <EmptyState icon={<Lightbulb />} title="Keine Ideen gefunden">Filter anpassen oder eine eigene Idee erfassen.</EmptyState> : (
            <>
              <p className="subtle small" style={{ marginBottom: 10 }} aria-live="polite">{list.data?.pages[0].total} Ideen</p>
              <div className="grid-cards">{items.map((i) => <IdeaCard key={i.id} idea={i} onFavorite={(x) => fav.mutate(x)} />)}</div>
              {list.hasNextPage && <div style={{ textAlign: 'center', marginTop: 20 }}><Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Weitere laden</Button></div>}
            </>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .idea-browser { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>

      <NewIdeaDialog open={params.get('new') === '1' || Boolean(combineDraft)} onClose={() => { setParam('new', null); setCombineDraft(null); }} initial={combineDraft ? { title: combineDraft.title, summary: combineDraft.summary, features: combineDraft.features, technologies: combineDraft.technologies } : undefined} />
      <Dialog open={pickProject} onClose={() => setPickProject(false)} title="Projekt wählen"><NodePicker onPick={(n) => { if (n) setModeInput((s) => ({ ...s, projectId: n.id, projectName: n.name })); setPickProject(false); }} /></Dialog>
    </div>
  );
}
