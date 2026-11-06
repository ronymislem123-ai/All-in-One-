import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized } from '../api/client';
import type { AuthState, Preferences } from '../api/types';

const DEFAULT_PREFS: Preferences = {
  theme: 'system', density: 'comfortable', motion: 'system', dashboardWidgets: ['welcome', 'stats', 'attention', 'recent', 'activity', 'sync', 'backup', 'favorites', 'recommendations', 'ideas'],
  hiddenWidgets: [], librarySort: 'activity', libraryView: 'grid', explainLevel: 'simple', robotEnabled: true,
};

interface SessionCtx {
  auth: AuthState | undefined;
  authLoading: boolean;
  prefs: Preferences;
  setPrefs: (p: Partial<Preferences>) => void;
  refreshAuth: () => void;
}
const Ctx = createContext<SessionCtx>({ auth: undefined, authLoading: true, prefs: DEFAULT_PREFS, setPrefs: () => undefined, refreshAuth: () => undefined });
export const useSession = () => useContext(Ctx);
export const usePrefs = () => {
  const { prefs, setPrefs } = useContext(Ctx);
  return [prefs, setPrefs] as const;
};

function applyPrefs(p: Preferences) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = p.density;
  if (p.motion === 'system') delete root.dataset.motion; else root.dataset.motion = p.motion;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#090a0f' : '#f4f5fa');
  try { localStorage.setItem('omega.prefs', JSON.stringify({ theme: p.theme, density: p.density, motion: p.motion })); } catch { /* ignore */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const authQ = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/api/auth/state'), staleTime: 60_000 });
  const authed = Boolean(authQ.data?.authenticated);
  const prefsQ = useQuery({ queryKey: ['prefs'], queryFn: () => api.get<Preferences>('/api/preferences'), enabled: authed, staleTime: Infinity });
  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...(prefsQ.data ?? {}) }), [prefsQ.data]);
  const save = useMutation({ mutationFn: (p: Partial<Preferences>) => api.put<Preferences>('/api/preferences', p), onSuccess: (d) => qc.setQueryData(['prefs'], d) });

  useEffect(() => applyPrefs(prefs), [prefs]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyPrefs(prefs);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [prefs]);
  useEffect(() => {
    const off = onUnauthorized(() => { qc.invalidateQueries({ queryKey: ['auth'] }); });
    return () => { off(); };
  }, [qc]);

  const setPrefs = useCallback((p: Partial<Preferences>) => {
    qc.setQueryData(['prefs'], (old: Preferences | undefined) => ({ ...DEFAULT_PREFS, ...(old ?? {}), ...p }));
    save.mutate(p);
  }, [qc, save]);
  const refreshAuth = useCallback(() => { qc.invalidateQueries({ queryKey: ['auth'] }); }, [qc]);

  return <Ctx.Provider value={{ auth: authQ.data, authLoading: authQ.isLoading, prefs, setPrefs, refreshAuth }}>{children}</Ctx.Provider>;
}
