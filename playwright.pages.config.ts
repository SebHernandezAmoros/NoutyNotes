import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Reutiliza proyectos y pruebas, pero sustituye el servidor: defineConfig(config, overrides)
// fusionaría el webServer heredado y arrancaría también Metro en 8081. Solo se sirve el export.
export default defineConfig({
  ...config,
  outputDir: 'artifacts/playwright-pages',
  use: { ...config.use, baseURL: 'http://127.0.0.1:8082/NoutyNotes/' },
  webServer: {
    command: 'node scripts/preview-pages.mjs',
    url: 'http://127.0.0.1:8082/NoutyNotes/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
