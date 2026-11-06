import type { Ctx } from '../../context';
import { nowIso } from '../../lib/time';

export class GitHubError extends Error {
  constructor(public status: number, message: string, public retryAfterSec?: number) {
    super(message);
  }
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  updatedAt: string | null;
}

/**
 * Minimal, read-only GitHub REST client.
 *  - Only GET requests are implemented – the integration cannot modify repositories (§10.3).
 *  - Conditional requests (ETag) so unchanged data does not consume rate limit.
 *  - Pagination via Link headers, rate-limit tracking, bounded retries with backoff for 5xx/secondary limits.
 */
export class GitHubClient {
  static rate: RateLimitState = { limit: null, remaining: null, resetAt: null, updatedAt: null };

  constructor(private ctx: Ctx, private token: string | null) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'OMEGA-Infinity (read-only)',
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.ctx.config.github.apiUrl}${path}`;
  }

  private trackRate(res: Response) {
    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      GitHubClient.rate = {
        limit: limit ? Number(limit) : null,
        remaining: Number(remaining),
        resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
        updatedAt: nowIso(),
      };
    }
  }

  private async raw(path: string, init: { headers?: Record<string, string>; accept?: string } = {}): Promise<Response> {
    const rate = GitHubClient.rate;
    if (rate.remaining === 0 && rate.resetAt && new Date(rate.resetAt) > new Date()) {
      throw new GitHubError(429, `GitHub-Rate-Limit erschöpft bis ${rate.resetAt}`, Math.ceil((new Date(rate.resetAt).getTime() - Date.now()) / 1000));
    }
    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        res = await fetch(this.url(path), {
          method: 'GET',
          headers: this.headers({ ...(init.accept ? { accept: init.accept } : {}), ...init.headers }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
        throw new GitHubError(0, `GitHub nicht erreichbar: ${(e as Error & { cause?: { code?: string } }).cause?.code ?? (e as Error).message}`);
      }
      this.trackRate(res);
      const retryAfter = Number(res.headers.get('retry-after') ?? '0');
      const secondary = (res.status === 403 || res.status === 429) && (retryAfter > 0 || res.headers.get('x-ratelimit-remaining') === '0');
      if ((res.status >= 500 || secondary) && attempt < 3) {
        await sleep(Math.min((retryAfter || 2 ** attempt) * 1000, 10_000));
        continue;
      }
      return res;
    }
  }

  private async fail(res: Response): Promise<never> {
    let message = `GitHub-Antwort ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = `${message}: ${body.message}`;
    } catch { /* ignore */ }
    throw new GitHubError(res.status, message, Number(res.headers.get('retry-after') ?? '') || undefined);
  }

  /** GET JSON with ETag caching (304 → cached body, no rate-limit cost). */
  async get<T>(path: string, opts: { cache?: boolean } = {}): Promise<{ data: T; notModified: boolean }> {
    const key = this.url(path);
    const cached = opts.cache ? this.ctx.db.get<{ etag: string | null; body: string }>('SELECT etag, body FROM http_cache WHERE url = ?', [key]) : undefined;
    const res = await this.raw(path, { headers: cached?.etag ? { 'if-none-match': cached.etag } : {} });
    if (res.status === 304 && cached) return { data: JSON.parse(cached.body) as T, notModified: true };
    if (!res.ok) await this.fail(res);
    const text = await res.text();
    if (opts.cache && res.headers.get('etag')) {
      this.ctx.db.run(
        'INSERT INTO http_cache(url, etag, body, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, body = excluded.body, fetched_at = excluded.fetched_at',
        [key, res.headers.get('etag'), text, nowIso()],
      );
    }
    return { data: JSON.parse(text) as T, notModified: false };
  }

  /** Follows Link: rel="next" up to maxPages. */
  async paginate<T>(path: string, maxPages = 10): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    for (let page = 0; next && page < maxPages; page++) {
      const res = await this.raw(next);
      if (!res.ok) await this.fail(res);
      out.push(...((await res.json()) as T[]));
      const link = res.headers.get('link') ?? '';
      next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
    }
    return out;
  }

  /** Raw file content (text). */
  async getRawFile(fullName: string, path: string, ref: string): Promise<{ text: string; size: number } | null> {
    const res = await this.raw(`/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, {
      accept: 'application/vnd.github.raw+json',
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res);
    const buf = Buffer.from(await res.arrayBuffer());
    return { text: buf.toString('utf8'), size: buf.length };
  }

  /** Downloads the repository tarball for a commit (one request instead of one per file). */
  async getTarball(fullName: string, ref: string, maxBytes: number): Promise<Buffer> {
    const res = await this.raw(`/repos/${fullName}/tarball/${encodeURIComponent(ref)}`);
    if (!res.ok) await this.fail(res);
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len && len > maxBytes) throw new GitHubError(413, `Repository-Archiv zu groß (${Math.round(len / 1e6)} MB > ${Math.round(maxBytes / 1e6)} MB)`);
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GitHubError(413, `Repository-Archiv zu groß (> ${Math.round(maxBytes / 1e6)} MB)`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
