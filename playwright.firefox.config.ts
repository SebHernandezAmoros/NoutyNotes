import { defineConfig, devices } from '@playwright/test';
import pagesConfig from './playwright.pages.config';

// Mismas pruebas web contra el export de Pages en Firefox, un navegador sin File System Access
// (ADR 0011). Requiere `pnpm exec playwright install firefox` una vez por entorno.
export default defineConfig({
  ...pagesConfig,
  outputDir: 'artifacts/playwright-firefox',
  projects: [
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 900 } } },
    { name: 'firefox-390', use: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 } } },
  ],
});
