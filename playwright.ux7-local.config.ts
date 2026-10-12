import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: 'artifacts/playwright-ux7-visual',
  reporter: 'list',
  use: { baseURL: 'http://localhost:8083', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
});
