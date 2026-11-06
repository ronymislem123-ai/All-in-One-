import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export function PageHeader({ title, eyebrow, lead, actions, crumbs }: { title: ReactNode; eyebrow?: ReactNode; lead?: ReactNode; actions?: ReactNode; crumbs?: { to: string; label: string }[] }) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        {crumbs && crumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Brotkrumen">
            {crumbs.map((c, i) => (
              <span key={c.to} className="row" style={{ gap: 4 }}>
                {i > 0 && <ChevronRight size={14} aria-hidden />}
                <Link to={c.to}>{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
