import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AppWindow, Bell, BookOpen, Boxes, ChevronsLeft, ChevronsRight, CodeXml, GitMerge, HardDriveDownload, LayoutDashboard, Lightbulb,
  LogOut, Menu as MenuIcon, Moon, RefreshCw, Search, Settings, Sun, User, X, CheckCheck,
} from 'lucide-react';
import { api } from '../../api/client';
import { usePrefs, useSession } from '../../lib/session';
import { relTime } from '../../lib/format';
import { Button, Menu } from '../ui';
import { Logo } from './Logo';
import { CommandPalette } from './CommandPalette';

interface NavItem { to: string; label: string; icon: ReactNode; badgeKey?: 'conflicts' }
export const NAV: { label: string; items: NavItem[] }[] = [
  { label: 'Übersicht', items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard /> }] },
  {
    label: 'Arbeiten',
    items: [
      { to: '/projects', label: 'Projekte', icon: <Boxes /> },
      { to: '/apps', label: 'App Store', icon: <AppWindow /> },
      { to: '/ideas', label: 'AI Idea Hub', icon: <Lightbulb /> },
      { to: '/knowledge', label: 'Claude Wissen', icon: <BookOpen /> },
    ],
  },
  {
    label: 'Technik',
    items: [
      { to: '/code', label: 'Code Explorer', icon: <CodeXml /> },
      { to: '/sync', label: 'Sync Center', icon: <RefreshCw /> },
      { to: '/conflicts', label: 'Konflikte', icon: <GitMerge />, badgeKey: 'conflicts' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/activity', label: 'Aktivität & Verlauf', icon: <Activity /> },
      { to: '/backups', label: 'Backup & Sicherheit', icon: <HardDriveDownload /> },
      { to: '/settings', label: 'Einstellungen', icon: <Settings /> },
    ],
  },
];

function useBadges() {
  const conflicts = useQuery({ queryKey: ['conflicts', 'open'], queryFn: () => api.get<unknown[]>('/api/conflicts?status=open'), refetchInterval: 60_000 });
  return { conflicts: conflicts.data?.length ?? 0 };
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const badges = useBadges();
  return (
    <nav aria-label="Hauptnavigation">
      {NAV.map((section) => (
        <div className="nav-section" key={section.label}>
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link" onClick={onNavigate} data-tip-pos="right">
              {item.icon}
              <span className="nav-text">{item.label}</span>
              {item.badgeKey && badges[item.badgeKey] > 0 && <span className="badge count" aria-label={`${badges[item.badgeKey]} offen`}>{badges[item.badgeKey]}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: { id: string; level: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }[]; unread: number }>('/api/notifications'), enabled: open });
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Benachrichtigungen">
        <div className="dialog-header">
          <div><h2>Benachrichtigungen</h2><p>Relevante Änderungen und Probleme</p></div>
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => readAll.mutate()}><CheckCheck /> Alle gelesen</Button>
            <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Schließen" data-autofocus><X /></Button>
          </div>
        </div>
        <div className="dialog-body">
          {q.data?.items.length === 0 && <p className="muted small">Keine Benachrichtigungen.</p>}
          <div className="list">
            {q.data?.items.map((n) => (
              <button key={n.id} className="list-item" onClick={() => { if (n.link) { nav(n.link); onClose(); } api.post(`/api/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })); }}>
                <span className={`dot ${n.level === 'error' ? 'critical' : n.level === 'warning' ? 'attention' : n.level === 'success' ? 'ok' : 'unknown'}`} />
                <span className="spacer" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>
                  {n.body && <span className="subtle xsmall clamp-2" style={{ display: '-webkit-box' }}>{n.body}</span>}
                </span>
                <span className="meta">{relTime(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

export function Shell() {
  const { auth, refreshAuth } = useSession();
  const [prefs, setPrefs] = usePrefs();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('omega.sidebar') === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const qc = useQueryClient();
  const unread = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ unread: number }>('/api/notifications'), refetchInterval: 60_000 });

  useEffect(() => { try { localStorage.setItem('omega.sidebar', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { setMoreOpen(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isDark = document.documentElement.dataset.theme === 'dark';
  const logout = async () => { await api.post('/api/auth/logout'); qc.clear(); refreshAuth(); };

  return (
    <div className="shell" data-collapsed={collapsed}>
      <a className="skip-link" href="#main">Zum Inhalt springen</a>
      <aside className="sidebar" aria-label="Seitenleiste">
        <NavLink to="/" className="brand" title="Zum Dashboard">
          <Logo />
          <span className="brand-text"><span className="brand-name">OMEGA</span><span className="brand-sub">INFINITY · DIGITAL OS</span></span>
        </NavLink>
        <NavList />
        <div className="sidebar-footer">
          <button className="nav-link btn ghost" style={{ justifyContent: collapsed ? 'center' : 'flex-start', height: 38 }} onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}<span className="nav-text">Einklappen</span>
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="btn ghost icon mobile-only" onClick={() => setMoreOpen(true)} aria-label="Navigation öffnen"><MenuIcon /></button>
          <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K Meta+K /">
            <Search size={16} aria-hidden />
            <span className="truncate">Suchen<span className="search-text-long"> – Projekte, Ideen, Apps, Dateien, Befehle …</span></span>
            <kbd className="desktop-only">⌘K</kbd>
          </button>
          <div className="topbar-actions">
            <Button variant="ghost" icon onClick={() => setPrefs({ theme: isDark ? 'light' : 'dark' })} aria-label={isDark ? 'Helles Design' : 'Dunkles Design'} data-tip={isDark ? 'Helles Design' : 'Dunkles Design'}>
              {isDark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" icon onClick={() => setNotifOpen(true)} aria-label={`Benachrichtigungen${unread.data?.unread ? ` (${unread.data.unread} ungelesen)` : ''}`} data-tip="Benachrichtigungen">
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Bell />
                {(unread.data?.unread ?? 0) > 0 && <span className="dot critical" style={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7 }} />}
              </span>
            </Button>
            <Menu trigger={(p) => <Button variant="ghost" icon aria-label="Konto" {...p}><User /></Button>}>
              {(close) => (
                <>
                  <div className="small" style={{ padding: '8px 12px' }}><strong>{auth?.user?.displayName}</strong><div className="subtle xsmall">{auth?.user?.email}</div></div>
                  <NavLink className="menu-item" role="menuitem" to="/settings" onClick={close}><Settings /> Einstellungen</NavLink>
                  <button className="menu-item danger" role="menuitem" onClick={() => { close(); logout(); }}><LogOut /> Abmelden</button>
                </>
              )}
            </Menu>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <div className="page" key={loc.pathname}>
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Schnellnavigation">
        <NavLink to="/" end><LayoutDashboard />Start</NavLink>
        <NavLink to="/projects"><Boxes />Projekte</NavLink>
        <NavLink to="/ideas"><Lightbulb />Ideen</NavLink>
        <NavLink to="/apps"><AppWindow />Apps</NavLink>
        <button onClick={() => setMoreOpen(true)}><MenuIcon />Mehr</button>
      </nav>

      {moreOpen && (
        <>
          <div className="overlay" onClick={() => setMoreOpen(false)} aria-hidden />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Navigation" style={{ left: 0, right: 'auto', borderLeft: 0, borderRight: '1px solid var(--border-strong)', padding: 'var(--sp-4) var(--sp-3)', overflowY: 'auto' }}>
            <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
              <span className="brand"><Logo /><span className="brand-text"><span className="brand-name">OMEGA</span></span></span>
              <Button variant="ghost" icon onClick={() => setMoreOpen(false)} aria-label="Schließen"><X /></Button>
            </div>
            <NavList onNavigate={() => setMoreOpen(false)} />
          </aside>
        </>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <NotificationsDrawer open={notifOpen} onClose={() => { setNotifOpen(false); qc.invalidateQueries({ queryKey: ['notifications', 'count'] }); }} />
    </div>
  );
}
