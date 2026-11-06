import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, useReactFlow, MarkerType, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphlib, layout } from '@dagrejs/dagre';
import { ArrowRight, Bot, ChevronDown, ChevronRight, Eye, File, FlaskConical, Folder, FolderGit2, GitCommitHorizontal, Lock, Maximize, Minimize, Package, RefreshCw, ScanSearch, Search, Send, Sparkles } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import { usePrefs } from '../../lib/session';
import { relTime, num } from '../../lib/format';
import { Button, Callout, Card, Dialog, ErrorState, Segmented, Skeleton, Switch, Tabs, useToast } from '../../components/ui';
import { HealthDot } from '../../components/ui/Status';
import { RobotBubble, RobotFigure } from './Robot';
import { CodeViewer } from './CodeViewer';
import './code-explorer.css';

interface GNode { path: string; name: string; type: 'folder' | 'file' | 'submodule'; size: number | null; childCount: number; language: string | null; lines: number | null; role: string | null; protected: boolean; parent: string; expanded: boolean }
interface Graph { repo: { id: string; fullName: string; headSha: string | null }; nodes: GNode[]; edges: { from: string; to: string; count: number; basis: string }[]; analysis: { status: string; commit_sha: string; finished_at: string | null; stats: Record<string, unknown>; error: string | null } | null }
interface Simple { metaphor: string; text: string }
interface PathDetail {
  path: string; type: 'file' | 'folder'; name: string; role: string; roleLabel: string; roleBasis: string; simple: Simple; lines?: number | null; size?: number | null; files?: number;
  language?: string | null; imports?: string[]; externalImports?: string[]; exports?: string[]; importedBy?: string[]; analyzed?: boolean; excludedReason?: string | null; protected?: boolean;
  dependsOn?: { path: string; count: number }[]; usedBy?: { path: string; count: number }[]; externalPackages?: { name: string; count: number }[];
}
interface Architecture { repo: { fullName: string; languages: Record<string, number> }; roles: { role: string; label: string; files: number; lines: number; simple: Simple | null }[]; topFolders: { path: string; role: string; label: string; simple: Simple; basis: string }[]; dependencies: { production: number; development: number }; mostUsed: { path: string; importedBy: number }[]; analysis: Graph['analysis'] }
interface Overview { repo: { id: string; fullName: string; description: string | null; status: string; statusDetail: string | null; htmlUrl: string | null; defaultBranch: string | null; trackedBranch: string | null; branch: string | null; headSha: string | null; lastSyncedAt: string | null; primaryLanguage: string | null; private: boolean; fileCount: number | null; treeTruncated: boolean }; links: { node_id: string; name: string; status: string }[]; branches: { name: string }[]; commits: { sha: string; message: string; author_name: string | null; committed_at: string | null; html_url: string }[]; dependencies: { name: string; version_spec: string | null; dev: number; ecosystem: string; manifest_path: string }[]; analysis: Graph['analysis'] }

const ROLE_COLORS: Record<string, string> = { frontend: '#6aa7ff', backend: '#8d95ff', api: '#4fd4c8', database: '#f2b84b', shared: '#e57399', tests: '#5cc98f', config: '#9aa3b8', docs: '#c792ea', scripts: '#ff9d5c', assets: '#f07aa8', other: '#7c8396' };
const ROLE_LABELS: Record<string, string> = { frontend: 'Frontend', backend: 'Backend', api: 'API', database: 'Datenbank', shared: 'Gemeinsam', tests: 'Tests', config: 'Konfiguration', docs: 'Doku', scripts: 'Skripte', assets: 'Assets', other: 'Sonstiges' };
const NODE_W = 210;
const NODE_H = 70;

type CxData = { g: GNode; dim: boolean; selected: boolean; tour: boolean; onToggle: (p: string) => void; isRoot?: boolean };

const CxNode = memo(function CxNode({ data }: NodeProps<Node<CxData>>) {
  const { g, dim, selected, tour, onToggle, isRoot } = data;
  const color = ROLE_COLORS[g.role ?? 'other'] ?? ROLE_COLORS.other;
  const Ico = isRoot ? FolderGit2 : g.type === 'folder' ? Folder : g.protected ? Lock : g.role === 'tests' ? FlaskConical : File;
  return (
    <div className={`cx-node ${isRoot ? 'root' : ''} ${dim ? 'dim' : ''} ${selected ? 'selected' : ''} ${tour ? 'tour' : ''} ${g.protected ? 'protected' : ''}`} title={g.path || 'Repository'}>
      <Handle type="target" position={Position.Left} />
      <div className="cx-head">
        <span className="cx-ico" style={{ background: color }}><Ico aria-hidden /></span>
        <span className="cx-name">{g.name}</span>
        {g.type === 'folder' && g.childCount > 0 && !isRoot && (
          <button className="cx-toggle nodrag" onClick={(e) => { e.stopPropagation(); onToggle(g.path); }} aria-label={g.expanded ? `${g.name} zuklappen` : `${g.name} aufklappen`} aria-expanded={g.expanded}>
            {g.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>
      <div className="cx-meta">
        {g.role && <span className="cx-role" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}>{ROLE_LABELS[g.role] ?? g.role}</span>}
        {g.type === 'folder' ? <span>{g.childCount} Einträge</span> : g.lines ? <span>{num(g.lines)} Zeilen</span> : g.language ? <span>{g.language}</span> : null}
        {g.protected && <span>geschützt</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { cx: CxNode };

function useLayout(graph: Graph | undefined, opts: { showDeps: boolean; selected: string | null; tourPath: string | null; toggle: (p: string) => void; filter: string }) {
  return useMemo(() => {
    if (!graph) return { nodes: [] as Node<CxData>[], edges: [] as Edge[] };
    const g = new graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const rootId = '__root__';
    g.setNode(rootId, { width: NODE_W, height: NODE_H });
    for (const n of graph.nodes) g.setNode(n.path, { width: NODE_W, height: NODE_H });
    for (const n of graph.nodes) g.setEdge(n.parent || rootId, n.path);
    layout(g);
    const related = new Set<string>();
    if (opts.selected) {
      related.add(opts.selected);
      for (const e of graph.edges) {
        if (e.from === opts.selected) related.add(e.to);
        if (e.to === opts.selected) related.add(e.from);
      }
      for (const n of graph.nodes) if (n.parent === opts.selected || n.path === graph.nodes.find((x) => x.path === opts.selected)?.parent) related.add(n.path);
    }
    const f = opts.filter.trim().toLowerCase();
    const nodes: Node<CxData>[] = [
      { id: rootId, type: 'cx', position: { x: g.node(rootId).x - NODE_W / 2, y: g.node(rootId).y - NODE_H / 2 }, data: { g: { path: '', name: graph.repo.fullName, type: 'folder', size: null, childCount: graph.nodes.filter((n) => !n.parent).length, language: null, lines: null, role: null, protected: false, parent: '', expanded: true }, dim: false, selected: opts.selected === '', tour: opts.tourPath === '', onToggle: opts.toggle, isRoot: true } },
      ...graph.nodes.map((n) => {
        const pos = g.node(n.path);
        const dimBySel = opts.selected !== null && opts.selected !== '' && !related.has(n.path);
        const dimByFilter = Boolean(f) && !n.path.toLowerCase().includes(f);
        return { id: n.path, type: 'cx', position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, data: { g: n, dim: dimBySel || dimByFilter, selected: opts.selected === n.path, tour: opts.tourPath === n.path, onToggle: opts.toggle } } as Node<CxData>;
      }),
    ];
    const edges: Edge[] = graph.nodes.map((n) => ({ id: `h:${n.path}`, source: n.parent || rootId, target: n.path, type: 'smoothstep', style: { stroke: 'var(--border-strong)', strokeWidth: 1.4 }, focusable: false }));
    if (opts.showDeps) {
      const ids = new Set(graph.nodes.map((n) => n.path));
      for (const e of graph.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue;
        const active = opts.selected === null || e.from === opts.selected || e.to === opts.selected;
        edges.push({
          id: `d:${e.from}->${e.to}`, source: e.from, target: e.to, animated: active && opts.selected !== null, label: e.count > 1 ? String(e.count) : undefined,
          style: { stroke: 'var(--accent)', strokeDasharray: '5 4', strokeWidth: Math.min(1.2 + Math.log2(e.count + 1), 4), opacity: active ? 0.95 : 0.15 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)', width: 14, height: 14 }, zIndex: 1,
        });
      }
    }
    return { nodes, edges };
  }, [graph, opts.showDeps, opts.selected, opts.tourPath, opts.toggle, opts.filter]);
}

function DetailPanel({ repoId, path, level, onOpenFile, onSelect }: { repoId: string; path: string | null; level: 'simple' | 'technical'; onOpenFile: (p: string) => void; onSelect: (p: string) => void }) {
  const d = useQuery({ queryKey: ['repo', repoId, 'path', path], queryFn: () => api.get<PathDetail>(`/api/repos/${repoId}/path${qs({ path: path ?? '' })}`), enabled: path !== null });
  if (path === null) return <Card title="Details"><p className="subtle small">Wähle einen Baustein im Graphen. Ordner lassen sich über den Pfeil aufklappen.</p></Card>;
  if (d.error) return <ErrorState error={d.error} />;
  if (!d.data) return <Skeleton h={260} r={16} />;
  const p = d.data;
  const PathLink = ({ to, count }: { to: string; count?: number }) => <button className="list-item small" onClick={() => onSelect(to)} style={{ padding: '6px 4px' }}><span className="mono truncate" style={{ flex: 1, fontSize: 12 }}>{to}</span>{count ? <span className="meta">{count}×</span> : null}</button>;
  return (
    <Card title={p.path ? p.name : 'Repository'} icon={p.type === 'folder' ? <Folder /> : <File />}>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span className="badge" style={{ background: `color-mix(in srgb, ${ROLE_COLORS[p.role] ?? '#888'} 20%, transparent)`, color: ROLE_COLORS[p.role] }}>{p.roleLabel}</span>
        <span className="badge warn" title="Die Rolle ist aus Pfad und Dateityp abgeleitet – nicht verifiziert.">Rolle vermutet</span>
        {p.protected && <span className="badge crit"><Lock /> geschützt</span>}
      </div>
      {p.path && <p className="mono subtle xsmall" style={{ marginBottom: 10, overflowWrap: 'anywhere' }}>{p.path}</p>}
      {level === 'simple' ? (
        <div className="stack-sm">
          <p className="small"><strong>{p.simple.metaphor}.</strong> {p.simple.text}</p>
          {p.type === 'file' && p.importedBy && p.importedBy.length > 0 && <p className="small muted">{p.importedBy.length} andere Datei(en) nutzen diesen Baustein.</p>}
          {p.type === 'folder' && <p className="small muted">Enthält {num(p.files)} analysierte Dateien mit {num(p.lines as number)} Zeilen.</p>}
        </div>
      ) : (
        <div className="stack-sm">
          <dl className="kv">
            {p.type === 'file' ? <><dt>Sprache</dt><dd>{p.language ?? '–'}</dd><dt>Zeilen</dt><dd>{num(p.lines ?? null)}</dd><dt>Größe</dt><dd>{p.size ? `${num(p.size)} B` : '–'}</dd><dt>Analyse</dt><dd>{p.analyzed ? 'statisch analysiert' : p.excludedReason ? `ausgeschlossen (${p.excludedReason})` : 'nicht analysiert'}</dd></>
              : <><dt>Dateien</dt><dd>{num(p.files)}</dd><dt>Zeilen</dt><dd>{num(p.lines ?? null)}</dd></>}
          </dl>
          {p.exports && p.exports.length > 0 && <><h3 className="label">Exporte (erkannt)</h3><div className="chips">{p.exports.map((e) => <code key={e} className="badge outline">{e}</code>)}</div></>}
          {p.imports && p.imports.length > 0 && <><h3 className="label">Importiert intern (erkannt)</h3><div className="list">{p.imports.map((i) => <PathLink key={i} to={i} />)}</div></>}
          {p.importedBy && p.importedBy.length > 0 && <><h3 className="label">Wird genutzt von (erkannt)</h3><div className="list">{p.importedBy.map((i) => <PathLink key={i} to={i} />)}</div></>}
          {p.dependsOn && p.dependsOn.length > 0 && <><h3 className="label">Abhängig von (erkannt)</h3><div className="list">{p.dependsOn.map((i) => <PathLink key={i.path} to={i.path} count={i.count} />)}</div></>}
          {p.usedBy && p.usedBy.length > 0 && <><h3 className="label">Genutzt von (erkannt)</h3><div className="list">{p.usedBy.map((i) => <PathLink key={i.path} to={i.path} count={i.count} />)}</div></>}
          {(p.externalImports?.length || p.externalPackages?.length) ? <><h3 className="label">Externe Pakete</h3><div className="chips">{(p.externalImports ?? []).map((e) => <span key={e} className="badge ion"><Package />{e}</span>)}{(p.externalPackages ?? []).map((e) => <span key={e.name} className="badge ion"><Package />{e.name} · {e.count}</span>)}</div></> : null}
        </div>
      )}
      {p.type === 'file' && !p.protected && <Button style={{ marginTop: 14 }} onClick={() => onOpenFile(p.path)}><Eye /> Quelltext ansehen (nur lesend)</Button>}
      {p.protected && <div style={{ marginTop: 12 }}><Callout kind="warn">Diese Datei kann Zugangsdaten enthalten und wird nie angezeigt.</Callout></div>}
    </Card>
  );
}

function ExplorerCanvas({ repoId, overview }: { repoId: string; overview: Overview }) {
  const [prefs, setPrefs] = usePrefs();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const rf = useReactFlow();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showDeps, setShowDeps] = useState(true);
  const [showTests, setShowTests] = useState(false);
  const [rootFiles, setRootFiles] = useState(false);
  const centerRef = useRef<string | null>(null);
  const [filter, setFilter] = useState('');
  const [fileView, setFileView] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [robotOpen, setRobotOpen] = useState(prefs.robotEnabled);
  const [question, setQuestion] = useState('');
  const level = prefs.explainLevel;

  const graph = useQuery({ queryKey: ['repo', repoId, 'graph', expanded, showTests], queryFn: () => api.get<Graph>(`/api/repos/${repoId}/graph${qs({ expanded: expanded.join(','), tests: showTests ? '1' : undefined })}`), placeholderData: (p) => p });
  const arch = useQuery({ queryKey: ['repo', repoId, 'arch'], queryFn: () => api.get<Architecture>(`/api/repos/${repoId}/architecture`) });
  const file = useQuery({ queryKey: ['repo', repoId, 'file', fileView], queryFn: () => api.get<{ text: string; language: string | null; redactions: number; path: string }>(`/api/repos/${repoId}/file${qs({ path: fileView })}`), enabled: Boolean(fileView), retry: false });
  const ask = useMutation({ mutationFn: () => api.post<{ answer: string; model: string }>(`/api/repos/${repoId}/ask`, { path: selected ?? '', question }), onError: (e: ApiError) => toast({ kind: 'warning', title: 'Frage nicht möglich', body: e.message }) });
  const aiStatus = useQuery({ queryKey: ['ideas', 'stats'], queryFn: () => api.get<{ ai: { configured: boolean; note: string } }>('/api/ideas/stats'), staleTime: 60_000 });

  const toggle = useCallback((p: string) => setExpanded((e) => (e.includes(p) ? e.filter((x) => x !== p && !x.startsWith(p + '/')) : [...e, p])), []);
  const tour = arch.data?.topFolders ?? [];
  const tourPath = tourStep !== null ? (tourStep === 0 ? '' : tour[tourStep - 1]?.path ?? null) : null;
  const visibleGraph = useMemo(() => (graph.data && !rootFiles ? { ...graph.data, nodes: graph.data.nodes.filter((n) => n.parent !== '' || n.type !== 'file' || n.path === selected) } : graph.data), [graph.data, rootFiles, selected]);
  const { nodes, edges } = useLayout(visibleGraph, { showDeps, selected, tourPath, toggle, filter });

  useEffect(() => { const t = setTimeout(() => { if (!centerRef.current) rf.fitView({ padding: 0.15, duration: 400, maxZoom: 1.1 }); }, 60); return () => clearTimeout(t); }, [visibleGraph?.nodes.length, rf]);
  useEffect(() => { if (tourPath !== null) { setSelected(tourPath); const n = rf.getNode(tourPath || '__root__'); if (n) rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1.1, duration: 500 }); } }, [tourPath, rf]);
  // deep link ?path= from global search: expand ancestors and select
  useEffect(() => {
    const p = params.get('path');
    if (!p) return;
    const parts = p.split('/');
    setExpanded((e) => [...new Set([...e, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))])]);
    setSelected(p);
    if (!/\/$/.test(p) && p.includes('.')) setFileView(null);
    params.delete('path');
    setParams(params, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  centerRef.current = pendingCenter;
  const reveal = (p: string) => {
    const parts = p.split('/');
    setExpanded((e) => [...new Set([...e, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))])]);
    setSelected(p);
    setPendingCenter(p);
  };
  useEffect(() => {
    if (!pendingCenter) return;
    const n = rf.getNode(pendingCenter);
    if (!n) return;
    const t = setTimeout(() => { rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1.1, duration: 450 }); setPendingCenter(null); }, 120);
    return () => clearTimeout(t);
  }, [pendingCenter, nodes, rf]);
  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = filter.trim();
    if (!term) return;
    const visible = graph.data?.nodes.find((n) => n.path.toLowerCase() === term.toLowerCase()) ?? graph.data?.nodes.find((n) => n.path.toLowerCase().includes(term.toLowerCase()));
    if (visible) { reveal(visible.path); return; }
    const hits = await api.get<{ path: string; type: string }[]>(`/api/repos/${repoId}/find${qs({ q: term })}`).catch(() => []);
    if (!hits.length) { toast({ kind: 'info', title: 'Nichts gefunden', body: `Kein Pfad enthält „${term}“.` }); return; }
    reveal(hits[0].path);
    setFilter('');
  };

  const step = tourStep !== null && tourStep > 0 ? tour[tourStep - 1] : null;
  const a = graph.data?.analysis;

  const robot = robotOpen ? (
    <div className="card robot">
      <RobotFigure talking={tourStep !== null || ask.isPending} onClick={() => setRobotOpen(false)} />
      {tourStep === null ? (
        <RobotBubble title={<><Bot size={14} /> OMI</>} onClose={() => { setRobotOpen(false); setPrefs({ robotEnabled: false }); }}
          actions={<>
            <Button size="sm" variant="primary" onClick={() => setTourStep(0)} disabled={!tour.length}>Zeig es mir</Button>
            {selected !== null && <Button size="sm" onClick={() => setPrefs({ explainLevel: level === 'simple' ? 'technical' : 'simple' })}>{level === 'simple' ? 'Technisch erklären' : 'Einfach erklären'}</Button>}
          </>}>
          {selected !== null && selected !== '' ? <>Du schaust dir <code>{selected.split('/').pop()}</code> an. Unten erkläre ich, was dieser Baustein macht.</> : <>Hey! Möchtest du wissen, wie <strong>{overview.repo.fullName.split('/')[1]}</strong> aufgebaut ist? Ich zeige dir die einzelnen Bestandteile und erkläre, wie alles zusammenarbeitet.</>}
          {aiStatus.data?.ai.configured ? (
            <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask.mutate(); }}>
              <input className="input" style={{ height: 32, flex: 1 }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Frage zum Code stellen …" aria-label="Frage an OMI" />
              <Button size="sm" type="submit" icon loading={ask.isPending} aria-label="Frage senden"><Send /></Button>
            </form>
          ) : <p className="subtle xsmall" style={{ marginTop: 8 }}>Freie Fragen beantworte ich, sobald die Claude API eingerichtet ist. Bis dahin erkläre ich nur, was die Analyse nachweislich zeigt.</p>}
          {ask.data && <div className="small" style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}><Sparkles size={12} /> {ask.data.answer}</div>}
        </RobotBubble>
      ) : (
        <RobotBubble title={<><Bot size={14} /> Tour {tourStep + 1}/{tour.length + 1}</>} onClose={() => { setTourStep(null); setSelected(null); }}
          actions={<>
            <Button size="sm" disabled={tourStep === 0} onClick={() => setTourStep((s) => (s ?? 1) - 1)}>Zurück</Button>
            {tourStep < tour.length ? <Button size="sm" variant="primary" onClick={() => setTourStep((s) => (s ?? 0) + 1)}>Weiter <ArrowRight /></Button> : <Button size="sm" variant="primary" onClick={() => { setTourStep(null); setSelected(null); }}>Fertig</Button>}
          </>}>
          {tourStep === 0 ? (
            <>Das ist das ganze Repository – <strong>die Werkzeugkiste</strong>. {arch.data ? <>Es besteht aus {tour.length} Hauptbereichen, geschrieben vor allem in {Object.keys(arch.data.repo.languages).slice(0, 3).join(', ') || 'mehreren Sprachen'}{arch.data.dependencies.production ? <>, und nutzt {arch.data.dependencies.production} externe Pakete</> : null}.</> : null}</>
          ) : step ? (
            level === 'simple'
              ? <><code>{step.path}</code> ist vermutlich <strong>{step.simple.metaphor}</strong>: {step.simple.text}</>
              : <><code>{step.path}</code> – vermutete Rolle: <strong>{step.label}</strong>. Wähle unten erkannte Abhängigkeiten, um Datenflüsse nachzuverfolgen.</>
          ) : null}
        </RobotBubble>
      )}
    </div>
  ) : (
    <Button onClick={() => setRobotOpen(true)}><Bot /> OMI einblenden</Button>
  );

  return (
    <div className="explorer">
      <div className="explorer-main">
        <div className="explorer-toolbar" role="toolbar" aria-label="Darstellung des Graphen">
          <form onSubmit={onSearch} className="input-icon" style={{ flex: '1 1 200px', maxWidth: 320 }}><Search /><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Im Graphen suchen …" aria-label="Im Graphen suchen" /></form>
          <Segmented label="Erklärungsebene" value={level} onChange={(v) => setPrefs({ explainLevel: v })} options={[{ value: 'simple', label: 'Einfach' }, { value: 'technical', label: 'Technisch' }]} />
          <Switch checked={showDeps} onChange={setShowDeps} label={<span className="small">Abhängigkeiten</span>} />
          <Switch checked={rootFiles} onChange={setRootFiles} label={<span className="small">Dateien im Stamm</span>} />
          <Switch checked={showTests} onChange={setShowTests} label={<span className="small">Tests</span>} />
          <span className="spacer" />
          <Button size="sm" onClick={() => { setExpanded([]); setSelected(null); setTourStep(null); setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 50); }}>Übersicht</Button>
          <Button size="sm" icon onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? 'Vollbild verlassen' : 'Vollbild'}>{fullscreen ? <Minimize /> : <Maximize />}</Button>
        </div>
        <div className="explorer-canvas" style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 65, height: '100vh', borderRadius: 0 } : undefined}>
          {fullscreen && <Button size="sm" style={{ position: 'absolute', top: 12, left: 12, zIndex: 6 }} onClick={() => setFullscreen(false)}><Minimize /> Vollbild verlassen</Button>}
          {graph.isLoading ? <div style={{ padding: 80 }}><Skeleton h={300} r={16} /></div> : graph.data && graph.data.nodes.length === 0 ? (
            <div style={{ padding: 80, textAlign: 'center' }} className="muted">Keine Dateistruktur vorhanden – bitte zuerst abgleichen.</div>
          ) : (
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.1} maxZoom={2.2} colorMode={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}
              nodesDraggable={false} nodesConnectable={false} elementsSelectable onlyRenderVisibleElements
              onNodeClick={(_, n) => setSelected(n.id === '__root__' ? '' : n.id)}
              onNodeDoubleClick={(_, n) => { const g = (n.data as CxData).g; if (g.type === 'folder' && g.path) toggle(g.path); else if (g.type === 'file' && !g.protected) setFileView(g.path); }}
              onPaneClick={() => setSelected(null)} proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} size={1} color="var(--grid-dot)" />
              <Controls showInteractive={false} position="top-right" />
              <MiniMap pannable zoomable nodeColor={(n) => ROLE_COLORS[(n.data as CxData).g.role ?? 'other'] ?? '#888'} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" className="hide-sm" position="bottom-left" />
            </ReactFlow>
          )}
          <div className="legend" aria-label="Legende">
            <span><i /> Ordnerstruktur (tatsächlich)</span>
            <span><i className="dep" /> Import-Abhängigkeit (erkannt)</span>
            <span>Rollenfarben: vermutet</span>
          </div>
        </div>
      </div>

      <div className="explorer-panel stack">
        {robot}
        <DetailPanel repoId={repoId} path={selected} level={level} onOpenFile={setFileView} onSelect={reveal} />
        <Card title="Analyse" icon={<ScanSearch />}>
          {a ? (
            <dl className="kv">
              <dt>Status</dt><dd><span className={`badge ${a.status === 'succeeded' ? 'ok' : a.status === 'running' ? 'accent' : 'crit'}`}>{a.status}</span></dd>
              <dt>Commit</dt><dd className="mono">{a.commit_sha?.slice(0, 10)}</dd>
              <dt>Analysiert</dt><dd>{relTime(a.finished_at)}</dd>
              <dt>Dateien</dt><dd>{num(a.stats.analyzed as number)}</dd>
              <dt>Abhängigkeiten</dt><dd>{num(a.stats.edges as number)} erkannt</dd>
              <dt>Geschützt</dt><dd>{num(a.stats.secretExcluded as number)} Dateien ausgeschlossen</dd>
              {a.error && <><dt>Fehler</dt><dd>{a.error}</dd></>}
            </dl>
          ) : <p className="subtle small">Noch keine Analyse. Starte einen Abgleich.</p>}
          {overview.repo.treeTruncated && <div style={{ marginTop: 10 }}><Callout kind="warn">GitHub hat die Dateiliste gekürzt (sehr großes Repository). Die Darstellung ist unvollständig.</Callout></div>}
          <Button size="sm" style={{ marginTop: 12 }} onClick={async () => { await api.post(`/api/repos/${repoId}/analyze`).catch((e) => toast({ kind: 'error', title: 'Analyse fehlgeschlagen', body: (e as Error).message })); qc.invalidateQueries({ queryKey: ['repo', repoId] }); }}><RefreshCw /> Neu analysieren</Button>
        </Card>
      </div>

      <Dialog open={Boolean(fileView)} onClose={() => setFileView(null)} wide title={fileView?.split('/').pop() ?? ''} description={<span className="mono">{fileView} · nur lesend{file.data?.redactions ? ` · ${file.data.redactions} geheime Werte entfernt` : ''}</span>}>
        {file.isLoading ? <Skeleton h={300} /> : file.error ? <Callout kind="warn">{(file.error as Error).message}</Callout> : file.data ? <CodeViewer text={file.data.text} language={file.data.language} /> : null}
      </Dialog>
    </div>
  );
}

export default function CodeExplorerPage() {
  const { repoId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'map' | 'commits' | 'deps'>('map');
  const ov = useQuery({ queryKey: ['repo', repoId, 'overview'], queryFn: () => api.get<Overview>(`/api/repos/${repoId}`) });
  const sync = useMutation({
    mutationFn: () => api.post<{ message: string; status: string }>(`/api/repos/${repoId}/sync?force=1`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['repo', repoId] }); toast({ kind: r.status === 'ok' ? 'success' : 'warning', title: r.message }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Abgleich fehlgeschlagen', body: e.message }),
  });
  const setBranch = useMutation({
    mutationFn: (branch: string | null) => api.patch(`/api/repos/${repoId}`, { trackedBranch: branch }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['repo', repoId] }); toast({ kind: 'success', title: 'Branch gewechselt', body: 'Struktur und Analyse wurden neu geladen.' }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Branch nicht gewechselt', body: e.message }),
  });
  if (ov.error) return <ErrorState error={ov.error} />;
  if (!ov.data) return <Skeleton h={500} r={16} />;
  const r = ov.data.repo;
  return (
    <div>
      <nav className="breadcrumbs"><Link to="/code">Code Explorer</Link><span>›</span><span>{r.fullName}</span></nav>
      <header className="page-header">
        <div>
          <div className="eyebrow"><FolderGit2 size={14} /> Inside my code</div>
          <h1>{r.fullName}</h1>
          <p className="lead muted" style={{ marginTop: 6 }}>{r.description ?? 'Interaktive, lesende Darstellung der tatsächlichen Codebasis.'}</p>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <HealthDot health={r.status === 'ok' ? 'ok' : r.status === 'pending' ? 'unknown' : 'critical'} /><span className="small">{r.status}{r.statusDetail ? ` – ${r.statusDetail}` : ''}</span>
            <label className="row" style={{ gap: 6 }}><span className="sr-only">Branch</span>
              <select className="select" style={{ height: 28, width: 'auto', fontSize: 'var(--fs-xs)' }} value={r.trackedBranch ?? ''} onChange={(e) => setBranch.mutate(e.target.value || null)} aria-label="Verfolgter Branch" disabled={setBranch.isPending}>
                <option value="">{r.defaultBranch ?? 'Standard'} (Standard)</option>
                {ov.data.branches.filter((b) => b.name !== r.defaultBranch).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </label>
            {r.private && <span className="badge outline">privat</span>}
            <span className="subtle xsmall">Abgleich {relTime(r.lastSyncedAt)} · {num(r.fileCount)} Dateien</span>
            {ov.data.links.map((l) => <Link key={l.node_id} to={`/projects/${l.node_id}`} className="badge accent">{l.name}</Link>)}
          </div>
        </div>
        <div className="page-actions">
          {r.htmlUrl && <a className="btn" href={r.htmlUrl} target="_blank" rel="noopener noreferrer">Auf GitHub</a>}
          <Button variant="primary" onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw /> Abgleichen</Button>
        </div>
      </header>
      <Tabs label="Code-Ansichten" value={tab} onChange={setTab} tabs={[{ id: 'map', label: 'Architektur-Karte' }, { id: 'commits', label: 'Commits', icon: <GitCommitHorizontal /> }, { id: 'deps', label: 'Pakete', icon: <Package /> }]} />
      {tab === 'map' && (r.status === 'pending' || !r.headSha ? <Callout title="Noch nicht abgeglichen">Starte einen Abgleich, um die Struktur zu laden.</Callout> : <ReactFlowProvider><ExplorerCanvas repoId={repoId} overview={ov.data} /></ReactFlowProvider>)}
      {tab === 'commits' && (
        <Card title="Letzte Commits (Standardbranch)" icon={<GitCommitHorizontal />}>
          <div className="list">{ov.data.commits.map((c) => <a key={c.sha} href={c.html_url} target="_blank" rel="noopener noreferrer" className="list-item"><code className="xsmall">{c.sha.slice(0, 7)}</code><span className="small truncate" style={{ flex: 1 }}>{c.message.split('\n')[0]}</span><span className="meta">{c.author_name} · {relTime(c.committed_at)}</span></a>)}</div>
        </Card>
      )}
      {tab === 'deps' && (
        <Card title={`Pakete aus Manifesten (${ov.data.dependencies.length})`} icon={<Package />}>
          <div className="table-wrap"><table className="table"><thead><tr><th>Paket</th><th>Version</th><th>Art</th><th>Manifest</th></tr></thead>
            <tbody>{ov.data.dependencies.map((d) => <tr key={`${d.manifest_path}:${d.name}:${d.dev}`}><td className="mono small">{d.name}</td><td className="mono xsmall">{d.version_spec}</td><td>{d.dev ? <span className="badge outline">Entwicklung</span> : <span className="badge ion">Laufzeit</span>}</td><td className="mono xsmall">{d.manifest_path}</td></tr>)}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
