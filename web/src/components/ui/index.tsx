import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CircleCheck, Info, X, CircleX, Inbox } from 'lucide-react';

// ── Button ──────────────────────────────────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'default'; size?: 'sm' | 'md'; icon?: boolean; loading?: boolean; block?: boolean };
export function Button({ variant = 'default', size = 'md', icon, loading, block, className = '', children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={['btn', variant !== 'default' && variant, size === 'sm' && 'sm', icon && 'icon', block && 'block', className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────
export function Card({ title, icon, actions, children, className = '', ...rest }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{icon}{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ── Empty / error / loading ─────────────────────────────────────────────
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Unbekannter Fehler';
  return (
    <div className="callout crit" role="alert">
      <CircleX />
      <div className="stack-sm">
        <strong>Laden fehlgeschlagen</strong>
        <span>{msg}</span>
        {retry && <div><Button size="sm" onClick={retry}>Erneut versuchen</Button></div>}
      </div>
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}
export function SkeletonCards({ n = 6, h = 150 }: { n?: number; h?: number }) {
  return (
    <div className="grid-cards" aria-busy="true" aria-label="Wird geladen">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} h={h} r={16} />)}
    </div>
  );
}

export function Callout({ kind = 'info', title, children, icon }: { kind?: 'info' | 'warn' | 'crit' | 'ok'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const Ico = kind === 'warn' ? AlertTriangle : kind === 'crit' ? CircleX : kind === 'ok' ? CircleCheck : Info;
  return (
    <div className={`callout ${kind === 'info' ? '' : kind}`} role={kind === 'crit' ? 'alert' : 'note'}>
      {icon ?? <Ico aria-hidden />}
      <div className="stack-sm">{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
    </div>
  );
}

// ── Progress ────────────────────────────────────────────────────────────
export function Progress({ value, label }: { value: number | null | undefined; label?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label ?? 'Fortschritt'}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Ring({ value, size = 46, color = 'var(--accent)', label }: { value: number; size?: number; color?: string; label?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value} von 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * value) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 3.6} fontWeight={600} fill="var(--text)">{value}</text>
    </svg>
  );
}

// ── Form controls ───────────────────────────────────────────────────────
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode }[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const idx = tabs.findIndex((t) => t.id === value);
    const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.icon}{t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

// ── Dialog (focus trap, Escape, restores focus) ─────────────────────────
export function Dialog({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    requestAnimationFrame(() => (el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} aria-hidden />
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Schließen"><X /></Button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/** Confirmation dialog that can require typing a word for irreversible actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = 'Bestätigen', danger, requireText, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string; loading?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  const ok = !requireText || text.trim() === requireText;
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <div className="stack">
        {children}
        {requireText && (
          <Field label={`Zur Bestätigung „${requireText}“ eingeben`}>
            {(id) => <input id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" data-autofocus />}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; kind: ToastKind; title: string; body?: string }
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4500);
  }, []);
  const Ico = { success: CircleCheck, error: CircleX, warning: AlertTriangle, info: Info };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => {
          const I = Ico[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <I className="t-icon" size={18} aria-hidden />
              <div className="spacer"><strong>{t.title}</strong>{t.body && <p>{t.body}</p>}</div>
              <button className="btn ghost icon sm" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Hinweis schließen"><X /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Popover menu ────────────────────────────────────────────────────────
export function Menu({ trigger, children, align = 'right' }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.menu-item')?.focus());
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const onKeyNav = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className="popover" role="menu" style={{ top: 'calc(100% + 6px)', [align]: 0 }} onKeyDown={onKeyNav}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
