import { defineConfig, devices } from '@playwright/test';

const PORT = 4410;
const DATA = 'e2e/.artifacts';

/**
 * End-to-end tests against the production build (server + built web app).
 * Run: npm run build:web && npm run test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    colorScheme: 'dark',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    // fresh, isolated data directory for every run
    command: `rm -rf ${DATA} && node --import tsx server/src/index.ts`,
    url: `http://127.0.0.1:${PORT}/api/system/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      OMEGA_PORT: String(PORT),
      OMEGA_DATA_DIR: `${DATA}/data`,
      OMEGA_BACKUP_DIR: `${DATA}/backups`,
      OMEGA_SETUP_CODE: 'E2E-SETUP',
      OMEGA_WEB_DIST: 'dist/web',
      OMEGA_SCHEDULER: '0',
      NODE_ENV: 'production',
    },
  },
});
