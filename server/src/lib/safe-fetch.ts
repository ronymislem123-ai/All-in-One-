import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Addresses that must never be requested (cloud metadata, unspecified, multicast). */
function isForbidden(ip: string): boolean {
  if (ip.startsWith('169.254.') || ip === '0.0.0.0' || ip.startsWith('0.')) return true;
  if (/^(22[4-9]|23\d)\./.test(ip)) return true; // multicast
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80:') || lower === '::' || lower.startsWith('ff') || lower.startsWith('fd00:ec2')) return true;
  return false;
}
function isPrivate(ip: string): boolean {
  return (
    ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || ip === '::1' || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')
  );
}

export interface ProbeResult {
  ok: boolean;
  status: number | null;
  ms: number;
  finalUrl: string;
  error?: string;
  note?: string;
}

/**
 * Checks whether a URL is reachable. Guards against SSRF to metadata endpoints, follows at most
 * three redirects (each re-validated) and never reads more than the response headers.
 */
export async function probeUrl(url: string, opts: { allowPrivate: boolean; timeoutMs?: number } = { allowPrivate: true }): Promise<ProbeResult> {
  const started = Date.now();
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, status: null, ms: 0, finalUrl: current, error: 'Ungültige URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, status: null, ms: 0, finalUrl: current, error: 'Nur http(s) wird geprüft' };
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return { ok: false, status: null, ms: Date.now() - started, finalUrl: current, error: 'Hostname nicht auflösbar' };
    }
    if (addresses.some(isForbidden)) return { ok: false, status: null, ms: 0, finalUrl: current, error: 'Ziel-Adresse ist aus Sicherheitsgründen gesperrt' };
    if (!opts.allowPrivate && addresses.some(isPrivate)) return { ok: false, status: null, ms: 0, finalUrl: current, error: 'Private Netzwerkadressen sind deaktiviert' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
    try {
      let res = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'OMEGA-Infinity-AppCheck/1.0' } });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'OMEGA-Infinity-AppCheck/1.0', range: 'bytes=0-0' } });
        await res.body?.cancel();
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      const ms = Date.now() - started;
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, ms, finalUrl: current };
      if (res.status === 401 || res.status === 403) return { ok: true, status: res.status, ms, finalUrl: current, note: 'Erreichbar – Anmeldung erforderlich' };
      return { ok: false, status: res.status, ms, finalUrl: current, error: `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      return { ok: false, status: null, ms: Date.now() - started, finalUrl: current, error: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.cause?.code ?? err.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: null, ms: Date.now() - started, finalUrl: current, error: 'Zu viele Weiterleitungen' };
}
