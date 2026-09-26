import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { activeLabel, borderColor, hasHorizontalOverflow, rgb, trackProblems } from './support';

// Experiencia del workspace (ADR 0013). Por debajo de 800 px: barra abajo, editor en hoja y celdas de
// 56 × 56 px; desde 800 px: barra sobre el lienzo, inspector a la derecha y celdas de 96 × 64 px;
// desde 1100 px, barra lateral de espacios y tableros.
const desktop = { width: 1366, height: 900 };
const phone = { width: 390, height: 844 };
const tabletLandscape = { width: 1024, height: 768 };
const tabletPortrait = { width: 768, height: 1024 };
const below = { width: 799, height: 900 };
const at = { width: 800, height: 900 };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, id: number) => page.getByTestId(`card-tarjeta-${id}`);
/**
 * Activar con el teclado una tarjeta que el pan o la barra de acciones pueden dejar fuera de la vista
 * o tapada: el foco la trae con el pan y Espacio dispara el mismo onPress que un toque. Un clic en su
 * centro «pulsaría» algo que la persona no ve.
 */
async function tapCard(page: Page, id: number) {
  // Al cerrar un diálogo, el foco vuelve (de forma asíncrona) al botón que lo abrió: se espera a que
  // la tarjeta tenga el foco de verdad antes de pulsar Espacio, o Espacio activaría ese botón.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(async () => {
    await card(page, id).focus();
    await expect(card(page, id)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Space');
}
const feedback = (page: Page) => page.getByTestId('workspace-feedback');
const geometry = (page: Page) => page.getByTestId('card-geometry');
const cellSize = (page: Page) => ((page.viewportSize()?.width ?? 0) >= at.width ? { x: 96, y: 64 } : { x: 56, y: 56 });

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function addCards(page: Page, kinds: readonly ('nota' | 'imagen')[]) {
  const start = await page.locator('[data-testid^="card-tarjeta-"]').count();
  for (const [index, kind] of kinds.entries()) {
    await button(page, kind === 'nota' ? 'Añadir nota' : 'Añadir imagen de ejemplo').click();
    await expect(card(page, start + index + 1)).toBeVisible();
  }
}

async function closeEditor(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Elemento sin geometría medible');
  return found;
}

/** Arrastre con ratón en pasos, desde la cabecera de la tarjeta (o el centro del elemento). */
/** Por la cabecera se agarra a 20 px del borde izquierdo: los controles van a la derecha (ADR 0016). */
async function mouseDrag(page: Page, locator: Locator, dx: number, dy: number, options: { release?: boolean; header?: boolean } = {}) {
  const found = await box(locator);
  const x = found.x + (options.header === false ? Math.min(found.width / 2, 60) : 20);
  const y = found.y + (options.header === false ? found.height / 2 : 12);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10);
  if (options.release !== false) await page.mouse.up();
}

/** Arrastre táctil real (eventos touch de Chromium), no simulado con ratón. */
async function touchDrag(page: Page, locator: Locator, dx: number, dy: number, header = true) {
  const found = await box(locator);
  const x = Math.round(found.x + (header ? 20 : found.width / 2));
  const y = Math.round(found.y + (header ? 12 : found.height / 2));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + (dx * step) / 10), y: Math.round(y + (dy * step) / 10) }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** En móvil el editor ocupa parte de la pantalla: se oculta para usar las asas del lienzo. */
async function revealCanvas(page: Page) {
  const hide = button(page, 'Ocultar el editor de la tarjeta');
  if (await hide.count() > 0) await hide.click();
}

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) < at.width;

/** «Restablecer vista»: zoom 100 % y cámara en el origen (barra en escritorio, Configuración en móvil). */
async function resetView(page: Page) {
  if (isCompact(page)) await inSettings(page, async () => { await button(page, 'Restablecer la vista del lienzo').click(); });
  else await page.getByTestId('zoom-level').click();
}

/**
 * Dos notas lado a lado en la primera fila. Desde P2 la segunda nace debajo, dentro de lo visible;
 * los recorridos que prueban colisiones horizontales la colocan con los botones del inspector.
 */
async function sideBySide(page: Page) {
  await addCards(page, ['nota', 'nota']);
  for (let step = 0; step < 4; step += 1) await button(page, 'Mover a la derecha').click();
  for (let step = 0; step < 3; step += 1) await button(page, 'Mover arriba').click();
  await expect(geometry(page)).toHaveText('Columna 5, fila 1 · 4 × 3');
  await closeEditor(page);
  await resetView(page);
}

/** Abre la Configuración, ejecuta `action` y la cierra (ADR 0014: grilla, imán y, en móvil, zoom). */
async function inSettings(page: Page, action: () => Promise<void>) {
  await button(page, 'Abrir la configuración').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await action();
  await button(page, 'Cerrar configuración').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
}

/** Zoom: en escritorio con la barra; en móvil desde la Configuración. */
async function zoomBy(page: Page, direction: 'in' | 'out', times = 1) {
  if (!isCompact(page)) {
    // En el límite el botón se desactiva: se para ahí, como haría el usuario.
    const control = button(page, direction === 'in' ? 'Acercar' : 'Alejar');
    for (let step = 0; step < times && await control.isEnabled(); step += 1) await control.click();
    return;
  }
  await inSettings(page, async () => {
    for (let step = 0; step < times; step += 1) await button(page, direction === 'in' ? 'Acercar el lienzo' : 'Alejar el lienzo').click();
  });
}

async function expectZoom(page: Page, text: string) {
  if (!isCompact(page)) {
    await expect(page.getByTestId('zoom-level')).toContainText(text);
    return;
  }
  await inSettings(page, async () => { await expect(page.getByTestId('settings-zoom')).toHaveText(text); });
}

async function setSwitch(page: Page, name: string, on: boolean) {
  await inSettings(page, async () => {
    const control = page.getByRole('switch', { name });
    if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
    await expect(control).toHaveAttribute('aria-checked', String(on));
  });
}

async function expectGeometry(page: Page, cardNumber: number, text: string) {
  await card(page, cardNumber).click();
  await expect(geometry(page)).toHaveText(text);
}

test('flujo principal: estado vacío, crear, editar, conectar, mover con botones y reabrir en la sesión', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByTestId('memory-notice')).toContainText('se pierden al recargar o cerrar la pestaña');
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  // 1. Espacio vacío: el lienzo invita a crear la primera nota y no hay inspector vacío.
  await createWorkspace(page, 'Guion corto');
  await expect(page).toHaveURL(/workspace\?id=guion-corto$/);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expect(page.getByTestId('workspace-memory')).toHaveText('SOLO EN MEMORIA · SE PIERDE AL RECARGAR');
  await page.screenshot({ path: testInfo.outputPath('workspace-empty.png') });
  await button(page, 'Crear la primera nota').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(page.getByTestId('board-empty')).toHaveCount(0);
  await expect(feedback(page)).toHaveText('Nota añadida. Guardado en memoria.');

  // 2. Más tarjetas, incluida una imagen de ejemplo sin archivo, con cabecera numerada por tipo.
  await addCards(page, ['nota', 'imagen']);
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expect(page.getByRole('img', { name: 'Imagen de ejemplo (marcador de posición, sin archivo)' })).toBeAttached();
  await expect(feedback(page)).toHaveText('Imagen de ejemplo añadida. Guardado en memoria.');
  // Con los controles en la cabecera, en una tarjeta estrecha solo cabe el número.
  await expect(card(page, 1)).toContainText(isCompact(page) ? '001' : '001 // NOTA');
  await expect(card(page, 3)).toContainText(isCompact(page) ? '003' : '003 // IMAGEN');
  await expect(page.getByTestId('card-inspector')).toBeVisible();

  // 3. Editar título y Markdown.
  await tapCard(page, 1);
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Título de la tarjeta').fill('Escena inicial');
  await page.getByLabel('Contenido Markdown').fill('# Plano\n\n- abierto');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado en memoria.');
  await expect(card(page, 1)).toContainText('Escena inicial');
  await expect(card(page, 1)).toContainText('Plano');

  // 4. Botones del inspector (alternativa accesible a los gestos) con los errores del motor.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Mover a la izquierda').click();
  await expect(geometry(page)).toHaveText('X -1, Y 0 · 4 × 3');
  await button(page, 'Mover a la derecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  // Desde P2 la segunda nota nace debajo, dentro de lo visible: a la derecha hay sitio y abajo, no.
  await button(page, 'Mover a la derecha').click();
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  await button(page, 'Mover abajo').click();
  await expect(page.getByRole('alert')).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  await button(page, 'Más ancha').click();
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 5 × 3');

  // 5. Conectar desde el inspector y con la herramienta Conectar, que también desconecta.
  const connections = page.getByTestId('card-connections');
  await button(page, 'Conectar con Nueva nota').click();
  await expect(connections).toContainText('→ Nueva nota');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);
  await closeEditor(page);
  await button(page, 'Herramienta Conectar').click();
  await expect(button(page, 'Herramienta Conectar')).toHaveAttribute('aria-pressed', 'true');
  await card(page, 1).click();
  await expect(page.getByTestId('connect-hint-tarjeta-1')).toHaveText('Origen · toca otra tarjeta');
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveText('× Desconectar');
  await expect(page.getByTestId('connect-hint-tarjeta-3')).toHaveText('+ Conectar');
  await expect(feedback(page)).toContainText('Origen: «Escena inicial»');
  await page.screenshot({ path: testInfo.outputPath('workspace-connecting.png') });
  await tapCard(page, 2);
  await expect(feedback(page)).toHaveText('Conexión eliminada. Guardado en memoria.');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);
  await tapCard(page, 1);
  await tapCard(page, 3);
  await expect(feedback(page)).toHaveText('Tarjetas conectadas. Guardado en memoria.');
  await expect(card(page, 3)).toContainText('1 conexión');
  // Tocar el origen cancela sin cambiar nada.
  await tapCard(page, 1);
  await tapCard(page, 1);
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveCount(0);
  await button(page, 'Herramienta Seleccionar').click();

  // 6. Volver, crear otro, cambiar de tema y reabrir el primero con su estado.
  await button(page, 'Volver a mis espacios').click();
  await expect(button(page, 'Abrir Guion corto')).toBeVisible();
  await createWorkspace(page, 'Otro espacio');
  await addCards(page, ['imagen']);
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Tema oscuro').click();
  await button(page, 'Abrir Guion corto').click();
  await expect(page.getByRole('heading', { name: 'Guion corto', exact: true })).toBeVisible();
  await expect(page.getByTestId('workspace-screen')).toHaveCSS('background-color', rgb(themeColors.dark.background));
  await expect(page.getByTestId('board-canvas')).toHaveCSS('background-color', rgb(themeColors.dark.canvas));
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expectGeometry(page, 1, 'Columna 2, fila 1 · 5 × 3');
  await expect(page.getByTestId('card-connections')).toContainText('→ Imagen de ejemplo');
  await expect(page.getByLabel('Contenido Markdown')).toHaveValue('# Plano\n\n- abierto');
  await page.screenshot({ path: testInfo.outputPath('workspace-reopened-dark.png') });

  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('arrastrar con ratón: vista previa con imán, colisión y límites visibles, Escape cancela y soltar guarda', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Arrastre');
  await sideBySide(page);
  const cell = cellSize(page);

  // Vista previa válida y cancelación con Escape: no se guarda nada (el aviso no cambia).
  const lastFeedback = await feedback(page).innerText();
  await mouseDrag(page, card(page, 1), 0, 4 * cell.y, { release: false });
  await expect(page.getByTestId('drag-target')).toHaveAttribute('aria-label', 'Destino válido');
  await expect(page.getByTestId('drag-status')).toHaveText('Soltar en columna 1, fila 5. Escape cancela.');
  await page.screenshot({ path: testInfo.outputPath('drag-valid.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drag-status')).toHaveCount(0);
  await page.mouse.up();
  await expect(feedback(page)).toHaveText(lastFeedback);
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Colisión visible antes de soltar: destino y tarjeta afectada en rojo; al soltar, no cambia nada.
  await mouseDrag(page, card(page, 1), 2 * cell.x, 0, { release: false });
  await expect(page.getByTestId('drag-target')).toHaveAttribute('aria-label', 'Destino no válido');
  await expect(page.getByTestId('drag-status')).toHaveText('Ahí se solaparía con otra tarjeta: «Nueva nota».');
  await expect.poll(() => borderColor(card(page, 2))).toBe(rgb(themeColors.light.danger));
  await page.screenshot({ path: testInfo.outputPath('drag-collision.png') });
  await page.mouse.up();
  await expect(feedback(page)).toHaveText('No se guardó el cambio. Ahí se solaparía con otra tarjeta: «Nueva nota».');
  await expect(feedback(page)).toHaveAttribute('role', 'alert');
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Hacia arriba del origen ahora es un destino válido del mundo; Escape cancela sin guardar.
  // Dos filas: el puntero no sale de la ventana (Firefox bajo Playwright lo fija en el borde).
  await mouseDrag(page, card(page, 1), 0, -2 * cell.y, { release: false });
  await expect(page.getByTestId('drag-status')).toHaveText('Soltar en X 0, Y -2. Escape cancela.');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Sin imán la vista previa sigue al puntero; con imán, salta a la celda.
  await setSwitch(page, 'Imán en la vista previa', false);
  const before = await box(card(page, 1));
  await mouseDrag(page, card(page, 1), 0, Math.round(1.3 * cell.y), { release: false });
  await expect.poll(async () => Math.round((await box(card(page, 1))).y - before.y)).toBe(Math.round(1.3 * cell.y));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await setSwitch(page, 'Imán en la vista previa', true);
  await mouseDrag(page, card(page, 1), 0, Math.round(1.3 * cell.y), { release: false });
  await expect.poll(async () => Math.round((await box(card(page, 1))).y - before.y)).toBe(cell.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Soltar en un destino válido guarda con el caso de uso.
  await mouseDrag(page, card(page, 1), 0, 4 * cell.y);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 5 · 4 × 3');

  // Asas: la esquina cambia ancho y alto; el mundo admite pasar de 12 columnas. Soltar no
  // selecciona otra vez ni abre nada: la tarjeta sigue seleccionada.
  await revealCanvas(page);
  // En móvil la esquina queda bajo el borde visible: se aleja la vista (75 %) como haría el usuario.
  const compact = (page.viewportSize()?.width ?? 0) < at.width;
  const scale = compact ? 0.75 : 1;
  if (compact) await zoomBy(page, 'out');
  await mouseDrag(page, page.getByTestId('resize-se-tarjeta-1'), cell.x * scale, cell.y * scale, { header: false });
  await expect(feedback(page)).toHaveText('Tamaño cambiado. Guardado en memoria.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 5 · 5 × 4');
  // Ancho 5 + 8 = 13 > 12 columnas. Al 50 % el puntero no sale de la ventana (Firefox no informa bien fuera de ella).
  await zoomBy(page, 'out', 3);
  await expectZoom(page, '50 %');
  await mouseDrag(page, page.getByTestId('resize-e-tarjeta-1'), 8 * cell.x * 0.5, 0, { header: false, release: false });
  await expect(page.getByTestId('drag-status')).toHaveText('Nuevo tamaño: 13 × 4. Escape cancela.');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(geometry(page)).toHaveText('Columna 1, fila 5 · 5 × 4');
  await page.screenshot({ path: testInfo.outputPath('drag-resized.png') });
});

test('táctil: arrastrar una tarjeta y redimensionar con el dedo', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || !testInfo.project.use.hasTouch, 'Eventos touch reales solo en el perfil móvil de Chromium.');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Dedo');
  await addCards(page, ['nota']);
  await closeEditor(page);
  const cell = cellSize(page);
  await touchDrag(page, card(page, 1), cell.x, 2 * cell.y);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 2, fila 3 · 4 × 3');
  // En el móvil el editor se oculta para dejar el lienzo (y las asas) a la vista, sin perder la selección.
  await button(page, 'Ocultar el editor de la tarjeta').click();
  await expect(page.getByLabel('Título de la tarjeta')).toBeHidden();
  await touchDrag(page, page.getByTestId('resize-s-tarjeta-1'), 0, cell.y, false);
  await expect(feedback(page)).toHaveText('Tamaño cambiado. Guardado en memoria.');
  await button(page, 'Mostrar el editor de la tarjeta').click();
  await expect(geometry(page)).toHaveText('Columna 2, fila 3 · 4 × 4');
  // Un toque corto selecciona, no arrastra.
  await closeEditor(page);
  await page.getByTestId('card-tarjeta-1').tap();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(geometry(page)).toHaveText('Columna 2, fila 3 · 4 × 4');
});

test('herramientas: mano, zoom con porcentaje, grilla y vista de lista', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Vista');
  await sideBySide(page);
  const cell = cellSize(page);

  // Mano: desplaza el lienzo; las tarjetas no se mueven ni se seleccionan.
  await button(page, 'Herramienta Mano').click();
  const start = await box(card(page, 1));
  await mouseDrag(page, page.getByTestId('board-canvas'), -40, -30, { header: false });
  await expect.poll(async () => Math.round((await box(card(page, 1))).x - start.x)).toBe(-40);
  await card(page, 1).click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await button(page, 'Herramienta Seleccionar').click();
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Zoom por pasos con lectura del porcentaje; restablecer vuelve a 100 % y al origen.
  await expectZoom(page, '100 %');
  const width100 = (await box(card(page, 1))).width;
  await zoomBy(page, 'in');
  await expectZoom(page, '125 %');
  await expect.poll(async () => Math.round((await box(card(page, 1))).width)).toBe(Math.round(width100 * 1.25));
  await zoomBy(page, 'out', 3);
  await expectZoom(page, '50 %');
  // En escritorio la barra desactiva «Alejar» en el mínimo; en la Configuración el valor no baja de 50 %.
  if (!isCompact(page)) await expect(button(page, 'Alejar')).toBeDisabled();
  // Al 50 % arrastrar el doble de píxeles mueve una celda.
  await mouseDrag(page, card(page, 2), 0, 2 * cell.y * 0.5);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  // Soltar no abre el editor: el arrastre no es un toque.
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expectGeometry(page, 2, 'Columna 5, fila 3 · 4 × 3');
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('tools-zoom-50.png') });
  if (isCompact(page)) await inSettings(page, async () => { await button(page, 'Restablecer la vista del lienzo').click(); });
  else await button(page, 'Zoom 50 %, restablecer a 100 %').click();
  await expectZoom(page, '100 %');

  // Grilla: interruptor real (en la Configuración).
  await expect(page.getByTestId('canvas-grid')).toHaveCount(1);
  await setSwitch(page, 'Mostrar grilla', false);
  await expect(page.getByTestId('canvas-grid')).toHaveCount(0);
  await setSwitch(page, 'Mostrar grilla', true);

  // Lista: proyección de una columna, apilada y a todo el ancho; las herramientas del lienzo se desactivan.
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('board-list')).toHaveAttribute('aria-label', 'Lista del tablero en una columna');
  await expect(page.getByTestId('board-canvas')).toHaveCount(0);
  await expect(button(page, 'Herramienta Mano')).toBeDisabled();
  const [first, second] = [await box(card(page, 1)), await box(card(page, 2))];
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(Math.abs(first.x - second.x)).toBeLessThan(1);
  await card(page, 2).click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('P4: una tarjeta recién creada se revela completa cuando el inspector estrecha el lienzo', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'El estrechamiento por inspector se comprueba en escritorio.');
  await page.goto('./');
  await createWorkspace(page, 'Encuadre');
  await addCards(page, ['nota', 'nota']);
  const canvas = await page.getByTestId('board-canvas').boundingBox();
  const created = await card(page, 2).boundingBox();
  expect(canvas).not.toBeNull();
  expect(created).not.toBeNull();
  expect(created!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(created!.x + created!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
});

test('lienzo de mundo: rueda, trackpad y tacto exploran ambos ejes sin borde en la última tarjeta', async ({ page, browserName }) => {
  await page.goto('./');
  await createWorkspace(page, 'Mundo');
  await addCards(page, ['nota']);
  await closeEditor(page);
  const canvas = page.getByTestId('board-canvas');
  const first = await box(card(page, 1));
  const frame = await box(canvas);
  const relative = async () => {
    const [tile, board] = await Promise.all([box(card(page, 1)), box(canvas)]);
    return { x: Math.round(tile.x - board.x - (first.x - frame.x)), y: Math.round(tile.y - board.y - (first.y - frame.y)) };
  };
  if (isCompact(page)) {
    await button(page, 'Herramienta Mano').click();
    // Desde el centro del lienzo: el puntero no sale de la ventana (Firefox lo fija en el borde).
    const middle = await box(canvas);
    await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(middle.x + middle.width / 2 - step * 10, middle.y + middle.height / 2 - step * 12);
    await page.mouse.up();
    await expect.poll(async () => (await relative()).x).toBe(-100);
    await expect.poll(async () => (await relative()).y).toBe(-120);
    // Eventos táctiles reales solo por CDP (Chromium); en Firefox queda probado el recorrido con ratón.
    if (browserName !== 'chromium') return;
    for (let step = 0; step < 4; step += 1) await touchDrag(page, canvas, 50, 40, false);
    await expect.poll(async () => (await relative()).x).toBe(100);
    await expect.poll(async () => (await relative()).y).toBe(40);
    return;
  }
  await canvas.hover();
  await page.mouse.wheel(310, 470);
  await expect.poll(async () => (await relative()).x).toBe(-310);
  await expect.poll(async () => (await relative()).y).toBe(-470);
  await page.mouse.wheel(-620, -940);
  await expect.poll(async () => (await relative()).x).toBe(310);
  await expect.poll(async () => (await relative()).y).toBe(470);
  await expect(canvas).toBeVisible();
});

test('tableros y espacios: crear, navegar y añadir tarjetas en el tablero visible', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Primero');
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Guion');
  await button(page, 'Crear un tablero').click();
  await expect(feedback(page)).toHaveText('Tablero creado. Guardado en memoria.');
  await expect(button(page, 'Tablero Tablero 1')).toHaveAttribute('aria-pressed', 'true');
  await addCards(page, ['nota']);
  await button(page, 'Crear un tablero').click();
  await expect(button(page, 'Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await button(page, 'Crear la primera nota').click();
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Guion', exact: true })).toBeVisible();
  // El tablero y su número de tarjetas: en la cabecera desde 800 px; en móvil, en su pestaña.
  if (isCompact(page)) await expect(button(page, 'Tablero Tablero 2')).toContainText('1');
  else await expect(page.getByText('TABLERO 2 · 1 TARJETA')).toBeVisible();
  await button(page, 'Tablero Tablero 1').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(card(page, 2)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('boards.png') });

  // Proyectos (ADR 0016): pestañas a la derecha desde 800 px; en móvil, la lista desde la cabecera.
  // Son los espacios reales de la sesión y cambiar de uno a otro es navegación real.
  if (isCompact(page)) {
    await expect(page.getByTestId('project-tabs')).toHaveCount(0);
    await button(page, 'Cambiar de proyecto').click();
    await expect(page.getByTestId('project-sheet')).toBeVisible();
    await expect(button(page, 'Guion, proyecto actual')).toBeVisible();
    await button(page, 'Ir al proyecto Primero').click();
  } else {
    const rail = page.getByTestId('project-tabs');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('button')).toHaveCount(2);
    await expect(button(page, 'Guion, proyecto actual')).toHaveAttribute('aria-pressed', 'true');
    // A la derecha del área de trabajo, sin tapar el lienzo.
    const [tabs, canvas] = [await rail.boundingBox(), await page.getByTestId('board-canvas').boundingBox()];
    expect(tabs && canvas && tabs.x >= canvas.x + canvas.width).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('projects-rail.png') });
    await button(page, 'Ir al proyecto Primero').click();
  }
  await expect(page.getByRole('heading', { name: 'Primero', exact: true })).toBeVisible();
  await expect(page.getByTestId('board-empty')).toBeVisible();
  if (!isCompact(page)) await expect(button(page, 'Primero, proyecto actual')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace-sidebar')).toHaveCount((page.viewportSize()?.width ?? 0) >= 1100 ? 1 : 0);
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
  await page.goto('./workspace?id=temporal');
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

/**
 * Distribución según el ancho: barra abajo y hoja de edición en compacto; barra encima e inspector a la
 * derecha desde 800 px; barra lateral desde 1100 px. El lienzo domina y nunca hay desbordamiento.
 */
/** Incumplimientos de la distribución para un ancho; vacío si todo está bien. Se reintenta tras redimensionar. */
async function layoutProblems(page: Page, width: number): Promise<string[]> {
  const problems: string[] = [];
  const [canvas, toolbar, inspector] = await Promise.all(['board-canvas', 'workspace-toolbar', 'card-inspector']
    .map((id) => page.getByTestId(id).boundingBox()));
  if (!canvas || !toolbar || !inspector) return ['falta el lienzo, la barra o el inspector'];
  const height = page.viewportSize()?.height ?? 0;
  if (width >= at.width) {
    if (toolbar.y + toolbar.height > canvas.y) problems.push('la barra no está sobre el lienzo');
    if (inspector.x < canvas.x + canvas.width) problems.push('el inspector no está a la derecha');
    if (await page.getByTestId('inspector-panel').count() !== 1) problems.push('sin panel lateral');
  } else {
    if (toolbar.y < canvas.y + canvas.height) problems.push('la barra no está bajo el lienzo');
    if (inspector.y < canvas.y + canvas.height) problems.push('el editor tapa el lienzo');
    if (await page.getByTestId('inspector-sheet').count() !== 1) problems.push('sin hoja de edición');
    for (const control of await page.getByTestId('workspace-toolbar').getByRole('button').all()) {
      const found = await control.boundingBox();
      if (!found || found.x + found.width > width + 0.5) problems.push('un control de la barra se sale');
    }
  }
  if (await page.getByTestId('workspace-sidebar').count() !== (width >= 1100 ? 1 : 0)) problems.push('barra lateral incorrecta');
  // En escritorio el lienzo ocupa la mayor parte del ancho aun con el inspector abierto.
  if (width >= 1100 && canvas.width <= width * 0.5) problems.push('el lienzo no domina');
  if (canvas.height <= 150) problems.push('lienzo demasiado bajo');
  // La barra de herramientas queda entera dentro de la pantalla.
  if (toolbar.y + toolbar.height > height + 0.5) problems.push('la barra se sale por abajo');
  if (await hasHorizontalOverflow(page)) problems.push('desbordamiento horizontal');
  return problems;
}

/**
 * Distribución según el ancho: barra abajo y hoja de edición en compacto; barra encima e inspector a la
 * derecha desde 800 px; barra lateral desde 1100 px. El lienzo domina y nunca hay desbordamiento.
 */
async function expectLayout(page: Page, width: number) {
  await expect.poll(() => layoutProblems(page, width), { message: `distribución a ${width} px` }).toEqual([]);
}

test('distribución responsive: carga inicial, tablet, 799/800 y redimensionado en ambos sentidos', async ({ page }, testInfo) => {
  const initial = page.viewportSize() ?? desktop;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Responsive');
  await addCards(page, ['nota', 'nota', 'imagen']);
  // La última tarjeta creada se reveló; la primera puede quedar fuera de la vista: se activa con el teclado.
  await tapCard(page, 1);
  // Primera medida con el tamaño inicial, antes de redimensionar.
  await expectLayout(page, initial.width);
  await page.screenshot({ path: testInfo.outputPath('responsive-initial.png') });
  const sizes = initial.width >= at.width ? [phone, below, at, tabletPortrait, tabletLandscape, initial] : [desktop, at, below, tabletLandscape, tabletPortrait, initial];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectLayout(page, size.width);
    if (size === below || size === at) await page.screenshot({ path: testInfo.outputPath(`responsive-${size.width}.png`) });
  }
});

test('accesibilidad del workspace: teclado, foco visible, estados y controles táctiles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Teclado');
  const addNote = button(page, 'Añadir nota');
  const addImage = button(page, 'Añadir imagen de ejemplo');

  // Activación con Enter y Espacio y foco visible en la barra de herramientas.
  await addNote.focus();
  await expect.poll(() => borderColor(addNote)).toBe(rgb(themeColors.light.selection));
  await page.keyboard.press('Enter');
  await expect(card(page, 1)).toBeVisible();
  await addImage.focus();
  await page.keyboard.press('Space');
  await expect(card(page, 2)).toBeVisible();
  await expect(button(page, 'Herramienta Seleccionar')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Herramienta Mano')).toHaveAttribute('aria-pressed', 'false');

  // Las tarjetas se alcanzan con el teclado y se seleccionan con Espacio; los botones del inspector mueven.
  await card(page, 2).focus();
  await expect.poll(() => borderColor(card(page, 2))).toBe(rgb(themeColors.light.selection));
  await card(page, 1).focus();
  await page.keyboard.press('Space');
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  // La segunda tarjeta nace debajo (P2): a la derecha hay sitio.
  const moveRight = button(page, 'Mover a la derecha');
  await moveRight.focus();
  await page.keyboard.press('Enter');
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  expect(await activeLabel(page)).toBe('Mover a la derecha');
  // Escape cancela una conexión a medias.
  await button(page, 'Herramienta Conectar').click();
  await tapCard(page, 2);
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveCount(0);
  await button(page, 'Herramienta Seleccionar').click();

  // Nombres accesibles y controles de al menos 44 × 44 px en todo el workspace.
  const buttons = page.getByTestId('workspace-screen').getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(20);
  for (let index = 0; index < count; index += 1) {
    const control = buttons.nth(index);
    if (!await control.isVisible()) continue;
    const name = await control.getAttribute('aria-label');
    expect(name).toBeTruthy();
    const found = await box(control);
    // Redondeo a centésimas de píxel: Firefox da 43,99997 px a un control de 44 px en una posición
    // fraccionaria (error de coma flotante); 43,99 px seguiría fallando.
    const hundredths = (value: number) => Math.round(value * 100) / 100;
    expect(hundredths(found.width), `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
    expect(hundredths(found.height), `alto de «${name}»`).toBeGreaterThanOrEqual(44);
  }
  for (const label of ['Título de la tarjeta', 'Contenido Markdown']) {
    expect((await box(page.getByLabel(label))).height).toBeGreaterThanOrEqual(44);
  }
  // Las asas tienen un área táctil de 44 px.
  const handle = await box(page.getByTestId('resize-se-tarjeta-1'));
  expect(handle.width).toBeGreaterThanOrEqual(44);
  expect(handle.height).toBeGreaterThanOrEqual(44);
  expect(await hasHorizontalOverflow(page)).toBe(false);
});
