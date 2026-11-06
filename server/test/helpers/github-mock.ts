import { createServer, type Server } from 'node:http';
import { createGzip } from 'node:zlib';
import tar from 'tar-stream';

export interface MockRepo {
  id: number;
  fullName: string;
  defaultBranch?: string;
  head: string;
  files: Record<string, string>;
  private?: boolean;
}

/** Builds a GitHub-style tarball ("<owner>-<repo>-<sha>/…" prefix) in memory. */
export async function makeTarball(prefix: string, files: Record<string, string>): Promise<Buffer> {
  const pack = tar.pack();
  for (const [path, content] of Object.entries(files)) pack.entry({ name: `${prefix}/${path}` }, content);
  pack.finalize();
  const gz = pack.pipe(createGzip());
  const chunks: Buffer[] = [];
  for await (const c of gz) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * A tiny fake of the GitHub REST endpoints OMEGA uses (all GET). Records every request so tests can
 * assert that no write method is ever used.
 */
export async function startGitHubMock(repos: MockRepo[]) {
  const state = { repos: new Map(repos.map((r) => [r.fullName.toLowerCase(), r])), requests: [] as { method: string; url: string; auth: string | undefined }[], etagHits: 0, gone: new Set<string>() };
  const byId = () => new Map([...state.repos.values()].map((r) => [r.id, r]));
  const server: Server = createServer(async (req, res) => {
    state.requests.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization });
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600), ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { message: 'read-only mock' });
    let m = /^\/repositories\/(\d+)(.*)$/.exec(url.pathname);
    let repo: MockRepo | undefined;
    let rest = '';
    if (m) { repo = byId().get(Number(m[1])); rest = m[2]; }
    else {
      m = /^\/repos\/([^/]+\/[^/]+)(.*)$/.exec(url.pathname);
      if (m) { repo = state.repos.get(m[1].toLowerCase()); rest = m[2]; }
    }
    if (url.pathname === '/user/repos') {
      return send(200, [...state.repos.values()].map((r) => meta(r)));
    }
    if (!repo || state.gone.has(repo.fullName.toLowerCase())) return send(404, { message: 'Not Found' });
    const etag = `"${repo.head}"`;
    if (rest === '') {
      if (req.headers['if-none-match'] === etag) { state.etagHits++; res.writeHead(304, { etag }); return res.end(); }
      return send(200, meta(repo), { etag });
    }
    if (rest === '/languages') return send(200, { TypeScript: 1000, CSS: 100 });
    if (rest === '/branches') return send(200, [{ name: repo.defaultBranch ?? 'main', commit: { sha: repo.head }, protected: false }]);
    if (rest === '/commits') return send(200, [{ sha: repo.head, html_url: `https://github.com/${repo.fullName}/commit/${repo.head}`, commit: { message: `Commit ${repo.head}`, author: { name: 'Dev', date: new Date().toISOString() } }, author: { login: 'dev' } }]);
    if (rest.startsWith('/git/trees/')) {
      const dirs = new Set<string>();
      for (const p of Object.keys(repo.files)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      return send(200, { sha: repo.head, truncated: false, tree: [
        ...[...dirs].map((d) => ({ path: d, type: 'tree', sha: `t-${d}` })),
        ...Object.entries(repo.files).map(([p, c]) => ({ path: p, type: 'blob', size: Buffer.byteLength(c), sha: `b-${p}-${repo.head}` })),
      ] });
    }
    if (rest.startsWith('/tarball/')) {
      const tgz = await makeTarball(`${repo.fullName.replace('/', '-')}-${repo.head}`, repo.files);
      res.writeHead(200, { 'content-type': 'application/x-gzip', 'content-length': String(tgz.length) });
      return res.end(tgz);
    }
    if (rest.startsWith('/contents/')) {
      const p = decodeURIComponent(rest.slice('/contents/'.length));
      const file = repo.files[p];
      if (file === undefined) return send(404, { message: 'Not Found' });
      res.writeHead(200, { 'content-type': 'application/vnd.github.raw' });
      return res.end(file);
    }
    return send(404, { message: 'Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function meta(r: MockRepo) {
  const [owner, name] = r.fullName.split('/');
  return {
    id: r.id, name, full_name: r.fullName, owner: { login: owner }, description: `Repo ${name}`, html_url: `https://github.com/${r.fullName}`,
    default_branch: r.defaultBranch ?? 'main', private: Boolean(r.private), fork: false, archived: false, language: 'TypeScript', topics: ['omega'],
    size: 10, stargazers_count: 1, open_issues_count: 0, pushed_at: new Date().toISOString(), created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(),
  };
}
