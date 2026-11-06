export const nowIso = (): string => new Date().toISOString();
export const addMinutes = (iso: string, minutes: number): string => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
export const minutesSince = (iso: string | null | undefined): number | null =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : null;
export const fileStamp = (d = new Date()): string => d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
