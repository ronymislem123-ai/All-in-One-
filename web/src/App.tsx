import { lazy, Suspense, Component, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Skeleton, EmptyState, Button } from './components/ui';
import { Shell } from './components/layout/Shell';
import { AuthScreen } from './features/auth/AuthScreens';
import { ApiError } from './api/client';
import { Compass } from 'lucide-react';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const LibraryPage = lazy(() => import('./features/projects/LibraryPage'));
const ProjectPage = lazy(() => import('./features/projects/ProjectPage'));
const AppStorePage = lazy(() => import('./features/apps/AppStorePage'));
const IdeaHubPage = lazy(() => import('./features/ideas/IdeaHubPage'));
const IdeaPage = lazy(() => import('./features/ideas/IdeaPage'));
const KnowledgePage = lazy(() => import('./features/knowledge/KnowledgePage'));
const SyncCenterPage = lazy(() => import('./features/sync/SyncCenterPage'));
const ConflictsPage = lazy(() => import('./features/conflicts/ConflictsPage'));
const CodeIndexPage = lazy(() => import('./features/code/CodeIndexPage'));
const CodeExplorerPage = lazy(() => import('./features/code/CodeExplorerPage'));
const ActivityPage = lazy(() => import('./features/activity/ActivityPage'));
const BackupPage = lazy(() => import('./features/backup/BackupPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() {
    if (this.state.error) {
      return (
        <div className="card" role="alert" style={{ margin: 24 }}>
          <h2>Diese Ansicht konnte nicht angezeigt werden</h2>
          <p className="muted" style={{ margin: '8px 0 16px' }}>{this.state.error.message}. Deine Daten sind davon nicht betroffen.</p>
          <Button onClick={() => { this.setState({ error: null }); location.reload(); }}>Neu laden</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageFallback() {
  return (
    <div className="stack" aria-busy="true" aria-label="Seite wird geladen">
      <Skeleton h={34} w={280} />
      <Skeleton h={18} w={420} />
      <div className="grid-4"><Skeleton h={110} r={16} /><Skeleton h={110} r={16} /><Skeleton h={110} r={16} /><Skeleton h={110} r={16} /></div>
      <Skeleton h={300} r={16} />
    </div>
  );
}

function NotFound() {
  return <EmptyState icon={<Compass />} title="Seite nicht gefunden" action={<Link className="btn primary" to="/">Zum Dashboard</Link>}>Diese Adresse gibt es in deinem OMEGA nicht.</EmptyState>;
}

function Gate() {
  const { auth, authLoading } = useSession();
  if (authLoading) return <div className="auth-wrap"><span className="spinner" aria-label="Wird geladen" /></div>;
  if (!auth) return <div className="auth-wrap"><div className="card">Server nicht erreichbar. Bitte später erneut versuchen.</div></div>;
  if (auth.setupRequired) return <AuthScreen setup />;
  if (!auth.authenticated) return <AuthScreen setup={false} />;
  const page = (el: ReactNode) => <ErrorBoundary><Suspense fallback={<PageFallback />}>{el}</Suspense></ErrorBoundary>;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={page(<DashboardPage />)} />
        <Route path="projects" element={page(<LibraryPage />)} />
        <Route path="projects/:id" element={page(<ProjectPage />)} />
        <Route path="apps" element={page(<AppStorePage />)} />
        <Route path="ideas" element={page(<IdeaHubPage />)} />
        <Route path="ideas/:id" element={page(<IdeaPage />)} />
        <Route path="knowledge" element={page(<KnowledgePage />)} />
        <Route path="knowledge/:slug" element={page(<KnowledgePage />)} />
        <Route path="sync" element={page(<SyncCenterPage />)} />
        <Route path="conflicts" element={page(<ConflictsPage />)} />
        <Route path="conflicts/:id" element={page(<ConflictsPage />)} />
        <Route path="code" element={page(<CodeIndexPage />)} />
        <Route path="code/:repoId" element={page(<CodeExplorerPage />)} />
        <Route path="activity" element={page(<ActivityPage />)} />
        <Route path="backups" element={page(<BackupPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SessionProvider>
            <Gate />
          </SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
