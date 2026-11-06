import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) },
  },
  test: {
    include: ['server/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    pool: 'forks',
  },
});
