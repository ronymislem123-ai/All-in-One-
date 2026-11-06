type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS = /token|secret|password|authorization|cookie|key/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(minLevel: Level = 'info', sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const log = (level: Level, msg: string, data?: unknown) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg };
    if (data !== undefined) entry.data = scrub(data);
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, d) => log('debug', m, d),
    info: (m, d) => log('info', m, d),
    warn: (m, d) => log('warn', m, d),
    error: (m, d) => log('error', m, d),
  };
}
