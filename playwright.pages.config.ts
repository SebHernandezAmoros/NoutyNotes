import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Reutiliza proyectos y pruebas, sin el servidor de desarrollo heredado.
// El preview vive en setup/teardown de Playwright para cerrar sus conexiones sin proceso hijo.
const pagesConfig = { ...config };
delete pagesConfig.webServer;
export default defineConfig({
  ...pagesConfig,
  outputDir: 'artifacts/playwright-pages',
  use: { ...config.use, baseURL: 'http://127.0.0.1:8082/NoutyNotes/' },
  globalSetup: './scripts/preview-pages-setup.mjs',
});
