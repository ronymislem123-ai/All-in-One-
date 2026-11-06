const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'gerade eben';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}
export const dateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : '–');
export const date = (iso: string | null | undefined) => (iso ? df.format(new Date(iso)) : '–');
export function bytes(n: number | null | undefined): string {
  if (n == null) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export const num = (n: number | null | undefined) => (n == null ? '–' : new Intl.NumberFormat('de-DE').format(n));
export const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
};
