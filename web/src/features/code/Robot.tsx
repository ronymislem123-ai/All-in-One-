import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** OMI – the OMEGA guide. A small SVG robot; animations respect reduced-motion settings. */
export function RobotFigure({ talking, onClick, label = 'OMI, dein Code-Begleiter' }: { talking?: boolean; onClick?: () => void; label?: string }) {
  return (
    <svg className={`robot-figure ${talking ? 'talking' : ''}`} viewBox="0 0 74 86" role="img" aria-label={label} onClick={onClick}>
      <defs>
        <linearGradient id="r-shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--surface-3)" /><stop offset="1" stopColor="var(--surface-1)" /></linearGradient>
        <linearGradient id="r-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141827" /><stop offset="1" stopColor="#0b0d16" /></linearGradient>
      </defs>
      <g className="r-body">
        <line x1="37" y1="14" x2="37" y2="5" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
        <circle className="r-antenna-tip" cx="37" cy="5" r="3.4" fill="var(--ion)" />
        <rect x="10" y="13" width="54" height="42" rx="18" fill="url(#r-shell)" stroke="var(--border-strong)" />
        <rect x="16" y="21" width="42" height="24" rx="11" fill="url(#r-visor)" />
        <ellipse className="r-eye" cx="29" cy="32" rx="4" ry="4.4" fill="var(--ion)" />
        <ellipse className="r-eye" cx="45" cy="32" rx="4" ry="4.4" fill="var(--ion)" />
        <rect className="r-mouth" x="32" y="39.5" width="10" height="1.8" rx="0.9" fill="var(--ion)" opacity="0.8" />
        <circle cx="10" cy="34" r="3.2" fill="var(--accent)" />
        <circle cx="64" cy="34" r="3.2" fill="var(--accent)" />
        <rect x="22" y="57" width="30" height="20" rx="9" fill="url(#r-shell)" stroke="var(--border-strong)" />
        <path d="M33 64h8M37 64v7" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="16" y="60" width="6" height="12" rx="3" fill="var(--surface-3)" stroke="var(--border-strong)" />
        <rect x="52" y="60" width="6" height="12" rx="3" fill="var(--surface-3)" stroke="var(--border-strong)" />
      </g>
    </svg>
  );
}

export function RobotBubble({ title, children, actions, onClose, compact }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; onClose?: () => void; compact?: boolean }) {
  return (
    <div className={`robot-bubble ${compact ? 'min' : ''}`} role="status" aria-live="polite">
      {(title || onClose) && (
        <div className="rb-title">
          {title}
          {onClose && <button className="btn ghost icon sm" style={{ marginLeft: 'auto', width: 24, height: 24 }} onClick={onClose} aria-label="Begleiter ausblenden"><X size={14} /></button>}
        </div>
      )}
      <div>{children}</div>
      {actions && <div className="rb-actions">{actions}</div>}
    </div>
  );
}
