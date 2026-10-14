import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

const desktopCritical = /(inicio responsive|P18-E3-B2: alterna Visual y HTML|carpeta web: crear|UX7-CONSOLIDATION: un fallo de escritura|ZIP: la imagen importada)/;
const mobileCritical = /(inicio responsive|P18-E3-B2: alterna Visual y HTML|ZIP: la imagen importada)/;

/** Smoke diario deliberadamente pequeño. La matriz completa permanece en playwright.config.ts. */
export default defineConfig({
  ...config,
  outputDir: 'artifacts/playwright-fast',
  projects: [
    {
      name: 'desktop',
      grep: desktopCritical,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'mobile',
      grep: mobileCritical,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
