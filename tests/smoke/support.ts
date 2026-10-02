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

/**
 * Abre el editor completo de una tarjeta (ADR 0047/0048): en escritorio no hay ya ningún botón
 * permanente sobre la ficha, así que `card` es la propia ficha (`card-tarjeta-N`), siempre presente.
 * Clic derecho (o el botón táctil `⋯` en móvil) abre su menú y «Completo» el editor. El nombre
 * accesible de ese botón cambia con el idioma de la interfaz (ADR 0032): se acepta cualquiera.
 */
const OPEN_FULL_EDITOR_NAME = /^(Abrir el editor completo de |Open the full editor for )/;

/**
 * Posición y tamaño por teclado (ADR 0048): en escritorio esta sección del editor completo no es fija,
 * se ofrece agrupada y cerrada por defecto. Esta suite da por hecho que `card-geometry` está disponible
 * tras abrir el editor, así que se expande aquí una vez por apertura si hace falta; en la hoja móvil ya
 * está siempre visible y el botón no existe.
 */
export async function expandPosition(page: Page) {
  const toggle = page.getByTestId('card-position-toggle');
  if (!(await toggle.isVisible().catch(() => false))) return;
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
}

export async function openFullCardEditor(page: Page, card: Locator) {
  const inline = page.getByTestId('inline-card-editor');
  if (await inline.isVisible()) {
    await inline.getByRole('button', { name: 'Abrir el editor completo', exact: true }).first().click();
    await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
    await expandPosition(page);
    return;
  }
  if (!isCompactWidth(page)) {
    await card.click({ button: 'right' });
    await page.getByRole('button', { name: OPEN_FULL_EDITOR_NAME }).click();
    await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
    await expandPosition(page);
    return;
  }
  const testId = await card.getAttribute('data-testid');
  const cardId = testId?.replace(/^card-/, '');
  if (!cardId) throw new Error('No se pudo deducir la tarjeta para abrir sus acciones.');
  // Activar por teclado evita que un minimapa o control flotante tape físicamente el botón de acciones.
  // `onFocus` puede recentrar el lienzo y volver a renderizar el control. `locator.press` vuelve a
  // resolver el objetivo y envía Enter al botón correcto; separar `focus()` y `page.keyboard` podía
  // mandar la tecla al lienzo después de ese render.
  await page.getByTestId(`card-actions-${cardId}`).press('Enter');
  await page.getByRole('button', { name: OPEN_FULL_EDITOR_NAME }).click();
  await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
}

/** Escritorio abre acciones con clic derecho; móvil conserva el botón táctil visible. */
export async function openCardActions(page: Page, card: Locator, title: string) {
  if (isCompactWidth(page)) await page.getByRole('button', { name: `Acciones de ${title}`, exact: true }).click();
  else await card.click({ button: 'right' });
  await page.getByTestId('card-menu').waitFor({ state: 'visible' });
}
