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

/** Abre el editor completo desde el botón contextual de una tarjeta (ADR 0047). */
export async function openFullCardEditor(page: Page, actions: Locator) {
  const inline = page.getByTestId('inline-card-editor');
  if (await inline.isVisible()) {
    await inline.getByRole('button', { name: 'Abrir el editor completo', exact: true }).first().click();
    await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
    return;
  }
  const trigger = await actions.count() > 0 ? actions : page.getByRole('button', { name: /^Acciones de / }).last();
  // Activar por teclado evita que un minimapa o control flotante tape físicamente el botón de acciones.
  // `onFocus` puede recentrar el lienzo y volver a renderizar el control. `locator.press` vuelve a
  // resolver el objetivo y envía Enter al botón correcto; separar `focus()` y `page.keyboard` podía
  // mandar la tecla al lienzo después de ese render.
  await trigger.press('Enter');
  await page.getByRole('button', { name: /^Abrir el editor completo de / }).click();
  await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
}
