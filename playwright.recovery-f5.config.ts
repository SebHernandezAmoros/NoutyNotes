import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Navegador instalado, sin descargar dependencias; conserva arnés OPFS y aserciones.
// F5_CHANNEL permite contrastar el cierre observado en Chromium empaquetado con Chrome.
export default defineConfig(base, {
  testMatch: 'recovery-f5.spec.ts',
  use: { channel: process.env.F5_CHANNEL ?? 'chrome' },
  outputDir: 'artifacts/recovery-f5/playwright',
});
