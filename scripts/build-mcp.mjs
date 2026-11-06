import { build } from 'esbuild';

await build({
  entryPoints: ['mcp/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/mcp/index.js',
  packages: 'external',
  alias: { '@shared': './shared/src' },
  banner: { js: '#!/usr/bin/env node' },
});
console.log('mcp built → dist/mcp/index.js');
