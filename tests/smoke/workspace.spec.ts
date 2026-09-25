import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { activeLabel, borderColor, hasHorizontalOverflow, rgb, trackProblems } from './support';

// Límites de la pantalla del workspace: el tablero pasa a 12 columnas desde 800 px
// (wideLayoutMinWidth) y el editor se coloca al lado desde 1100 px.
const desktop = { width: 1366, height: 900 };
const phone = { width: 390, height: 844 };
const tabletLandscape = { width: 1024, height: 768 };
const tabletPortrait = { width: 768, height: 1024 };
const below = { width: 799, height: 900 };
const at = { width: 800, height: 900 };
const ROW = 56;

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, id: number) => page.getByTestId(`card-tarjeta-${id}`);
const feedback = (page: Page) => page.getByTestId('workspace-feedback');
const geometry = (page: Page) => page.getByTestId('card-geometry');

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function addCards(page: Page, kinds: readonly ('nota' | 'imagen')[]) {
  const start = await page.locator('[data-testid^="card-tarjeta-"]').count();
  for (const [index, kind] of kinds.entries()) {
    await button(page, kind === 'nota' ? 'Añadir nota' : 'Añadir imagen').click();
    await expect(card(page, start + index + 1)).toBeVisible();
  }
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Elemento sin geometría medible');
  return found;
}

type BoardMode = 'grid' | 'column';

/**
 * Comprueba la representación del tablero con tres tarjetas en fila (0,0), (4,0) y (8,0):
 * en grilla, tres columnas de 4/12 del ancho interior en la misma fila; en columna, apiladas
 * a todo el ancho. Además, sin desbordamiento horizontal.
 */
async function expectBoard(page: Page, mode: BoardMode) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('aria-label', mode === 'grid' ? 'Tablero en grilla de 12 columnas' : 'Tablero en una columna');
  await expect.poll(async () => {
    const [first, second] = [await box(card(page, 1)), await box(card(page, 2))];
    return mode === 'grid'
      ? Math.abs(first.y - second.y) < 1 && second.x > first.x + first.width
      : second.y >= first.y + first.height && Math.abs(first.x - second.x) < 1;
  }, { message: `tablero en modo ${mode}` }).toBe(true);
  const outer = await box(board);
  const inner = outer.width - 4;
  const first = await box(card(page, 1));
  if (mode === 'grid') {
    expect(Math.abs(first.width - (inner * 4) / 12 + 8)).toBeLessThan(2);
    expect(Math.abs(first.height - (3 * ROW - 8))).toBeLessThan(2);
  } else {
    expect(Math.abs(first.width - (inner - 8))).toBeLessThan(2);
  }
  expect(await hasHorizontalOverflow(page)).toBe(false);
}

async function expectInspector(page: Page, placement: 'side' | 'stacked') {
  const inspector = await box(page.getByTestId('card-inspector'));
  const board = await box(page.getByTestId('board'));
  if (placement === 'side') expect(inspector.x).toBeGreaterThanOrEqual(board.x + board.width);
  else expect(inspector.y + inspector.height).toBeLessThanOrEqual(board.y);
}

test('flujo del prototipo: crear, editar, mover, redimensionar, relacionar y reabrir en la sesión', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  const wide = (page.viewportSize()?.width ?? 0) >= at.width;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByTestId('memory-notice')).toContainText('se pierden al recargar o cerrar la pestaña');
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  // 1. Crear un espacio vacío.
  await createWorkspace(page, 'Guion corto');
  await expect(page).toHaveURL(/workspace\?id=guion-corto$/);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await expect(page.getByTestId('workspace-memory')).toHaveText('SOLO EN MEMORIA · SE PIERDE AL RECARGAR');

  // 2 y 6. Tarjetas en el layout, incluida una imagen de ejemplo sin archivo.
  await addCards(page, ['nota', 'nota', 'imagen']);
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expect(page.getByRole('img', { name: 'Imagen de ejemplo (marcador de posición, sin archivo)' })).toBeVisible();
  await expect(feedback(page)).toHaveText('Imagen de ejemplo añadida. Guardado en memoria.');
  await expectBoard(page, wide ? 'grid' : 'column');

  // 3. Editar título y Markdown.
  await card(page, 1).click();
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Título de la tarjeta').fill('Escena inicial');
  await page.getByLabel('Contenido Markdown').fill('# Plano\n\n- abierto');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado en memoria.');
  await expect(card(page, 1)).toContainText('Escena inicial');
  await expect(card(page, 1)).toContainText('# Plano');
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible();

  // 4. Mover y redimensionar con los errores del motor de grilla visibles.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Mover a la izquierda').click();
  await expect(page.getByRole('alert')).toHaveText('La tarjeta saldría de los límites de la grilla.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Mover abajo').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 3');
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await button(page, 'Mover a la derecha').click();
  await expect(page.getByRole('alert')).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 3');
  await button(page, 'Más estrecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 3 × 3');
  await button(page, 'Más alta').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 3 × 4');
  await button(page, 'Más ancha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 4');
  await button(page, 'Más ancha').click();
  await expect(page.getByRole('alert')).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 4');
  if (wide) {
    // La posición dibujada sigue al layout canónico: una fila más abajo que la tarjeta 2.
    const [moved, neighbour] = [await box(card(page, 1)), await box(card(page, 2))];
    expect(Math.abs(moved.y - neighbour.y - ROW)).toBeLessThan(2);
    expect(Math.abs(moved.height - (4 * ROW - 8))).toBeLessThan(2);
  }

  // 5. Conectar y desconectar.
  const connections = page.getByTestId('card-connections');
  await button(page, 'Conectar con Nueva nota').click();
  await expect(connections).toContainText('→ Nueva nota');
  await expect(card(page, 2)).toContainText('1 conexión');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(wide ? 1 : 0);
  await page.screenshot({ path: testInfo.outputPath('workspace-flow.png') });
  await button(page, 'Desconectar de Nueva nota').click();
  await expect(connections).toContainText('Sin conexiones.');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);
  await expect(card(page, 2)).not.toContainText('conexión');
  await button(page, 'Conectar con Imagen de ejemplo').click();
  await expect(connections).toContainText('→ Imagen de ejemplo');

  // 7. Volver, crear otro, cambiar de tema y reabrir el primero con su estado.
  await button(page, 'Volver a mis espacios').click();
  await expect(button(page, 'Abrir Guion corto')).toBeVisible();
  await createWorkspace(page, 'Otro espacio');
  await addCards(page, ['imagen']);
  await button(page, 'Volver a mis espacios').click();
  await expect(button(page, 'Abrir Otro espacio')).toBeVisible();
  // Regresión: en móvil la sección apilada se encogía y el pie tapaba la lista de la sesión.
  const panel = await box(page.getByTestId('home-workspace'));
  const list = await box(page.getByTestId('session-workspaces'));
  const footer = await box(page.getByText('PENSADO PARA LO LOCAL.'));
  expect(list.y + list.height).toBeLessThanOrEqual(panel.y + panel.height);
  expect(footer.y).toBeGreaterThanOrEqual(panel.y + panel.height);
  await button(page, 'Tema oscuro').click();
  await button(page, 'Abrir Guion corto').click();
  await expect(page.getByRole('heading', { name: 'Guion corto', exact: true })).toBeVisible();
  await expect(page.getByTestId('workspace-screen')).toHaveCSS('background-color', rgb(themeColors.dark.background));
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expect(card(page, 1)).toContainText('Escena inicial');
  await card(page, 1).click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 4');
  await expect(page.getByTestId('card-connections')).toContainText('→ Imagen de ejemplo');
  await expect(page.getByLabel('Contenido Markdown')).toHaveValue('# Plano\n\n- abierto');
  await page.screenshot({ path: testInfo.outputPath('workspace-reopened-dark.png') });
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Abrir Otro espacio').click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(1);

  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('recargar pierde los datos en memoria y la interfaz lo indica', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Temporal');
  await addCards(page, ['nota']);

  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Este espacio no existe en esta sesión. Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace-reloaded.png') });
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  // Un enlace directo en una carga nueva tampoco encuentra datos.
  await page.goto('./workspace?id=temporal');
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('tablero responsive al redimensionar en ambos sentidos y en tablet', async ({ page }, testInfo) => {
  const initial = page.viewportSize() ?? desktop;
  const initialMode: BoardMode = initial.width >= at.width ? 'grid' : 'column';
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Responsive');
  await addCards(page, ['nota', 'nota', 'imagen']);
  // Primera medida con el tamaño inicial, antes de seleccionar o redimensionar.
  await expectBoard(page, initialMode);
  await card(page, 1).click();
  await expectInspector(page, initial.width >= 1100 ? 'side' : 'stacked');
  await page.screenshot({ path: testInfo.outputPath('workspace-initial.png') });

  const sizes = initialMode === 'grid' ? [phone, tabletPortrait, tabletLandscape, initial] : [desktop, tabletLandscape, tabletPortrait, initial];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectBoard(page, size.width >= at.width ? 'grid' : 'column');
    await expectInspector(page, size.width >= 1100 ? 'side' : 'stacked');
  }
  await page.setViewportSize(tabletLandscape);
  await expectBoard(page, 'grid');
  await page.screenshot({ path: testInfo.outputPath('workspace-tablet.png') });
  await page.setViewportSize(initial);
  await expectBoard(page, initialMode);
});

test('límite del tablero: 799 px en una columna y 800 px en grilla', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'El límite se comprueba una vez con viewport de escritorio.');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(below);
  await page.goto('./');
  await createWorkspace(page, 'Limite');
  await addCards(page, ['nota', 'nota', 'imagen']);
  await expectBoard(page, 'column');
  await page.screenshot({ path: testInfo.outputPath('workspace-799.png') });
  await page.setViewportSize(at);
  await expectBoard(page, 'grid');
  await page.screenshot({ path: testInfo.outputPath('workspace-800.png') });
  await page.setViewportSize(below);
  await expectBoard(page, 'column');
});

test('accesibilidad del workspace: teclado, foco visible, nombres y controles táctiles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Teclado');
  const back = button(page, 'Volver a mis espacios');
  const addNote = button(page, 'Añadir nota');
  const addImage = button(page, 'Añadir imagen');

  // Orden de tabulación desde el inicio de la página y activación con Enter.
  await back.focus();
  await page.keyboard.press('Tab');
  await expect(addNote).toBeFocused();
  await expect.poll(() => borderColor(addNote)).toBe(rgb(themeColors.light.selection));
  expect(await borderColor(addImage)).toBe(rgb(themeColors.light.border));
  await page.keyboard.press('Enter');
  await expect(card(page, 1)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(addImage).toBeFocused();
  await page.keyboard.press('Space');
  await expect(card(page, 2)).toBeVisible();

  // Las tarjetas se alcanzan con el teclado y se seleccionan con Espacio.
  await card(page, 2).focus();
  await expect.poll(() => borderColor(card(page, 2))).toBe(rgb(themeColors.light.selection));
  await card(page, 1).focus();
  await page.keyboard.press('Space');
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  const moveDown = button(page, 'Mover abajo');
  await moveDown.focus();
  await page.keyboard.press('Enter');
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 3');
  expect(await activeLabel(page)).toBe('Mover abajo');

  // Nombres accesibles y controles de al menos 44 × 44 px en todo el workspace.
  const buttons = page.getByTestId('workspace-screen').getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(10);
  for (let index = 0; index < count; index += 1) {
    const control = buttons.nth(index);
    expect(await control.getAttribute('aria-label')).toBeTruthy();
    const found = await box(control);
    expect(found.width).toBeGreaterThanOrEqual(44);
    expect(found.height).toBeGreaterThanOrEqual(44);
  }
  for (const label of ['Título de la tarjeta', 'Contenido Markdown']) {
    expect((await box(page.getByLabel(label))).height).toBeGreaterThanOrEqual(44);
  }
  expect(await hasHorizontalOverflow(page)).toBe(false);
});
