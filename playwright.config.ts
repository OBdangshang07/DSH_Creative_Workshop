import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.CI ? {} : { channel: 'msedge' }),
  },
  webServer: [
    {
      command: 'pnpm exec tsx scripts/seed-e2e.ts && pnpm --filter @dsh-workshop/api build && node apps/api/dist/server.js',
      port: 4100,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test', WORKSHOP_API_HOST: '127.0.0.1', WORKSHOP_API_PORT: '4100',
        WORKSHOP_ALLOWED_ORIGINS: 'http://127.0.0.1:4273', WORKSHOP_DATABASE_FILE: resolve('.visual-check/e2e.sqlite'),
      },
    },
    { command: 'node scripts/preview.mjs', port: 4273, reuseExistingServer: false, env: { WORKSHOP_PREVIEW_PORT: '4273' } },
  ],
})
