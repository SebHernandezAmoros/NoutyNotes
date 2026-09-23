import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  outputDir: 'artifacts/playwright-pages',
  use: { baseURL: 'http://127.0.0.1:8082/NoutyNotes/' },
  webServer: {
    command: 'node scripts/preview-pages.mjs',
    url: 'http://127.0.0.1:8082/NoutyNotes/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
