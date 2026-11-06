import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors';
import type { ApiTokenScope } from '@shared/domain';

export interface Vars {
  user: (AuthUser & { sessionId?: string }) | null;
  authKind: 'session' | 'token' | null;
  scopes: ApiTokenScope[];
  tokenName: string | null;
  ip: string;
}
export type Env = { Variables: Vars };
export type App = Hono<Env>;
export type C = Context<Env>;

export async function body<T extends z.ZodTypeAny>(c: C, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Ungültiger JSON-Body.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw badRequest('Eingaben sind ungültig.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function query<T extends z.ZodTypeAny>(c: C, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw badRequest('Ungültige Parameter.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

/** Owner session required (cookie). Tokens are only accepted on the ingest endpoints. */
export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user') || c.get('authKind') !== 'session') throw unauthorized();
  await next();
};

export function requireScope(scope: ApiTokenScope): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) throw unauthorized('Anmeldung oder API-Token erforderlich.');
    if (c.get('authKind') === 'token' && !c.get('scopes').includes(scope)) throw forbidden(`Token benötigt den Bereich „${scope}“.`);
    await next();
  };
}

export const meUser = (c: C): AuthUser & { sessionId?: string } => {
  const u = c.get('user');
  if (!u) throw unauthorized();
  return u;
};

export { AppError };
