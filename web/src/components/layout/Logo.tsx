/** The OMEGA mark: an Ω inside an orbit with a satellite – "one ecosystem, endless possibilities". */
export function Logo({ className = 'brand-mark', title = 'OMEGA Infinity' }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <linearGradient id="omega-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-strong)" />
          <stop offset="1" stopColor="var(--ion)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="url(#omega-g)" strokeWidth="1.6" opacity="0.5" strokeDasharray="3 4" />
      <path d="M21 43h7v-3.2a11 11 0 1 1 8 0V43h7" fill="none" stroke="url(#omega-g)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="51" cy="19" r="3.2" fill="var(--ion)" />
    </svg>
  );
}
