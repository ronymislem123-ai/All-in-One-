import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CodeXml, FolderGit2, Plus } from 'lucide-react';
import { api } from '../../api/client';
import type { Repo } from '../../api/types';
import { relTime, num } from '../../lib/format';
import { EmptyState, ErrorState, SkeletonCards } from '../../components/ui';
import { HealthDot } from '../../components/ui/Status';
import { PageHeader } from '../../components/layout/PageHeader';

export default function CodeIndexPage() {
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get<Repo[]>('/api/repos') });
  return (
    <div>
      <PageHeader eyebrow={<><CodeXml size={14} /> Code Explorer</>} title="Inside my code" lead="Interaktive Karten deiner tatsächlichen GitHub-Codebasis: Ordner, Dateien und erkannte Abhängigkeiten – einfach oder technisch erklärt. Ausschließlich lesend."
        actions={<Link className="btn primary" to="/sync?tab=repos"><Plus /> Repository hinzufügen</Link>} />
      {repos.error ? <ErrorState error={repos.error} /> : !repos.data ? <SkeletonCards n={3} /> : repos.data.length === 0 ? (
        <EmptyState icon={<FolderGit2 />} title="Noch keine Repositories" action={<Link className="btn primary" to="/sync?tab=repos"><Plus /> Repository verbinden</Link>}>Verbinde ein GitHub-Repository (nur lesend), um seine Architektur zu erkunden.</EmptyState>
      ) : (
        <div className="grid-cards stagger">
          {repos.data.map((r) => (
            <Link key={r.id} to={`/code/${r.id}`} className="card interactive glow stack-sm">
              <div className="row" style={{ gap: 10 }}><FolderGit2 size={20} color="var(--accent)" /><strong className="truncate" style={{ flex: 1 }}>{r.fullName}</strong><HealthDot health={r.status === 'ok' ? 'ok' : r.status === 'pending' ? 'unknown' : 'critical'} /></div>
              <p className="muted small clamp-2">{r.description ?? 'Keine Beschreibung'}</p>
              <div className="row subtle xsmall" style={{ gap: 10 }}>
                <span>{r.primaryLanguage ?? '–'}</span><span>{num(r.fileCount)} Dateien</span><span>Abgleich {relTime(r.lastSyncedAt)}</span>
              </div>
              <div className="row" style={{ gap: 4, height: 6, borderRadius: 4, overflow: 'hidden' }}>
                {Object.entries(r.languages).slice(0, 6).map(([lang, bytes], i, arr) => {
                  const total = arr.reduce((s, [, b]) => s + b, 0);
                  return <span key={lang} title={lang} style={{ flex: bytes / total, height: 6, background: ['#8d95ff', '#4fd4c8', '#f2b84b', '#f07aa8', '#6aa7ff', '#5cc98f'][i] }} />;
                })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
