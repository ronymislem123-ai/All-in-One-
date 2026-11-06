import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { posix } from 'node:path';
import tar from 'tar-stream';
import { isSecretPath } from '../../lib/redact';

/**
 * Static, read-only code analysis of a repository archive.
 * Only facts that can be read from the source are recorded (imports, exports, manifests).
 * Roles (frontend/backend/…) are heuristics and are always labelled "vermutet" in the UI.
 */

export const IGNORED_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|vendor|\.next|\.nuxt|coverage|__pycache__|\.venv|venv|target|\.turbo|\.cache|bower_components)(\/|$)/;
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/;
const MAX_FILE_BYTES = 512 * 1024;

const LANG_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', cs: 'C#',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cc: 'C++', swift: 'Swift', dart: 'Dart', css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less',
  html: 'HTML', md: 'Markdown', mdx: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', sql: 'SQL', sh: 'Shell',
  bash: 'Shell', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL', xml: 'XML', ini: 'INI', dockerfile: 'Docker',
};
const TEXT_EXT = new Set(Object.keys(LANG_BY_EXT).concat(['txt', 'env', 'gitignore', 'lock', 'cfg', 'conf']));

export function languageOf(path: string): string | null {
  const base = posix.basename(path).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'Docker';
  if (base === 'makefile') return 'Make';
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return LANG_BY_EXT[ext] ?? null;
}

export type Role = 'frontend' | 'backend' | 'api' | 'database' | 'shared' | 'tests' | 'config' | 'docs' | 'scripts' | 'assets' | 'other';
export const ROLE_LABELS: Record<Role, string> = {
  frontend: 'Frontend', backend: 'Backend', api: 'API / Schnittstellen', database: 'Datenbank', shared: 'Gemeinsamer Code', tests: 'Tests',
  config: 'Konfiguration', docs: 'Dokumentation', scripts: 'Skripte & Werkzeuge', assets: 'Assets', other: 'Sonstiges',
};

/** Heuristic role from path/extension – a guess, never presented as fact. */
export function classifyRole(path: string): Role {
  const p = path.toLowerCase();
  const base = posix.basename(p);
  if (/(^|\/)(__tests__|tests?|spec|specs|e2e|cypress|playwright)(\/|$)/.test(p) || /\.(test|spec)\.[a-z0-9]+$/.test(p)) return 'tests';
  if (/(^|\/)(docs?|documentation)(\/|$)/.test(p) || /\.(md|mdx|rst|txt)$/.test(p)) return 'docs';
  if (/(^|\/)(migrations?|db|database|prisma|schema|seeds?)(\/|$)/.test(p) || /\.(sql|prisma)$/.test(p)) return 'database';
  if (/(^|\/)(\.github|\.vscode|\.devcontainer)(\/|$)/.test(p) || /^(package\.json|tsconfig.*\.json|vite\.config\.[a-z]+|vitest\.config\.[a-z]+|playwright\.config\.[a-z]+|\.eslintrc.*|\.prettierrc.*|dockerfile|docker-compose\.ya?ml|makefile|pyproject\.toml|go\.mod|cargo\.toml|\.gitignore|\.editorconfig|.*\.config\.[cm]?[jt]s)$/.test(base)) return 'config';
  if (/(^|\/)(scripts?|bin|tools)(\/|$)/.test(p) || /\.(sh|bash)$/.test(p)) return 'scripts';
  if (/(^|\/)(routes?|api|controllers?|handlers?|endpoints?|webhooks?)(\/|$)/.test(p)) return 'api';
  if (/(^|\/)(shared|common|types|contracts|protocol)(\/|$)/.test(p)) return 'shared';
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp3|mp4|webm)$/.test(p) || /(^|\/)(assets|public|static)(\/|$)/.test(p)) return 'assets';
  if (/(^|\/)(web|client|frontend|ui|components?|pages|views|layouts?|styles?|hooks|features)(\/|$)/.test(p) || /\.(tsx|jsx|vue|svelte|css|scss|less|html)$/.test(p)) return 'frontend';
  if (/(^|\/)(server|backend|services?|core|lib|modules|domain|jobs|workers?|mcp|cmd|internal|pkg)(\/|$)/.test(p) || /\.(py|go|rs|java|kt|rb|php|cs)$/.test(p)) return 'backend';
  return 'other';
}

// ── Import / export extraction ─────────────────────────────────────────────
const JS_IMPORT = [
  /\bimport\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const JS_EXPORT = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm,
];

function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

export interface FileFacts {
  imports: string[];
  exports: string[];
}

export function extractFacts(path: string, src: string): FileFacts {
  const lang = languageOf(path);
  const imports = new Set<string>();
  const exports = new Set<string>();
  const add = (set: Set<string>, re: RegExp, text: string) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) if (m[1]) set.add(m[1]);
  };
  switch (lang) {
    case 'TypeScript':
    case 'JavaScript':
    case 'Vue':
    case 'Svelte': {
      const code = stripJsComments(src);
      for (const re of JS_IMPORT) add(imports, re, code);
      for (const re of JS_EXPORT) add(exports, re, code);
      const named = /\bexport\s*\{([^}]*)\}(?!\s*from)/g;
      for (let m = named.exec(code); m; m = named.exec(code)) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
        }
      }
      break;
    }
    case 'Python': {
      for (const line of src.split('\n')) {
        const from = /^\s*from\s+(\.*[\w.]*)\s+import\s+/.exec(line);
        if (from) { imports.add(from[1]); continue; }
        const imp = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
        if (imp) imp[1].split(',').forEach((x) => imports.add(x.trim().split(/\s+as\s+/)[0]));
        const def = /^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/.exec(line);
        if (def && !def[1].startsWith('_')) exports.add(def[1]);
      }
      break;
    }
    case 'Go': {
      const block = /import\s*\(([\s\S]*?)\)/g;
      for (let m = block.exec(src); m; m = block.exec(src)) for (const q of m[1].matchAll(/"([^"]+)"/g)) imports.add(q[1]);
      for (const q of src.matchAll(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm)) imports.add(q[1]);
      for (const q of src.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)) exports.add(q[1]);
      break;
    }
    case 'Rust':
      for (const q of src.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm)) imports.add(`mod:${q[1]}`);
      for (const q of src.matchAll(/^\s*use\s+([\w:]+)/gm)) imports.add(q[1]);
      for (const q of src.matchAll(/^\s*pub\s+(?:fn|struct|enum|trait)\s+(\w+)/gm)) exports.add(q[1]);
      break;
    case 'CSS':
    case 'SCSS':
    case 'Less':
      for (const q of src.matchAll(/@(?:import|use|forward)\s+(?:url\()?['"]([^'"]+)['"]/g)) imports.add(q[1]);
      break;
    case 'Java':
    case 'Kotlin':
      for (const q of src.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)/gm)) imports.add(q[1]);
      break;
    case 'Ruby':
      for (const q of src.matchAll(/require_relative\s+['"]([^'"]+)['"]/g)) imports.add(`./${q[1]}`);
      break;
    case 'C':
    case 'C++':
      for (const q of src.matchAll(/^\s*#include\s+"([^"]+)"/gm)) imports.add(`./${q[1]}`);
      break;
    case 'PHP':
      for (const q of src.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)) imports.add(q[1].startsWith('.') ? q[1] : `./${q[1]}`);
      break;
  }
  return { imports: [...imports].slice(0, 200), exports: [...exports].slice(0, 40) };
}

// ── Resolution ─────────────────────────────────────────────────────────────
const JS_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.vue', '.svelte', '.json', '.css', '.scss', '.d.ts'];
const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream', 'zlib', 'child_process', 'events', 'net', 'dns', 'tls', 'assert', 'buffer', 'process', 'readline', 'worker_threads', 'module', 'timers', 'querystring', 'perf_hooks', 'vm', 'v8', 'cluster', 'dgram', 'inspector']);

export interface ResolveContext {
  files: Set<string>;
  dirs: Set<string>;
  aliases: { prefix: string; targets: string[] }[];
  goModule: string | null;
}

function tryJs(base: string, files: Set<string>): string | null {
  const norm = posix.normalize(base).replace(/^\.\//, '');
  for (const ext of JS_EXTS) if (files.has(norm + ext)) return norm + ext;
  for (const ext of JS_EXTS.slice(1)) if (files.has(`${norm}/index${ext}`)) return `${norm}/index${ext}`;
  // TS sources importing "./x.js" that actually is "./x.ts"
  const noExt = norm.replace(/\.(m?js|cjs|jsx)$/, '');
  if (noExt !== norm) for (const ext of ['.ts', '.tsx', '.mts']) if (files.has(noExt + ext)) return noExt + ext;
  return null;
}

/** Returns { internal } for repo files/dirs or { external } for packages. */
export function resolveImport(fromPath: string, spec: string, rc: ResolveContext): { internal?: string; external?: string } {
  const lang = languageOf(fromPath);
  const dir = posix.dirname(fromPath);
  if (lang === 'Python') {
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)![0].length;
      let base = dir;
      for (let i = 1; i < dots; i++) base = posix.dirname(base);
      const rest = spec.slice(dots).replace(/\./g, '/');
      const target = rest ? posix.join(base, rest) : base;
      for (const cand of [`${target}.py`, `${target}/__init__.py`]) if (rc.files.has(cand.replace(/^\.\//, ''))) return { internal: cand.replace(/^\.\//, '') };
      if (rc.dirs.has(target)) return { internal: target };
      return {};
    }
    const p = spec.replace(/\./g, '/');
    for (const root of ['', 'src/', 'app/', 'lib/']) {
      for (const cand of [`${root}${p}.py`, `${root}${p}/__init__.py`]) if (rc.files.has(cand)) return { internal: cand };
    }
    return { external: spec.split('.')[0] };
  }
  if (lang === 'Go') {
    if (rc.goModule && spec.startsWith(rc.goModule + '/')) {
      const d = spec.slice(rc.goModule.length + 1);
      return rc.dirs.has(d) ? { internal: d } : {};
    }
    return { external: spec };
  }
  if (lang === 'Rust') {
    if (spec.startsWith('mod:')) {
      const name = spec.slice(4);
      for (const cand of [posix.join(dir, `${name}.rs`), posix.join(dir, name, 'mod.rs')]) if (rc.files.has(cand)) return { internal: cand };
      return {};
    }
    const root = spec.split('::')[0];
    return ['crate', 'self', 'super', 'std', 'core', 'alloc'].includes(root) ? {} : { external: root };
  }
  if (lang === 'Java' || lang === 'Kotlin') {
    const p = spec.replace(/\./g, '/');
    const hit = [...rc.files].find((f) => f.endsWith(`${p}.java`) || f.endsWith(`${p}.kt`));
    return hit ? { internal: hit } : { external: spec.split('.').slice(0, 2).join('.') };
  }
  // JS/TS/CSS family
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const hit = tryJs(spec.startsWith('/') ? spec.slice(1) : posix.join(dir, spec), rc.files);
    return hit ? { internal: hit } : {};
  }
  for (const a of rc.aliases) {
    if (spec === a.prefix || spec.startsWith(a.prefix)) {
      const rest = spec.slice(a.prefix.length);
      for (const t of a.targets) {
        const hit = tryJs(posix.join(t, rest), rc.files);
        if (hit) return { internal: hit };
      }
    }
  }
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0])) return { external: `node:${spec.replace(/^node:/, '').split('/')[0]}` };
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return { external: pkg };
}

/** Parses tsconfig/jsconfig "paths" (comments allowed) into alias prefixes. */
export function parseTsPaths(configPath: string, text: string): { prefix: string; targets: string[] }[] {
  try {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/[^\n]*/g, '$1').replace(/,\s*([}\]])/g, '$1');
    const json = JSON.parse(clean) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const base = posix.join(posix.dirname(configPath), json.compilerOptions?.baseUrl ?? '.');
    return Object.entries(json.compilerOptions?.paths ?? {}).map(([k, v]) => ({
      prefix: k.replace(/\*$/, ''),
      targets: v.map((t) => posix.normalize(posix.join(base, t.replace(/\*$/, ''))).replace(/^\.\//, '').replace(/^\.$/, '')),
    }));
  } catch {
    return [];
  }
}

// ── Manifests ──────────────────────────────────────────────────────────────
export interface Dependency { manifest: string; ecosystem: string; name: string; version: string | null; dev: boolean }

export function parseManifest(path: string, text: string): Dependency[] {
  const base = posix.basename(path);
  const out: Dependency[] = [];
  try {
    if (base === 'package.json') {
      const j = JSON.parse(text) as Record<string, Record<string, string>>;
      for (const [n, v] of Object.entries(j.dependencies ?? {})) out.push({ manifest: path, ecosystem: 'npm', name: n, version: v, dev: false });
      for (const [n, v] of Object.entries(j.devDependencies ?? {})) out.push({ manifest: path, ecosystem: 'npm', name: n, version: v, dev: true });
    } else if (base === 'requirements.txt') {
      for (const line of text.split('\n')) {
        const m = /^\s*([A-Za-z0-9_.\-[\]]+)\s*([<>=!~].*)?$/.exec(line.split('#')[0]);
        if (m && m[1]) out.push({ manifest: path, ecosystem: 'pypi', name: m[1], version: m[2]?.trim() ?? null, dev: false });
      }
    } else if (base === 'go.mod') {
      for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\w.\-+]+)/gm)) out.push({ manifest: path, ecosystem: 'go', name: m[1], version: m[2], dev: false });
    } else if (base === 'Cargo.toml') {
      const sec = /\[(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g;
      for (let m = sec.exec(text); m; m = sec.exec(text)) {
        for (const d of m[2].matchAll(/^\s*([\w-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")?/gm)) {
          out.push({ manifest: path, ecosystem: 'cargo', name: d[1], version: d[2] ?? d[3] ?? null, dev: Boolean(m[1]) });
        }
      }
    } else if (base === 'pyproject.toml') {
      const deps = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
      for (const d of deps?.[1].matchAll(/"([A-Za-z0-9_.\-[\]]+)\s*([^"]*)"/g) ?? []) out.push({ manifest: path, ecosystem: 'pypi', name: d[1], version: d[2] || null, dev: false });
    } else if (base === 'composer.json') {
      const j = JSON.parse(text) as Record<string, Record<string, string>>;
      for (const [n, v] of Object.entries(j.require ?? {})) out.push({ manifest: path, ecosystem: 'composer', name: n, version: v, dev: false });
    } else if (base === 'Gemfile') {
      for (const m of text.matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm)) out.push({ manifest: path, ecosystem: 'rubygems', name: m[1], version: m[2] ?? null, dev: false });
    }
  } catch { /* malformed manifest – ignore */ }
  return out.slice(0, 500);
}
const MANIFESTS = new Set(['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'composer.json', 'Gemfile']);

// ── Archive analysis ───────────────────────────────────────────────────────
export interface AnalyzedFile {
  path: string;
  language: string | null;
  lines: number | null;
  size: number;
  imports: string[];
  externalImports: string[];
  exports: string[];
  role: Role;
  excludedReason: string | null;
}

export interface AnalysisResult {
  files: AnalyzedFile[];
  dependencies: Dependency[];
  stats: { analyzed: number; secretExcluded: number; tooLarge: number; vendored: number; binaryOrOther: number; edges: number; languages: Record<string, number>; externalPackages: number };
}

/** Reads a GitHub tarball (gzip) entirely in memory with strict per-file limits. */
export async function analyzeTarball(tgz: Buffer): Promise<AnalysisResult> {
  const sources = new Map<string, string>();
  const meta = new Map<string, { size: number; excluded: string | null }>();
  const extract = tar.extract();
  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const full = header.name.split('/').slice(1).join('/'); // strip "<owner>-<repo>-<sha>/"
      const size = header.size ?? 0;
      if (header.type !== 'file' || !full) { stream.resume(); stream.on('end', next); return; }
      let excluded: string | null = null;
      if (IGNORED_DIRS.test(full)) excluded = 'vendored';
      else if (isSecretPath(full)) excluded = 'secret';
      else if (LOCKFILES.test(full)) excluded = 'lockfile';
      else if (size > MAX_FILE_BYTES) excluded = 'too_large';
      else {
        const base = posix.basename(full).toLowerCase();
        const ext = base.includes('.') ? base.split('.').pop()! : base;
        if (!TEXT_EXT.has(ext) && !languageOf(full)) excluded = 'binary_or_other';
      }
      meta.set(full, { size, excluded });
      if (excluded) { stream.resume(); stream.on('end', next); return; }
      const chunks: Buffer[] = [];
      stream.on('data', (c: unknown) => { chunks.push(c as Buffer); });
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.subarray(0, 8000).includes(0)) meta.set(full, { size, excluded: 'binary_or_other' });
        else sources.set(full, buf.toString('utf8'));
        next();
      });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });
  Readable.from(tgz).pipe(createGunzip()).on('error', (e) => extract.destroy(e)).pipe(extract);
  await done;

  const filesSet = new Set(meta.keys());
  const dirs = new Set<string>();
  for (const f of filesSet) for (let d = posix.dirname(f); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  const aliases: ResolveContext['aliases'] = [];
  for (const [p, src] of sources) if (/(^|\/)(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(p)) aliases.push(...parseTsPaths(p, src));
  const goMod = [...sources.entries()].find(([p]) => p === 'go.mod')?.[1];
  const rc: ResolveContext = { files: filesSet, dirs, aliases, goModule: goMod ? /^module\s+(\S+)/m.exec(goMod)?.[1] ?? null : null };

  const files: AnalyzedFile[] = [];
  const dependencies: Dependency[] = [];
  const stats = { analyzed: 0, secretExcluded: 0, tooLarge: 0, vendored: 0, binaryOrOther: 0, edges: 0, languages: {} as Record<string, number>, externalPackages: 0 };
  const externals = new Set<string>();
  for (const [path, m] of meta) {
    if (m.excluded === 'vendored') { stats.vendored++; continue; }
    if (m.excluded === 'secret') stats.secretExcluded++;
    if (m.excluded === 'too_large') stats.tooLarge++;
    if (m.excluded === 'binary_or_other') stats.binaryOrOther++;
    const src = sources.get(path);
    const language = languageOf(path);
    let imports: string[] = [];
    let externalImports: string[] = [];
    let exports: string[] = [];
    if (src !== undefined) {
      stats.analyzed++;
      if (language) stats.languages[language] = (stats.languages[language] ?? 0) + 1;
      if (MANIFESTS.has(posix.basename(path)) && !IGNORED_DIRS.test(path)) dependencies.push(...parseManifest(path, src));
      const facts = extractFacts(path, src);
      exports = facts.exports;
      const internal = new Set<string>();
      const external = new Set<string>();
      for (const spec of facts.imports) {
        const r = resolveImport(path, spec, rc);
        if (r.internal && r.internal !== path) internal.add(r.internal);
        else if (r.external) external.add(r.external);
      }
      imports = [...internal];
      externalImports = [...external];
      stats.edges += imports.length;
      externalImports.forEach((x) => externals.add(x));
    }
    files.push({
      path, language, size: m.size, lines: src !== undefined ? src.split('\n').length : null,
      imports, externalImports, exports, role: classifyRole(path), excludedReason: m.excluded === 'vendored' ? null : m.excluded,
    });
  }
  stats.externalPackages = externals.size;
  return { files, dependencies, stats };
}
