/** The OMEGA mark: a precise Ω on a graphite plane, one lime point – "one ecosystem, endless possibilities". */
export function Logo({ className = 'brand-mark', title = 'OMEGA Infinity' }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title}>
      <rect x="0.5" y="0.5" width="63" height="63" rx="5" fill="var(--surface-1)" stroke="var(--border-strong)" />
      <path d="M20 44h8.5v-2.6A12.5 12.5 0 1 1 35.5 41.4V44H44" fill="none" stroke="var(--text)" strokeWidth="3" strokeLinecap="square" strokeLinejoin="miter" />
      <rect x="47" y="13" width="4" height="4" fill="var(--accent)" />
    </svg>
  );
}
