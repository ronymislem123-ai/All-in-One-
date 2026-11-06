// Applies the stored theme before React renders (prevents a flash of the wrong theme).
try {
  const p = JSON.parse(localStorage.getItem('omega.prefs') ?? '{}') as { theme?: string; density?: string; motion?: string };
  const dark = p.theme === 'dark' || (p.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (p.density) document.documentElement.dataset.density = p.density;
  if (p.motion && p.motion !== 'system') document.documentElement.dataset.motion = p.motion;
} catch {
  /* storage unavailable – defaults apply */
}
