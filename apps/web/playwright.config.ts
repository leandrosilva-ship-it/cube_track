import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: API (com gateway realtime embutido) + web em modo produção, contra o banco de demonstração
 * semeado (`pnpm db:reset && pnpm db:seed`). Dois navegadores simultâneos validam o tempo real.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3001);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --enable-source-maps --import ./dist/instrumentation.js dist/main.js',
      cwd: '../api',
      url: `http://localhost:${String(API_PORT)}/health/ready`,
      reuseExistingServer: process.env.CI === undefined,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        REALTIME_MODE: 'embedded',
        LOG_LEVEL: 'warn',
        OTEL_SDK_DISABLED: 'true',
      },
    },
    {
      command: `npx next start -p ${String(WEB_PORT)}`,
      url: `http://localhost:${String(WEB_PORT)}/login`,
      reuseExistingServer: process.env.CI === undefined,
      timeout: 120_000,
      env: { API_INTERNAL_URL: `http://localhost:${String(API_PORT)}` },
    },
  ],
});
