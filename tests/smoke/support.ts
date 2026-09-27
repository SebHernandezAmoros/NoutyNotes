import type { Locator, Page } from '@playwright/test';

/** Errores de ejecución y recursos fallidos durante una prueba. */
export function trackProblems(page: Page) {
  const runtimeErrors: string[] = [];
  const failedResources: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => failedResources.push(request.url()));
  return { runtimeErrors, failedResources };
}

export function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

export const borderColor = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).borderTopColor);

export const activeLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null);

export const hasHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** Móvil (< 800 px): las secciones están en «Más». Se decide por el ancho, no por lo que ya se ve: justo tras abrir un proyecto la barra puede no estar pintada. */
export const isCompactWidth = (page: Page) => (page.viewportSize()?.width ?? 0) < 800;

export async function openMore(page: Page) {
  if (isCompactWidth(page)) await page.getByRole('button', { name: 'Más secciones', exact: true }).click();
}

/** Configuración: en móvil está dentro de «Más» (ADR 0022); en escritorio, en la barra o la barra lateral. */
export async function openSettings(page: Page) {
  await openMore(page);
  await page.getByRole('button', { name: 'Abrir la configuración', exact: true }).click();
}
