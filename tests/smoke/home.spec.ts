import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { activeLabel, borderColor, hasHorizontalOverflow, rgb, trackProblems } from './support';

type Arrangement = 'columns' | 'stacked' | 'overlapping';

const desktop = { width: 1366, height: 900 };
const phone = { width: 390, height: 844 };
// Límite de wideLayoutMinWidth en @noutynotes/ui.
const belowBreakpoint = { width: 799, height: 900 };
const atBreakpoint = { width: 800, height: 900 };

const expected = {
  columns: { titleSize: '64px', padding: 44 },
  stacked: { titleSize: '44px', padding: 20 },
} as const;

async function arrangement(page: Page): Promise<Arrangement> {
  const intro = await page.getByTestId('home-introduction').boundingBox();
  const workspace = await page.getByTestId('home-workspace').boundingBox();
  if (!intro || !workspace) return 'overlapping';
  const introRight = intro.x + intro.width;
  const introBottom = intro.y + intro.height;
  const verticalOverlap = Math.min(introBottom, workspace.y + workspace.height) - Math.max(intro.y, workspace.y);
  if (workspace.x >= introRight && verticalOverlap > 0) return 'columns';
  if (workspace.y >= introBottom && Math.abs(workspace.x - intro.x) < 1 && Math.abs(workspace.width - intro.width) < 1) return 'stacked';
  return 'overlapping';
}

/**
 * Comprueba la geometría resultante: posición relativa de los dos paneles, reparto del ancho,
 * tamaño del título y margen de la página. Las aserciones reintentan hasta que se cumplen o
 * expiran; no se añaden esperas fijas ni interacciones que fuercen otro render.
 */
async function expectArrangement(page: Page, mode: 'columns' | 'stacked') {
  const title = page.getByRole('heading', { name: /Dale un lugar/ });
  await expect.poll(() => arrangement(page), { message: `distribución ${mode}` }).toBe(mode);
  await expect(title).toHaveCSS('font-size', expected[mode].titleSize);

  const viewport = page.viewportSize();
  const intro = await page.getByTestId('home-introduction').boundingBox();
  const workspace = await page.getByTestId('home-workspace').boundingBox();
  if (!viewport || !intro || !workspace) throw new Error('Paneles sin geometría medible');
  // Margen de página según breakpoint; el contenido no alcanza su ancho máximo en estos viewports.
  expect(Math.round(intro.x)).toBe(expected[mode].padding);
  if (mode === 'columns') {
    // Cada panel ocupa aproximadamente la mitad del contenido, separado por el hueco.
    expect(intro.width).toBeLessThan(viewport.width / 2);
    expect(workspace.width).toBeLessThan(viewport.width / 2);
    expect(Math.abs(intro.width - workspace.width)).toBeLessThan(2);
    expect(workspace.x - (intro.x + intro.width)).toBeGreaterThanOrEqual(56 - 1);
  } else {
    expect(intro.width).toBeGreaterThan(viewport.width - 2 * 20 - 2);
  }
  expect(await hasHorizontalOverflow(page)).toBe(false);
}

function modeFor(width: number): 'columns' | 'stacked' {
  return width >= atBreakpoint.width ? 'columns' : 'stacked';
}

test('inicio responsive, temas, crear activo y acciones reservadas', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  const initialWidth = page.viewportSize()?.width ?? 0;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  // Distribución desde la carga inicial, antes de pulsar botones o redimensionar.
  await expectArrangement(page, modeFor(initialWidth));
  await page.screenshot({ path: testInfo.outputPath('home-initial.png'), fullPage: true });

  await expect(page.getByRole('button', { name: 'Crear un espacio', exact: true })).toBeEnabled();
  await expect(page.getByTestId('memory-notice')).toContainText('se pierden al recargar o cerrar la pestaña');
  await expect(page.getByRole('button', { name: 'Abrir una carpeta', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Usar una plantilla', exact: true })).toBeDisabled();

  const screen = page.getByTestId('home-screen');
  const lightBackground = await screen.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tema oscuro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => screen.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground);
  const darkBackground = await screen.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expectArrangement(page, modeFor(initialWidth));
  await page.screenshot({ path: testInfo.outputPath('home-dark.png'), fullPage: true });

  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await expect(screen).toHaveCSS('background-color', lightBackground);
  await page.getByRole('button', { name: 'Tema sistema', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(screen).toHaveCSS('background-color', darkBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(screen).toHaveCSS('background-color', lightBackground);

  await page.screenshot({ path: testInfo.outputPath('home-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Usar una plantilla', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('home-actions.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);

  await page.reload();
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expectArrangement(page, modeFor(initialWidth));
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await expect(screen).toHaveCSS('background-color', darkBackground);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('la distribución sigue al viewport al recargar y al redimensionar en ambos sentidos', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  const initial = page.viewportSize() ?? desktop;
  const other = modeFor(initial.width) === 'columns' ? phone : desktop;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expectArrangement(page, modeFor(initial.width));

  await page.setViewportSize(other);
  await expectArrangement(page, modeFor(other.width));
  await page.screenshot({ path: testInfo.outputPath('resized.png'), fullPage: true });

  // Recargar con el nuevo tamaño parte del HTML estático y debe llegar a la distribución correcta.
  await page.reload();
  await expectArrangement(page, modeFor(other.width));

  await page.setViewportSize(initial);
  await expectArrangement(page, modeFor(initial.width));
  await page.screenshot({ path: testInfo.outputPath('restored.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('límite responsive: 799 px en una columna y 800 px en dos', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'El límite se comprueba una vez con viewport de escritorio.');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.setViewportSize(belowBreakpoint);
  await page.goto('./');
  await expectArrangement(page, 'stacked');
  await page.screenshot({ path: testInfo.outputPath('breakpoint-799.png'), fullPage: true });

  await page.setViewportSize(atBreakpoint);
  await expectArrangement(page, 'columns');

  await page.reload();
  await expectArrangement(page, 'columns');
  await page.screenshot({ path: testInfo.outputPath('breakpoint-800.png'), fullPage: true });

  await page.setViewportSize(belowBreakpoint);
  await expectArrangement(page, 'stacked');
});

test('el HTML estático sin JavaScript usa la distribución compacta legible', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'El HTML servido no depende del dispositivo emulado.');
  // Documenta el estado previo a la hidratación: el servidor no conoce el viewport.
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: desktop, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(baseURL ?? './');
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expectArrangement(page, 'stacked');
  await context.close();
});

test('accesibilidad básica: teclado, activación, foco visible y controles táctiles', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  const light = page.getByRole('button', { name: 'Tema claro', exact: true });
  const dark = page.getByRole('button', { name: 'Tema oscuro', exact: true });
  const system = page.getByRole('button', { name: 'Tema sistema', exact: true });
  const actions = ['Crear un espacio', 'Abrir una carpeta', 'Usar una plantilla'];
  const reserved = ['Usar una plantilla'];
  const nameField = page.getByLabel('Nombre del nuevo espacio');
  const create = page.getByRole('button', { name: 'Crear un espacio', exact: true });
  const screen = page.getByTestId('home-screen');
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();

  // Controles táctiles: al menos 44×44 px en el viewport de cada proyecto.
  for (const button of [light, dark, system]) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  for (const name of actions) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // Orden de tabulación: los tres temas, el nombre y «Crear»; las acciones reservadas no reciben foco.
  const unfocused = await borderColor(system);
  await page.keyboard.press('Tab');
  await expect(light).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dark).toBeFocused();
  // Foco visible: el borde pasa del color de superficie al token de selección.
  await expect.poll(() => borderColor(dark)).toBe(rgb(themeColors.light.selection));
  expect(unfocused).toBe(rgb(themeColors.light.surface));
  await page.screenshot({ path: testInfo.outputPath('focus-light.png') });

  // Activación con Enter.
  await page.keyboard.press('Enter');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(screen).toHaveCSS('background-color', rgb(themeColors.dark.background));
  await expect(dark).toBeFocused();
  await expect.poll(() => borderColor(dark)).toBe(rgb(themeColors.dark.selection));
  await page.screenshot({ path: testInfo.outputPath('focus-dark.png') });

  await page.keyboard.press('Tab');
  await expect(system).toBeFocused();
  await expect.poll(() => borderColor(dark)).toBe(rgb(themeColors.dark.surface));
  await page.keyboard.press('Tab');
  await expect(nameField).toBeFocused();
  await expect.poll(() => borderColor(nameField)).toBe(rgb(themeColors.dark.selection));
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  await expect.poll(() => borderColor(create)).toBe(rgb(themeColors.dark.selection));
  await page.keyboard.press('Tab');
  expect(reserved).not.toContain(await activeLabel(page));

  // Activación con Espacio, volviendo atrás con Shift+Tab.
  await page.keyboard.press('Shift+Tab');
  await expect(create).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(nameField).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(system).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(light).toBeFocused();
  await page.keyboard.press('Space');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  await expect(screen).toHaveCSS('background-color', rgb(themeColors.light.background));
});

test('antes de cargar JavaScript el nombre no admite escritura que luego se perdería', async ({ page }) => {
  // Retiene el bundle para reproducir de forma determinista la ventana previa al render del cliente,
  // que reemplaza (desarrollo) o hidrata (export) el HTML estático.
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\.(bundle|js)(\?|$)/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./', { waitUntil: 'commit' });
  const field = page.getByLabel('Nombre del nuevo espacio');
  await expect(field).toBeVisible();
  await expect(field).not.toBeEditable();

  release();
  await field.fill('Primera idea');
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expect(field).toHaveValue('Primera idea');
  await page.getByRole('button', { name: 'Crear un espacio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Primera idea', exact: true })).toBeVisible();
});
