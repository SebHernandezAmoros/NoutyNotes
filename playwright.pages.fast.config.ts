import { defineConfig, devices } from '@playwright/test';
import pagesConfig from './playwright.pages.config';

const publicationSmoke = /inicio responsive, temas y las acciones activas/;

/** Carga, recursos, tema y entrada principal del export publicado, en dos anchos. */
export default defineConfig({
  ...pagesConfig,
  grep: publicationSmoke,
  outputDir: 'artifacts/playwright-pages-fast',
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
