import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { activeLabel, borderColor, hasHorizontalOverflow, rgb, trackProblems, openSettings } from './support';

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
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): esta suite
  // asume el editor abierto tras «tocar» una tarjeta, así que este ayudante pulsa «Editar» a continuación.
  // Sin efecto (a propósito) en una ficha minimizada: no tiene ese botón, solo «Expandir».
  await page.getByTestId(`card-edit-tarjeta-${id}`).click({ timeout: 2000 }).catch(() => {});
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
 * Dos notas lado a lado en la primera fila. Dónde nace la segunda depende del viewport (reproducido
 * el 2026-09-29): en escritorio `findFreeSpace` la coloca pegada a la derecha de la primera, pero en
 * móvil nace debajo (grilla proyectada, ADR 0004). Se lee su posición real y se mueve con los botones
 * del inspector el desplazamiento exacto que haga falta, en vez de asumir ninguno de los dos casos.
 */
async function sideBySide(page: Page) {
  await addCards(page, ['nota', 'nota']);
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): solo hay un botón
  // «Editar» visible, el de la tarjeta recién creada, y se abre para leer y ajustar su posición.
  await page.locator('[data-testid^="card-edit-tarjeta-"]').click();
  const cell = async () => {
    const text = await geometry(page).innerText();
    const grid = /Columna (\d+), fila (\d+)/.exec(text);
    if (grid) return { x: Number(grid[1]) - 1, y: Number(grid[2]) - 1 };
    const world = /X (-?\d+), Y (-?\d+)/.exec(text);
    if (!world) throw new Error(`Geometría ilegible: ${text}`);
    return { x: Number(world[1]), y: Number(world[2]) };
  };
  // Cada paso espera a que se guarde el anterior (la geometría cambia) antes de volver a pulsar.
  const step = async (name: string) => {
    const before = await cell();
    await button(page, name).click();
    await expect.poll(cell).not.toEqual(before);
  };
  while ((await cell()).x < 4) await step('Mover a la derecha');
  while ((await cell()).x > 4) await step('Mover a la izquierda');
  while ((await cell()).y > 0) await step('Mover arriba');
  while ((await cell()).y < 0) await step('Mover abajo');
  await expect(geometry(page)).toHaveText('Columna 5, fila 1 · 4 × 3');
  await closeEditor(page);
  await resetView(page);
}

/** Abre la Configuración, ejecuta `action` y la cierra (ADR 0014: grilla, imán y, en móvil, zoom). */
async function inSettings(page: Page, action: () => Promise<void>) {
  await openSettings(page);
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
  // `card-geometry` vive dentro del editor: seleccionar ya no lo abre por sí solo (auditoría de
  // interacción, 2026-09-29), así que hace falta «Editar» además de tocar la tarjeta.
  await card(page, cardNumber).click();
  await page.getByTestId(`card-edit-tarjeta-${cardNumber}`).click();
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
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await page.getByTestId('card-edit-tarjeta-3').click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();

  // 3. Editar título y Markdown.
  await tapCard(page, 1);
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Título de la tarjeta').fill('Escena inicial');
  await page.getByLabel('Contenido Markdown').fill('# Plano\n\n- abierto');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await expect(card(page, 1)).toContainText('Escena inicial');
  await expect(card(page, 1)).toContainText('Plano');

  // 4. Botones del inspector (alternativa accesible a los gestos) con los errores del motor.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Mover a la izquierda').click();
  await expect(geometry(page)).toHaveText('X -1, Y 0 · 4 × 3');
  await button(page, 'Mover a la derecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  // Reproducido el 2026-09-29: dónde nace la segunda nota depende del viewport (a la derecha en
  // escritorio, debajo en móvil, ADR 0004), pero en ambos «abajo» choca con la tarjeta más próxima.
  await button(page, 'Mover abajo').click();
  await expect(page.getByRole('alert')).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Más estrecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 3 × 3');

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
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 3 × 3');
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
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): nace seleccionada,
  // sin editor que cerrar.
  await addCards(page, ['nota']);
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
  // Un toque corto selecciona, no arrastra (seleccionar ya no abre el editor por sí solo, auditoría
  // de interacción, 2026-09-29).
  await closeEditor(page);
  await page.getByTestId('card-tarjeta-1').tap();
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('card-edit-tarjeta-1').click();
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
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): no hay nada que cerrar.
  await addCards(page, ['nota']);
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
  // Desde 800 px, «Crear un tablero» está siempre visible en la barra lateral. Por debajo, las
  // pestañas de sesión (ADR 0035) reemplazan esa franja: «+» abre el selector, que ofrece crear.
  const tab = (name: string) => page.getByTestId(isCompact(page) ? 'open-tabs' : 'board-tabs').getByRole('button', { name, exact: true });
  const createBoard = async () => {
    if (isCompact(page)) await button(page, 'Abrir un tablero').click();
    await button(page, 'Crear un tablero').click();
  };
  await createBoard();
  await expect(feedback(page)).toHaveText('Tablero creado. Guardado en memoria.');
  await expect(tab('Tablero Tablero 1')).toHaveAttribute('aria-pressed', 'true');
  await addCards(page, ['nota']);
  await createBoard();
  await expect(tab('Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await button(page, 'Crear la primera nota').click();
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Guion', exact: true })).toBeVisible();
  // El tablero y su número de tarjetas: en la cabecera desde 800 px; en móvil, en su pestaña.
  if (isCompact(page)) await expect(tab('Tablero Tablero 2')).toContainText('1');
  else await expect(page.getByText('TABLERO 2 · 1 TARJETA')).toBeVisible();
  await tab('Tablero Tablero 1').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(card(page, 2)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('boards.png') });

  // Pestañas de sesión (ADR 0035): cerrar una no borra el tablero; se reabre desde el selector; no
  // se puede cerrar la última pestaña abierta.
  if (isCompact(page)) {
    await button(page, 'Cerrar la pestaña de Tablero 2').click();
    await expect(tab('Tablero Tablero 2')).toHaveCount(0);
    await button(page, 'Abrir un tablero').click();
    await button(page, 'Abrir el tablero Tablero 2').click();
    await expect(tab('Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 2)).toBeVisible();
    await button(page, 'Cerrar la pestaña de Tablero 1').click();
    await expect(tab('Tablero Tablero 1')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar la pestaña de Tablero 2' })).toHaveCount(0);
  }

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
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await page.getByTestId('card-edit-tarjeta-1').click();
  // Dónde nace la segunda tarjeta depende del viewport (a la derecha en escritorio, debajo en móvil,
  // ADR 0004), así que «arriba» es la única dirección libre en ambos para probar que Enter activa el
  // botón igual que un clic (reproducido el 2026-09-29).
  const moveUp = button(page, 'Mover arriba');
  await moveUp.focus();
  await page.keyboard.press('Enter');
  await expect(geometry(page)).toHaveText('X 0, Y -1 · 4 × 3');
  expect(await activeLabel(page)).toBe('Mover arriba');
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

test('selección múltiple: entrar, recuento, mover el conjunto arrastrando y con flechas, Escape, Todas y archivar (ADR 0025)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Conjunto');
  await sideBySide(page);
  const cell = cellSize(page);
  const count = page.getByTestId('multi-count');

  // Táctil y teclado: «Seleccionar varias» desde el editor; tocar otra la añade y tocarla de nuevo la quita.
  await tapCard(page, 1);
  await button(page, 'Seleccionar varias tarjetas empezando por esta').click();
  await expect(count).toHaveText('1 SELECCIONADA');
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await tapCard(page, 2);
  await expect(count).toHaveText('2 SELECCIONADAS');
  await tapCard(page, 2);
  await expect(count).toHaveText('1 SELECCIONADA');
  await tapCard(page, 2);
  await expect(count).toHaveText('2 SELECCIONADAS');
  await expect(page.getByTestId('resize-s-tarjeta-1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('multi-select.png') });

  // Arrastrar una mueve todas, con vista previa; un solo guardado. Se arrastra la 2: tocarla la trajo a la vista.
  if (isCompact(page)) {
    if (browserName === 'chromium' && testInfo.project.use.hasTouch) await touchDrag(page, card(page, 2), 0, 4 * cell.y);
    else await mouseDrag(page, card(page, 2), 0, 4 * cell.y);
  } else {
    await mouseDrag(page, card(page, 2), 0, 4 * cell.y, { release: false });
    await expect(page.getByTestId('drag-status')).toHaveText('Mover 2 tarjetas: +0 columnas, +4 filas. Escape cancela.');
    await page.mouse.up();
  }
  await expect(feedback(page)).toHaveText('2 tarjetas movidas. Guardado en memoria.');
  await button(page, 'Mover la selección hacia abajo').click();
  await expect(feedback(page)).toHaveText('2 tarjetas movidas. Guardado en memoria.');
  await expect(count).toHaveText('2 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();
  await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  await expectGeometry(page, 1, 'Columna 1, fila 6 · 4 × 3');
  await closeEditor(page);
  await expectGeometry(page, 2, 'Columna 5, fila 6 · 4 × 3');
  await closeEditor(page);

  // Escritorio: Ctrl + clic añade; la que estaba abierta entra en el conjunto. Escape sale.
  if (!isCompact(page)) {
    await card(page, 1).click();
    await card(page, 2).click({ modifiers: ['Control'] });
    await expect(count).toHaveText('2 SELECCIONADAS');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  }

  // «Todas» y archivar el conjunto de una vez: el tablero queda vacío y el Archivo cuenta 2.
  // Con ratón, el doble clic abre el editor directamente (ADR 0021): un solo clic aquí (tan seguido del
  // de la línea anterior) se interpretaría como el segundo toque de ese gesto y desplazaría el botón
  // «Editar» al reflujo del lienzo (auditoría de interacción, 2026-09-29).
  if (isCompact(page)) await tapCard(page, 1);
  else await card(page, 1).dblclick();
  await button(page, 'Seleccionar varias tarjetas empezando por esta').click();
  await button(page, 'Seleccionar todas las tarjetas del tablero').click();
  await expect(count).toHaveText('2 SELECCIONADAS');
  await button(page, 'Archivar las 2 seleccionadas').click();
  await expect(feedback(page)).toHaveText('2 tarjetas archivadas. Guardado en memoria.');
  await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('deshacer y rehacer: mover y archivar, con la barra (o junto al aviso en móvil) y con el teclado; una acción nueva vacía rehacer (ADR 0026)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Historial');
  const undoButton = page.getByRole('button', { name: /^Deshacer/ });
  const redoButton = page.getByRole('button', { name: /^Rehacer/ });
  await expect(undoButton).toHaveAttribute('aria-disabled', 'true');
  await addCards(page, ['nota']);
  await expect(undoButton).toHaveAccessibleName('Deshacer: Nota añadida');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Mover a la
  // derecha» es del editor.
  await page.getByTestId('card-edit-tarjeta-1').click();
  await button(page, 'Mover a la derecha').click();
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');

  // Deshacer con el editor abierto: vuelve a su sitio y el editor muestra lo guardado.
  await button(page, 'Deshacer: Tarjeta movida').click();
  await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await page.screenshot({ path: testInfo.outputPath('undo.png') });
  await button(page, 'Rehacer: Tarjeta movida').click();
  await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  await expect(redoButton).toHaveAttribute('aria-disabled', 'true');

  // Archivar y deshacer: la tarjeta vuelve al tablero y sale del Archivo.
  await button(page, 'Archivar la tarjeta Nueva nota').click();
  await expect(feedback(page)).toHaveText('Tarjeta archivada. Guardado en memoria.');
  await expect(card(page, 1)).toHaveCount(0);
  await button(page, 'Deshacer: Tarjeta archivada').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(feedback(page)).toHaveText('Deshecho: Tarjeta archivada. Guardado en memoria.');

  // Teclado (escritorio): Ctrl + Z deshace fuera de los campos; dentro de un campo no toca el proyecto.
  if (!isCompact(page)) {
    await page.getByTestId('board-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
    await page.keyboard.press('Control+Shift+z');
    await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
    await card(page, 1).click();
    await page.getByTestId('card-edit-tarjeta-1').click();
    await page.getByLabel('Título de la tarjeta').focus();
    await page.keyboard.press('Control+z');
    await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
    await closeEditor(page);
    await button(page, 'Deshacer: Tarjeta movida').click();
    await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
  } else {
    await button(page, 'Deshacer: Tarjeta movida').click();
  }

  // Tras deshacer, una acción nueva vacía rehacer.
  await expect(redoButton).toHaveAccessibleName('Rehacer: Tarjeta movida');
  await addCards(page, ['nota']);
  await expect(redoButton).toHaveAttribute('aria-disabled', 'true');
  expect(runtimeErrors).toEqual([]);
});

test('marcos: agrupar la selección, renombrar, mover con sus tarjetas (flechas y arrastrando el título), añadir nota dentro, sus tarjetas y quitar (ADR 0027)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Marcos');
  await sideBySide(page);
  const frameGeometry = page.getByTestId('frame-geometry');
  const header = page.getByTestId('frame-header-marco-1');
  // Justo después de arrastrar el título, una pulsación en él se descarta 400 ms (es el «click» del
  // gesto): se repite hasta abrir el editor. Seleccionar el marco es idempotente.
  const openFrame = async () => {
    await expect(async () => {
      await header.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('frame-inspector')).toBeVisible({ timeout: 300 });
    }).toPass();
  };
  const closeFrame = async () => {
    await button(page, 'Cerrar el editor del marco').click();
    await expect(page.getByTestId('frame-inspector')).toHaveCount(0);
  };

  // Agrupar: el marco rodea la selección con una fila más arriba para el título y se abre su editor.
  await tapCard(page, 1);
  await button(page, 'Seleccionar varias tarjetas empezando por esta').click();
  await tapCard(page, 2);
  await button(page, 'Agrupar las 2 seleccionadas en un marco').click();
  await expect(feedback(page)).toHaveText('Marco creado con 2 tarjetas. Guardado en memoria.');
  await expect(page.getByTestId('frame-inspector')).toBeVisible();
  await expect(frameGeometry).toHaveText('X 0, Y -1 · 8 × 4');
  await expect(page.getByTestId('frame-members')).toContainText('2 tarjetas dentro');
  await page.getByLabel('Título del marco').fill('Kioto');
  await button(page, 'Guardar el título del marco').click();
  await expect(feedback(page)).toHaveText('Marco renombrado. Guardado en memoria.');
  await expect(header).toContainText('Kioto');

  // Flechas: el marco baja una fila y sus tarjetas con él.
  await button(page, 'Mover el marco abajo').click();
  await expect(feedback(page)).toHaveText('Marco movido. Guardado en memoria.');
  await expect(frameGeometry).toHaveText('Columna 1, fila 1 · 8 × 4');
  await page.screenshot({ path: testInfo.outputPath('frame.png') });
  await closeFrame();
  await expectGeometry(page, 2, 'Columna 5, fila 2 · 4 × 3');
  await closeEditor(page);

  // Arrastrar el título mueve el marco con sus tarjetas, con vista previa.
  const cell = cellSize(page);
  await resetView(page);
  if (isCompact(page)) {
    if (browserName === 'chromium' && testInfo.project.use.hasTouch) await touchDrag(page, header, 0, 2 * cell.y, false);
    else await mouseDrag(page, header, 0, 2 * cell.y, { header: false });
  } else {
    await mouseDrag(page, header, 0, 2 * cell.y, { header: false, release: false });
    await expect(page.getByTestId('drag-status')).toHaveText('Mover el marco «Kioto» con 2 tarjetas: +0 columnas, +2 filas. Escape cancela.');
    await page.mouse.up();
  }
  await expect(feedback(page)).toHaveText('Marco movido. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 4 · 4 × 3');
  await closeEditor(page);

  // Lleno, no añade nada; más alto, la nota aparece dentro (seleccionada, sin abrir su editor por sí sola).
  await openFrame();
  await button(page, 'Añadir nota en el marco').click();
  await expect(feedback(page)).toHaveText('El marco no tiene hueco para otra nota: hazlo más grande.');
  for (let step = 0; step < 3; step += 1) await button(page, 'Marco más alto').click();
  await expect(frameGeometry).toHaveText('Columna 1, fila 3 · 8 × 7');
  await button(page, 'Añadir nota en el marco').click();
  await expect(feedback(page)).toHaveText('Nota añadida en el marco. Guardado en memoria.');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await page.locator('[data-testid^="card-edit-tarjeta-"]').click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await closeEditor(page);

  // Sus tarjetas abren la selección múltiple; quitar el marco deja las tarjetas.
  await openFrame();
  await expect(page.getByTestId('frame-members')).toContainText('3 tarjetas dentro');
  await button(page, 'Seleccionar las tarjetas del marco').click();
  await expect(page.getByTestId('multi-count')).toHaveText('3 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();
  await openFrame();
  await button(page, 'Quitar el marco Kioto').click();
  await expect(feedback(page)).toHaveText('Marco quitado; sus tarjetas siguen en el tablero. Guardado en memoria.');
  await expect(page.getByTestId('frame-marco-1')).toHaveCount(0);
  await expect(card(page, 3)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('vista general: selección por área, un toque en el fondo cierra el editor, «Ver todo», minimapa y zoom en móvil (ADR 0028)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Vista');
  await sideBySide(page);
  const canvas = await box(page.getByTestId('board-canvas'));
  const cell = cellSize(page);

  // Arrastrar sobre el fondo, de abajo a la derecha hacia la primera tarjeta, selecciona las que toca.
  const from = { x: canvas.x + canvas.width - 24, y: canvas.y + 5 * cell.y };
  const to = { x: canvas.x + 30, y: canvas.y + 30 };
  if (isCompact(page) && browserName === 'chromium' && testInfo.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y) }] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(from.x + ((to.x - from.x) * step) / 10), y: Math.round(from.y + ((to.y - from.y) * step) / 10) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await expect(page.getByTestId('selection-area')).toBeVisible();
    await page.mouse.up();
  }
  await expect(page.getByTestId('multi-count')).toHaveText('2 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();

  // Un toque en el fondo (sin arrastrar) sigue cerrando el editor.
  await tapCard(page, 1);
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await revealCanvas(page);
  // Con el editor abierto, el lienzo es más estrecho (escritorio): el punto se toma del lienzo actual.
  const now = await box(page.getByTestId('board-canvas'));
  await page.mouse.click(now.x + 20, now.y + 6 * cell.y);
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);

  // Una tarjeta lejos: «Ver todo» encuadra las dos con menos zoom.
  await tapCard(page, 2);
  for (let step = 0; step < 10; step += 1) await button(page, 'Mover abajo').click();
  await expect(geometry(page)).toHaveText('Columna 5, fila 11 · 4 × 3');
  await closeEditor(page);
  await resetView(page);
  await button(page, 'Ver todo el tablero').click();
  await expect(page.getByTestId(isCompact(page) ? 'canvas-zoom' : 'zoom-level')).not.toContainText('100 %');
  // Las dos se ven enteras y ninguna queda bajo los controles inferiores.
  const controls = await box(page.getByTestId('canvas-controls'));
  for (const id of [1, 2]) {
    const found = await box(card(page, id));
    expect(found.y).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(found.y + found.height).toBeLessThanOrEqual(controls.y + 1);
  }

  // Minimapa: tocar la esquina de arriba lleva la vista hacia la primera tarjeta.
  await button(page, 'Mostrar el minimapa').click();
  const map = page.getByTestId('canvas-minimap');
  await expect(map).toHaveAccessibleName('Minimapa: 2 tarjetas; toca para ir a esa zona');
  await page.screenshot({ path: testInfo.outputPath('minimap.png') });
  const before = await box(card(page, 2));
  const mapBox = await box(map);
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height - 8);
  await expect.poll(async () => (await box(card(page, 2))).y).toBeLessThan(before.y);
  await button(page, 'Ocultar el minimapa').click();
  await expect(map).toHaveCount(0);

  // Móvil: el zoom está en los controles del lienzo, sin abrir Configuración.
  if (isCompact(page)) {
    await button(page, 'Acercar la vista').click();
    await expect(page.getByTestId('canvas-zoom')).toHaveText('75 %');
    await page.getByTestId('canvas-zoom').click();
    await expect(page.getByTestId('canvas-zoom')).toHaveText('100 %');
  }
  expect(runtimeErrors).toEqual([]);
});
