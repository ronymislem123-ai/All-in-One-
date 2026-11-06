import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AppWindow, BookOpen, Boxes, FileCode, FolderGit2, HardDriveDownload, Lightbulb, Moon, Plus, Search, Tag, Upload, Zap } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { SearchHit } from '../../api/types';
import { usePrefs } from '../../lib/session';
import { useToast } from '../ui';
import { NAV } from './Shell';

interface Item { id: string; group: string; title: string; sub?: string; icon: ReactNode; run: () => void; keywords?: string }

const TYPE_ICON: Record<string, ReactNode> = {
  node: <Boxes />, idea: <Lightbulb />, application: <AppWindow />, category: <Tag />, knowledge: <BookOpen />, repository: <FolderGit2 />, file: <FileCode />,
};
const TYPE_GROUP: Record<string, string> = { node: 'Projekte & Module', idea: 'Ideen', application: 'Apps', category: 'Kategorien', knowledge: 'Claude Wissen', repository: 'Repositories', file: 'Dateien' };

function highlight(snippet: string) {
  const parts = snippet.split(/⟦|⟧/);
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [, setPrefs] = usePrefs();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 140); return () => clearTimeout(t); }, [q]);
  const results = useQuery({ queryKey: ['search', debounced], queryFn: () => api.get<{ hits: SearchHit[] }>(`/api/search${qs({ q: debounced, limit: 30 })}`), enabled: open && debounced.length >= 2 });

  const go = (to: string) => () => { nav(to); onClose(); };
  const actions: Item[] = useMemo(() => [
    { id: 'new-project', group: 'Aktionen', title: 'Neues Projekt anlegen', icon: <Plus />, run: go('/projects?new=1'), keywords: 'erstellen projekt' },
    { id: 'new-idea', group: 'Aktionen', title: 'Neue Idee erfassen', icon: <Lightbulb />, run: go('/ideas?new=1'), keywords: 'idee notieren' },
    { id: 'new-app', group: 'Aktionen', title: 'Anwendung hinzufügen', icon: <AppWindow />, run: go('/apps?new=1'), keywords: 'app' },
    { id: 'discover', group: 'Aktionen', title: 'Ideen entdecken', icon: <Zap />, run: go('/ideas?mode=discover'), keywords: 'inspiration' },
    { id: 'import', group: 'Aktionen', title: 'Claude-Daten importieren (Datei)', icon: <Upload />, run: go('/sync?tab=import'), keywords: 'import json markdown' },
    {
      id: 'backup', group: 'Aktionen', title: 'Jetzt Backup erstellen', icon: <HardDriveDownload />, keywords: 'sicherung',
      run: async () => {
        onClose();
        try { const r = await api.post<{ name: string }>('/api/backups', { note: 'Über Command Palette' }); toast({ kind: 'success', title: 'Backup erstellt', body: r.name }); }
        catch (e) { toast({ kind: 'error', title: 'Backup fehlgeschlagen', body: (e as Error).message }); }
      },
    },
    { id: 'theme', group: 'Aktionen', title: 'Hell/Dunkel umschalten', icon: <Moon />, run: () => { setPrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }); onClose(); }, keywords: 'theme design' },
    ...NAV.flatMap((s) => s.items.map((i) => ({ id: `nav-${i.to}`, group: 'Navigation', title: i.label, sub: s.label, icon: i.icon, run: go(i.to) }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const items: Item[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const local = needle ? actions.filter((a) => `${a.title} ${a.keywords ?? ''} ${a.sub ?? ''}`.toLowerCase().includes(needle)) : actions;
    const hits: Item[] = (results.data?.hits ?? []).map((h) => ({
      id: `${h.type}:${h.id}`, group: TYPE_GROUP[h.type] ?? 'Treffer', title: h.title, sub: h.subtitle, icon: TYPE_ICON[h.type] ?? <Search />,
      run: go(h.link), keywords: h.snippet,
    }));
    return [...local.slice(0, needle ? 6 : 20), ...hits];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, actions, results.data]);

  useEffect(() => { setActive(0); }, [items.length]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} aria-hidden />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Suche und Befehle" onKeyDown={onKey}>
        <div className="palette-input">
          <Search aria-hidden />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen oder Befehl eingeben …"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pi-${active}` : undefined} aria-autocomplete="list"
          />
          {results.isFetching && <span className="spinner" aria-label="Suche läuft" />}
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Ergebnisse">
          {items.length === 0 && debounced.length >= 2 && !results.isFetching && <div className="empty" style={{ padding: 24 }}><p>Keine Treffer für „{debounced}“.</p></div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette-group" role="presentation">{it.group}</div> : null;
            lastGroup = it.group;
            const snippet = it.keywords && it.keywords.includes('⟦') ? highlight(it.keywords) : null;
            return (
              <div key={it.id}>
                {header}
                <div id={`pi-${i}`} role="option" aria-selected={i === active} className="palette-item" onMouseEnter={() => setActive(i)} onClick={it.run}>
                  <span className="pi-icon">{it.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="truncate">{it.title}</div>
                    {(snippet || it.sub) && <div className="pi-sub truncate">{snippet ?? it.sub}</div>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> Auswahl</span><span><kbd>Enter</kbd> Öffnen</span><span><kbd>Esc</kbd> Schließen</span></div>
      </div>
    </>,
    document.body,
  );
}
