import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { themeColors } from '../../packages/ui/src/theme';
import { hasHorizontalOverflow, isCompactWidth, rgb, trackProblems, openSettings } from './support';

// Configuración (ADR 0014), representación de tarjetas, imágenes reales y Papelera (ADR 0015).
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
const image = fileURLToPath(new URL('../../apps/noutynotes/assets/branding/app-icon.png', import.meta.url));

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Elemento sin geometría medible');
  return found;
}

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Añade una nota y le pone título; queda seleccionada. */
async function addNote(page: Page, title: string) {
  const before = await page.locator('[data-testid^="card-tarjeta-"]').count();
  await button(page, 'Añadir nota').click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(before + 1);
  // El inspector debe mostrar ya la tarjeta nueva antes de escribir.
  await expect(card(page, before + 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Título de la tarjeta').fill(title);
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
}

async function closeEditor(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}

test('configuración: modal o panel, cambios al instante, restablecer, Escape y preferencias del dispositivo', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  const compact = (page.viewportSize()?.width ?? 0) < 800;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Ajustes');
  await addNote(page, 'Primera');
  await closeEditor(page);
  const initial = await box(card(page, 1));

  await openSettings(page);
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
  // Móvil: hoja inferior que deja ver el lienzo; escritorio: modal centrado.
  const sheet = await box(panel);
  const canvas = await box(page.getByTestId('board-canvas'));
  if (compact) {
    expect(Math.round(sheet.y + sheet.height)).toBe(page.viewportSize()?.height);
    expect(sheet.y).toBeGreaterThan(canvas.y + 40);
  } else {
    expect(Math.abs(sheet.x + sheet.width / 2 - (page.viewportSize()?.width ?? 0) / 2)).toBeLessThan(2);
  }
  await page.screenshot({ path: testInfo.outputPath('settings-open.png') });

  // Grilla e imán: interruptores reales, anunciados con su estado.
  const grid = page.getByRole('switch', { name: 'Mostrar grilla' });
  await expect(grid).toHaveAttribute('aria-checked', 'true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('canvas-grid')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Imán en la vista previa' }).click();
  await expect(page.getByRole('switch', { name: 'Imán en la vista previa' })).toHaveAttribute('aria-checked', 'false');

  // Densidad: la ficha de 3 filas crece 3 × 8 px al subir el alto de fila; la separación cambia su ancho.
  await button(page, 'Aumentar alto de fila').click();
  await expect(panel).toContainText('72 px');
  await expect.poll(async () => Math.round((await box(card(page, 1))).height - initial.height)).toBe(24);
  await button(page, 'Reducir separación entre fichas').click();
  await expect(panel).toContainText('6 px');
  await expect.poll(async () => Math.round((await box(card(page, 1))).width - initial.width)).toBe(2);
  // Zoom desde la configuración (en móvil es el único sitio) y restablecer vista.
  await button(page, 'Acercar el lienzo').click();
  await expect(page.getByTestId('settings-zoom')).toHaveText('125 %');
  await button(page, 'Restablecer la vista del lienzo').click();
  await expect(page.getByTestId('settings-zoom')).toHaveText('100 %');

  // Escape cierra; al reabrir la configuración se conserva, y tras recargar sigue en este dispositivo.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Otro');
  await openSettings(page);
  await expect(page.getByTestId('settings-panel')).toContainText('72 px');
  await expect(page.getByRole('switch', { name: 'Mostrar grilla' })).toHaveAttribute('aria-checked', 'false');
  await button(page, 'Restablecer los valores de lienzo y grilla').click();
  await expect(page.getByTestId('settings-panel')).toContainText('64 px');
  await expect(page.getByRole('switch', { name: 'Mostrar grilla' })).toHaveAttribute('aria-checked', 'true');

  // Controles táctiles y nombres accesibles dentro del panel.
  for (const control of await page.getByTestId('settings-panel').getByRole('button').all()) {
    expect(await control.getAttribute('aria-label')).toBeTruthy();
    const found = await box(control);
    expect(found.height).toBeGreaterThanOrEqual(44);
    expect(found.width).toBeGreaterThanOrEqual(44);
  }
  await button(page, 'Cerrar configuración').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('minimizar, contraer y expandir: cabecera e inspector; la colisión al expandir se resuelve a elección', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Formas');
  await addNote(page, 'Primera');
  await addNote(page, 'Segunda');
  await tapCard(page, 1);
  await button(page, 'Minimizar Primera').click();
  await expect(feedback(page)).toHaveText('Tarjeta minimizada. Guardado en memoria.');
  // Icono de nota y título, no una inicial (ADR 0016).
  await expect(page.getByTestId('minimized-icon-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('minimized-tarjeta-1')).toContainText('Primera');
  // El tamaño expandido se conserva aunque la huella sea 1 × 1.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Primera, minimizada');
  // Una ficha minimizada sigue siendo tocable en móvil.
  const tile = await box(card(page, 1));
  expect(tile.width).toBeGreaterThanOrEqual(44);
  expect(tile.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('minimized.png') });

  // Segunda ocupa el sitio que Primera necesita para expandirse. Desde P2 la segunda nota nace
  // debajo, dentro de lo visible: se sube dos filas, junto a la ficha minimizada sin tocarla.
  await tapCard(page, 2);
  await expect(geometry(page)).toHaveText('Columna 1, fila 4 · 4 × 3');
  for (let step = 0; step < 2; step += 1) await button(page, 'Mover arriba').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 4 × 3');
  await tapCard(page, 1);
  await button(page, 'Expandir Primera').click();
  await expect(feedback(page)).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(page.getByTestId('relocate-offer')).toBeVisible();
  await expect(page.getByTestId('minimized-tarjeta-1')).toBeVisible();
  await button(page, 'Expandir en un hueco libre').click();
  await expect(feedback(page)).toHaveText('Tarjeta expandida en un hueco libre. Guardado en memoria.');
  await expect(page.getByTestId('minimized-tarjeta-1')).toHaveCount(0);
  await expect(geometry(page)).toHaveText('Columna 5, fila 1 · 4 × 3');

  // Contraer desde el inspector; conexiones intactas.
  await button(page, 'Conectar con Segunda').click();
  await button(page, 'Mostrar contraída').click();
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Primera, contraída');
  await expect(card(page, 1)).toContainText('Primera');
  await expect(button(page, 'Mostrar contraída')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('card-connections')).toContainText('→ Segunda');
});

test('controles de cabecera: −, contraer/expandir y ×, sin seleccionar; menú «⋯» si no caben; 44 px con cualquier zoom (ADR 0016)', async ({ page }, testInfo) => {
  const compact = (page.viewportSize()?.width ?? 0) < 800;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Cabeceras');
  await addNote(page, 'Guion');
  await addNote(page, 'Notas');
  await closeEditor(page);
  // «Notas» se reveló al crearla; en móvil «Guion» puede quedar por encima. El foco del teclado
  // la trae a la vista sin seleccionarla (la selección no cambia).
  await card(page, 1).focus();
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await box(card(page, 1))).y).toBeGreaterThanOrEqual((await box(page.getByTestId('board-canvas'))).y);
  // Sin selección, cada tarjeta ya muestra sus controles en la cabecera, dentro de su rectángulo.
  const controls = page.getByTestId('card-controls-tarjeta-1');
  await expect(controls.getByRole('button')).toHaveCount(3);
  const [head, face] = [await box(controls), await box(card(page, 1))];
  expect(head.x).toBeGreaterThanOrEqual(face.x);
  expect(head.x + head.width).toBeLessThanOrEqual(face.x + face.width + 0.5);
  expect(head.y).toBeGreaterThanOrEqual(face.y);
  for (const control of await controls.getByRole('button').all()) {
    const found = await box(control);
    expect([Math.round(found.width), Math.round(found.height)]).toEqual([44, 44]);
  }
  await page.screenshot({ path: testInfo.outputPath('header-controls.png') });

  // «▭» contrae a una barra de título y «□» la expande.
  await button(page, 'Contraer Guion').click();
  await expect(feedback(page)).toHaveText('Tarjeta contraída. Guardado en memoria.');
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Guion, contraída');
  await button(page, 'Expandir Guion').click();
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Guion');

  // «−» minimiza: icono y título; sin selección la ficha no lleva controles, seleccionada, una tira.
  await button(page, 'Minimizar Notas').click();
  await expect(page.getByTestId('minimized-icon-tarjeta-2')).toBeVisible();
  await expect(page.getByTestId('card-controls-tarjeta-2')).toHaveCount(0);
  await tapCard(page, 2);
  await expect(page.getByTestId('card-controls-tarjeta-2').getByRole('button')).toHaveCount(2);
  // Sin asas de redimensionado: no se solapan con la tira ni cambian un tamaño que no se ve.
  await expect(page.locator('[data-testid^="resize-"][data-testid$="-tarjeta-2"]')).toHaveCount(0);
  await expect(button(page, 'Expandir Notas')).toBeVisible();
  await closeEditor(page);

  // Con Conectar o Mano no hay controles: no compiten con esas herramientas.
  await button(page, 'Herramienta Conectar').click();
  await expect(page.locator('[data-testid^="card-controls-"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await button(page, 'Herramienta Seleccionar').click();

  // Si no caben los tres, un único «⋯» abre el menú con las mismas acciones.
  await tapCard(page, 1);
  for (let step = 0; step < 2; step += 1) await button(page, 'Más estrecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 2 × 3');
  const narrow = await box(card(page, 1));
  // Umbral real de chromeFor (auditoría visual, 2026-09-29): 3 controles de 44 px más una franja libre
  // de 80 px para el tipo/arrastrar (antes 44 px; con solo eso, los controles dominaban la cabecera).
  const needsMenu = narrow.width < 3 * 44 + 4 + 80;
  if (needsMenu) {
    await button(page, 'Acciones de Guion').click();
    await expect(page.getByTestId('card-menu')).toBeVisible();
    await button(page, 'Minimizar Guion').click();
    await expect(page.getByTestId('card-menu')).toHaveCount(0);
    await expect(page.getByTestId('minimized-tarjeta-1')).toBeVisible();
    await button(page, 'Expandir Guion').click();
  }

  // «×» envía a la Papelera existente, no elimina definitivamente (en una tarjeta estrecha, desde «⋯»).
  if (needsMenu) await button(page, 'Acciones de Guion').click();
  await button(page, 'Enviar Guion a la Papelera').click();
  await expect(feedback(page)).toHaveText('Tarjeta enviada a la Papelera. Guardado en memoria.');
  await expect(button(page, 'Abrir la Papelera (1)')).toBeVisible();

  // Con el zoom alejado siguen midiendo 44 px reales (escritorio: zoom en la barra).
  if (!compact) {
    await button(page, 'Alejar').click();
    await button(page, 'Alejar').click();
    await tapCard(page, 2);
    for (const control of await page.getByTestId('card-controls-tarjeta-2').getByRole('button').all()) {
      expect(Math.round((await box(control)).width)).toBe(44);
    }
  }
});

test('imagen real: vista previa, formato inválido, cancelación y ejemplo separado', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Fotos');

  // Cancelar el selector no cambia nada.
  let chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar una imagen').click();
  await (await chooser).element().evaluate((element) => element.dispatchEvent(new Event('cancel')));
  await expect(feedback(page)).toHaveText('No se eligió ninguna imagen. No cambió nada.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(0);

  // Un archivo que no es imagen se rechaza por su contenido, aunque se llame .png.
  chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar una imagen').click();
  await (await chooser).setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('no soy una imagen') });
  await expect(feedback(page)).toHaveText('Formato no admitido. Usa una imagen PNG, JPEG, GIF o WebP.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(0);

  // Una imagen real se copia al espacio y se ve sin red.
  chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar una imagen').click();
  await (await chooser).setFiles(image);
  await expect(feedback(page)).toHaveText('Imagen «app-icon.png» importada. Guardado en memoria.');
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('image-preview-tarjeta-1')).toHaveAttribute('aria-label', 'Imagen app-icon');
  await expect(page.getByTestId('image-preview-tarjeta-1')).toHaveAttribute('role', 'img');
  await expect(page.getByTestId('card-asset')).toHaveText('assets/images/tarjeta-1.png');
  await expect(page.getByTestId('export-status')).toContainText('CAMBIOS SIN EXPORTAR');

  // El ejemplo sigue disponible y claramente separado: sin archivo.
  await button(page, 'Añadir imagen de ejemplo').click();
  await expect(card(page, 2)).toContainText('IMAGEN DE EJEMPLO');
  await expect(page.getByRole('img', { name: 'Imagen de ejemplo (marcador de posición, sin archivo)' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('image-imported.png') });
  expect(runtimeErrors).toEqual([]);
});

test('Papelera: enviar, restaurar con conexiones y eliminar definitivamente con confirmación', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Limpieza');
  await addNote(page, 'Primera');
  await addNote(page, 'Segunda');
  // En móvil «Primera» queda por encima de la vista tras revelar «Segunda»: se activa con el teclado.
  await tapCard(page, 1);
  await button(page, 'Conectar con Segunda').click();
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);

  await button(page, 'Enviar Primera a la Papelera').click();
  await expect(feedback(page)).toHaveText('Tarjeta enviada a la Papelera. Guardado en memoria.');
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);
  await button(page, 'Abrir la Papelera (1)').click();
  await expect(page.getByTestId('trash-item-tarjeta-1')).toContainText('Primera');
  await page.screenshot({ path: testInfo.outputPath('trash-open.png') });
  await button(page, 'Restaurar Primera').click();
  await expect(feedback(page)).toHaveText('Tarjeta restaurada. Guardado en memoria.');
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  await button(page, 'Cerrar papelera').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);

  // Eliminar definitivamente pide confirmación con el nombre; cancelar no cambia nada.
  await card(page, 1).click();
  await button(page, 'Enviar la tarjeta Primera a la Papelera').click();
  await button(page, 'Abrir la Papelera (1)').click();
  await button(page, 'Eliminar definitivamente Primera').click();
  await expect(page.getByTestId('purge-confirmation')).toContainText('¿Eliminar definitivamente «Primera»? No se puede deshacer.');
  await button(page, 'Cancelar la eliminación').click();
  await expect(page.getByTestId('trash-item-tarjeta-1')).toBeVisible();
  await button(page, 'Eliminar definitivamente Primera').click();
  await button(page, 'Confirmar eliminar definitivamente Primera').click();
  await expect(feedback(page)).toHaveText('Tarjeta eliminada definitivamente. Guardado en memoria.');
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  await expect(page.getByTestId('trash-panel')).toHaveCSS('border-color', rgb(themeColors.light.border));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('trash-panel')).toHaveCount(0);
  await expect(button(page, 'Abrir la Papelera (0)')).toBeVisible();
});

test('regresión: enfocar una tarjeta fuera del lienzo la trae con el pan, nunca con scroll nativo', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Foco');
  const canvas = page.getByTestId('board-canvas');
  const offset = async () => {
    const [content, viewport] = [await box(page.getByTestId('canvas-content')), await box(canvas)];
    return Math.round(content.x - viewport.x);
  };
  const origin = await offset();
  await addNote(page, 'Escondida');
  await closeEditor(page);
  // Desde P2 las tarjetas nuevas aparecen dentro de lo que se ve. Para esconderla, la persona
  // desplaza el lienzo con la Mano, como haría para explorar el tablero.
  const panBy = async (dx: number) => {
    await button(page, 'Herramienta Mano').click();
    // Se agarra por el borde opuesto al sentido del arrastre: el puntero no sale de la ventana.
    const frame = await box(canvas);
    const [x, y] = [dx < 0 ? frame.x + frame.width - 8 : frame.x + 8, frame.y + frame.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y);
    await page.mouse.up();
    await button(page, 'Herramienta Seleccionar').click();
  };
  const visible = await box(canvas);

  // A la izquierda, donde el scroll nativo nunca llega.
  await panBy(-visible.width);
  const left = await box(card(page, 1));
  expect(left.x + left.width).toBeLessThanOrEqual(visible.x);
  const panned = await offset();
  // Un scroll nativo (del navegador o de Playwright) se deshace: el contenido no se separa del pan.
  await canvas.evaluate((element) => { element.scrollLeft = 300; });
  await expect.poll(offset).toBe(panned);
  expect(await canvas.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  // El foco del teclado la trae con el pan y después se puede activar.
  await tapCard(page, 1);
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await box(card(page, 1))).x).toBeGreaterThanOrEqual(visible.x);
  expect(await canvas.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  await closeEditor(page);

  // A la derecha: tampoco la muestra el scroll nativo, sino el foco.
  await panBy(visible.width - 16);
  await panBy(visible.width - 16);
  const right = await box(card(page, 1));
  expect(right.x).toBeGreaterThanOrEqual(visible.x + visible.width);
  await card(page, 1).focus();
  await expect.poll(async () => (await box(card(page, 1))).x + (await box(card(page, 1))).width).toBeLessThanOrEqual(visible.x + visible.width);
  expect(await canvas.evaluate((element) => element.scrollLeft)).toBe(0);

  // El desplazamiento vive en el pan: restablecer la vista vuelve al origen.
  if ((page.viewportSize()?.width ?? 0) < 800) {
    await openSettings(page);
    await button(page, 'Restablecer la vista del lienzo').click();
    await button(page, 'Cerrar configuración').click();
  } else {
    await button(page, 'Zoom 100 %, restablecer a 100 %').click();
  }
  await expect.poll(offset).toBe(origin);
  expect(await canvas.evaluate((element) => element.scrollLeft)).toBe(0);
});

test('regresión: «Restablecer vista» vuelve al origen aunque haya una tarjeta seleccionada', async ({ page }) => {
  const compact = (page.viewportSize()?.width ?? 0) < 800;
  await page.goto('./');
  await createWorkspace(page, 'Origen');
  const canvas = page.getByTestId('board-canvas');
  const offset = async () => {
    const [content, frame] = [await box(page.getByTestId('canvas-content')), await box(canvas)];
    return [Math.round(content.x - frame.x), Math.round(content.y - frame.y)];
  };
  const origin = await offset();
  await addNote(page, 'Lejana');
  // Los botones del inspector la llevan lejos: la cámara la sigue para que no se pierda de vista.
  for (let step = 0; step < 10; step += 1) await button(page, 'Mover a la derecha').click();
  await expect(geometry(page)).toContainText('Columna 11');
  await expect.poll(async () => (await offset())[0]).toBeLessThan(origin[0] ?? 0);
  // Acercar y restablecer: vuelve al origen y a 100 %, sin que la selección vuelva a mover la cámara.
  if (compact) {
    await openSettings(page);
    await button(page, 'Acercar el lienzo').click();
    await button(page, 'Restablecer la vista del lienzo').click();
    await button(page, 'Cerrar configuración').click();
  } else {
    await button(page, 'Acercar').click();
    await button(page, 'Zoom 125 %, restablecer a 100 %').click();
  }
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(offset).toEqual(origin);
  expect(await canvas.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
});

test('P3: listas con teclado (continuar, terminar, renumerar sin perder el cursor), casilla táctil y HTML/JS como texto', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Listas');
  await addNote(page, 'Receta');
  const editor = page.getByLabel('Contenido Markdown');

  // Numerada con Enter: continúa, y Enter en un elemento vacío termina la lista.
  await button(page, 'Insertar lista numerada').click();
  await expect(editor).toHaveValue('1. ');
  await editor.focus();
  await editor.press('End');
  await editor.pressSequentially('Harina');
  await editor.press('Enter');
  await expect(editor).toHaveValue('1. Harina\n2. ');
  await editor.pressSequentially('Agua');
  await editor.press('Enter');
  await editor.pressSequentially('Sal');
  await editor.press('Enter');
  await editor.press('Enter');
  await expect(editor).toHaveValue('1. Harina\n2. Agua\n3. Sal\n\n');
  // Borrar la primera línea renumera el resto (empieza otra vez en 1) y el cursor sigue donde estaba:
  // al comienzo de la línea que sube; después, al final de «Agua».
  await editor.press('Control+Home');
  await editor.press('Shift+ArrowDown');
  await editor.press('Delete');
  await expect(editor).toHaveValue('1. Agua\n2. Sal\n\n');
  await editor.pressSequentially('> ');
  await expect(editor).toHaveValue('> 1. Agua\n2. Sal\n\n');
  await editor.fill('1. Agua\n2. Sal\n\n');
  await editor.press('Control+Home');
  await editor.press('End');
  await editor.pressSequentially(' fría');
  await expect(editor).toHaveValue('1. Agua fría\n2. Sal\n\n');

  // Insertar una lista con el cursor en mitad del texto solo toca esa línea y deja el cursor al final.
  await editor.fill('Notas\nlibres');
  await editor.press('Control+End');
  await button(page, 'Insertar lista con guiones').click();
  await expect(editor).toHaveValue('Notas\n- libres');
  await editor.focus();
  await editor.pressSequentially('!');
  await expect(editor).toHaveValue('Notas\n- libres!');

  // Casillas: se marcan desde la vista con un toque real en móvil (o un clic en escritorio).
  await editor.fill('- [ ] Comprar\n- [ ] Cocinar');
  const check = button(page, 'Marcar tarea Cocinar');
  if (testInfo.project.use.hasTouch) await check.tap();
  else await check.click();
  await expect(editor).toHaveValue('- [ ] Comprar\n- [x] Cocinar');

  // HTML, CSS y JavaScript de una nota son texto: se ven literales y no se ejecutan.
  const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><style>body{display:none}</style>';
  await editor.fill(hostile);
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await expect(card(page, 1)).toContainText('<script>window.__pwned=2</script>');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await card(page, 1).locator('script, img[src="x"], style').count()).toBe(0);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test('P3: el título flotante se edita, se mueve, se minimiza y vuelve de la Papelera en su sitio', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Rótulo');
  await button(page, 'Añadir título flotante').click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toBeVisible();
  await page.getByLabel('Título de la tarjeta').fill('Proyecto Solace');
  await button(page, 'Guardar texto').click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
  await button(page, 'Mover abajo').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 6 × 2');
  await button(page, 'Minimizar Proyecto Solace').click();
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Proyecto Solace, minimizada');
  await button(page, 'Expandir Proyecto Solace').click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
  await button(page, 'Enviar Proyecto Solace a la Papelera').click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toHaveCount(0);
  await button(page, 'Abrir la Papelera (1)').click();
  await button(page, 'Restaurar Proyecto Solace').click();
  await button(page, 'Cerrar papelera').click();
  await tapCard(page, 1);
  await expect(geometry(page)).toHaveText('Columna 1, fila 2 · 6 × 2');
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
});

test('etiquetas y búsqueda local: añadir y quitar, pie de la tarjeta, palabras y #etiqueta, «Ir» a otro tablero, renombrar fusionando y quitar de todas (ADR 0019)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Viaje');
  await addNote(page, 'Kioto');
  const tagInput = page.getByTestId('tag-input');
  await expect(page.getByTestId('card-tags')).toContainText('Sin etiquetas.');
  // Se normaliza como la escribe la persona: sin «#», en minúsculas.
  await tagInput.fill('#Japón');
  await button(page, 'Añadir la etiqueta').click();
  await expect(feedback(page)).toHaveText('Etiqueta añadida. Guardado en memoria.');
  await expect(button(page, 'Quitar la etiqueta japón')).toBeVisible();
  await expect(tagInput).toHaveValue('');
  await expect(page.getByTestId('card-tags-tarjeta-1')).toHaveText('#japón');
  // Texto de la ficha: en oscuro la ficha sigue clara y el color de selección no se leería (1,4:1).
  await expect(page.getByTestId('card-tags-tarjeta-1')).toHaveCSS('color', rgb(themeColors.light.cardText));
  // Una etiqueta no válida no se añade y el campo conserva lo escrito para corregirlo.
  await tagInput.fill('dos palabras');
  await button(page, 'Añadir la etiqueta').click();
  await expect(feedback(page)).not.toHaveText('Etiqueta añadida. Guardado en memoria.');
  await expect(tagInput).toHaveValue('dos palabras');
  await tagInput.fill('borrar');
  await tagInput.press('Enter');
  await expect(button(page, 'Quitar la etiqueta borrar')).toBeVisible();
  await button(page, 'Quitar la etiqueta borrar').click();
  await expect(button(page, 'Quitar la etiqueta borrar')).toHaveCount(0);
  await expect(page.getByTestId('card-tags-tarjeta-1')).toHaveText('#japón');

  // El «#» escrito en el texto no es una etiqueta.
  await addNote(page, 'Lisboa');
  await page.getByLabel('Contenido Markdown').fill('Tranvía 28 #hola');
  await button(page, 'Guardar texto').click();
  await tagInput.fill('portugal');
  await button(page, 'Añadir la etiqueta').click();
  await expect(page.getByTestId('card-tags-tarjeta-2')).toHaveText('#portugal');
  await closeEditor(page);

  // Otro tablero con una tarjeta etiquetada sin acento: «japon» y «japón» son etiquetas distintas.
  // Por debajo de 800 px, «Crear un tablero» está en el selector de pestañas «+» (ADR 0035).
  if (isCompactWidth(page)) await button(page, 'Abrir un tablero').click();
  await button(page, 'Crear un tablero').click();
  await button(page, 'Crear la primera nota').click();
  await page.getByLabel('Título de la tarjeta').fill('Osaka');
  await button(page, 'Guardar texto').click();
  await tagInput.fill('japon');
  await button(page, 'Añadir la etiqueta').click();
  await expect(page.getByTestId('card-tags-tarjeta-3')).toHaveText('#japon');
  await closeEditor(page);

  await button(page, 'Abrir la búsqueda').click();
  const panel = page.getByTestId('search-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('search-count')).toHaveText('RESULTADOS');
  await expect(button(page, 'Filtrar por #japon (1 tarjeta)')).toBeVisible();
  await expect(button(page, 'Filtrar por #japón (1 tarjeta)')).toBeVisible();
  await expect(button(page, 'Filtrar por #portugal (1 tarjeta)')).toBeVisible();
  await expect(panel.getByRole('button', { name: /hola/ })).toHaveCount(0);
  // Palabras sin mayúsculas ni acentos, en el texto; el extracto es literal.
  const query = page.getByTestId('search-input');
  await query.fill('TRANVIA');
  await expect(panel.getByTestId('search-count')).toHaveText('1 RESULTADO');
  await expect(panel.getByTestId('search-result-tarjeta-2')).toContainText('Tranvía 28 #hola');
  await expect(panel.getByTestId('search-result-tarjeta-2')).toContainText('NOTA · Tablero principal');
  await query.fill('nada-parecido');
  await expect(panel.getByTestId('search-empty')).toHaveText('Sin resultados para «nada-parecido».');
  // «#japon» filtra sin acentos: encuentra las dos etiquetas.
  await query.fill('#japon');
  await expect(panel.getByTestId('search-count')).toHaveText('2 RESULTADOS');
  await query.fill('');
  await button(page, 'Filtrar por #japón (1 tarjeta)').click();
  await expect(query).toHaveValue('#japón');
  await expect(button(page, 'Quitar el filtro #japón (1 tarjeta)')).toHaveAttribute('aria-pressed', 'true');
  await query.fill('kioto');
  await page.screenshot({ path: testInfo.outputPath('search-open.png') });

  // «Ir» cambia al tablero de la tarjeta y la selecciona.
  await expect(card(page, 1)).toHaveCount(0);
  await button(page, 'Ir a Kioto').click();
  await expect(panel).toHaveCount(0);
  await expect(button(page, 'Tablero Tablero principal')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 1)).toBeInViewport();
  await closeEditor(page);

  // Renombrar pide confirmación con el recuento; al coincidir con otra etiqueta, se fusionan.
  await button(page, 'Abrir la búsqueda').click();
  await button(page, 'Renombrar la etiqueta japon').click();
  await expect(page.getByTestId('tag-confirmation')).toContainText('Renombrar #japon en 1 tarjeta');
  await button(page, 'Cancelar el cambio de etiqueta').click();
  await expect(page.getByTestId('tag-confirmation')).toHaveCount(0);
  await button(page, 'Renombrar la etiqueta japon').click();
  await page.getByTestId('tag-rename-input').fill('#Japón');
  await button(page, 'Confirmar renombrar japon').click();
  await expect(feedback(page)).toHaveText('Etiqueta renombrada. Guardado en memoria.');
  await expect(button(page, 'Filtrar por #japón (2 tarjetas)')).toBeVisible();
  await expect(button(page, 'Filtrar por #japon (1 tarjeta)')).toHaveCount(0);

  await button(page, 'Quitar la etiqueta japón de todas las tarjetas').click();
  await expect(page.getByTestId('tag-confirmation')).toContainText('¿Quitar #japón de 2 tarjetas (y de la Papelera)?');
  await button(page, 'Confirmar quitar japón de todas').click();
  await expect(feedback(page)).toHaveText('Etiqueta quitada de todas las tarjetas. Guardado en memoria.');
  await expect(button(page, 'Filtrar por #portugal (1 tarjeta)')).toBeVisible();
  await expect(panel.getByRole('button', { name: /japón/ })).toHaveCount(0);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-tags-tarjeta-1')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('enlaces: crear con validación, abrir en pestaña nueva con noopener, editar la dirección y buscarla; filtro por tipo (ADR 0020)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Lecturas');
  // Abrir no navega de verdad en la prueba: se registra lo que se pidió al navegador.
  await page.evaluate(() => {
    (window as unknown as { opened: unknown[] }).opened = [];
    window.open = ((...args: unknown[]) => { (window as unknown as { opened: unknown[] }).opened.push(args); return null; }) as typeof window.open;
  });
  await button(page, 'Añadir enlace').click();
  const dialog = page.getByTestId('link-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('link-url-input').fill('javascript:alert(1)');
  await button(page, 'Crear enlace').click();
  await expect(page.getByTestId('link-problem')).toHaveText('Usa una dirección web (https://…) o de correo (mailto:…).');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(0);
  await page.getByTestId('link-url-input').fill('ejemplo.com/guia');
  await page.screenshot({ path: testInfo.outputPath('link-dialog.png') });
  await button(page, 'Crear enlace').click();
  await expect(dialog).toHaveCount(0);
  await expect(feedback(page)).toHaveText('Enlace añadido. Guardado en memoria.');
  // Sin título, el dominio; la ficha muestra la dirección sin descargar nada.
  await expect(card(page, 1)).toContainText('ejemplo.com');
  await expect(page.getByTestId('card-link-tarjeta-1')).toHaveText('↗ ejemplo.com/guia');
  await expect(page.getByTestId('link-input')).toHaveValue('https://ejemplo.com/guia');

  await button(page, 'Abrir el enlace https://ejemplo.com/guia').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { opened: unknown[] }).opened)).toEqual([['https://ejemplo.com/guia', '_blank', 'noopener']]);

  const input = page.getByTestId('link-input');
  await input.fill('file:///etc/passwd');
  await button(page, 'Guardar enlace').click();
  await expect(feedback(page)).toHaveText('Usa una dirección web (https://…) o de correo (mailto:…).');
  await expect(page.getByTestId('card-link-tarjeta-1')).toHaveText('↗ ejemplo.com/guia');
  await input.fill('otro.org/leer');
  await button(page, 'Guardar enlace').click();
  await expect(feedback(page)).toHaveText('Enlace guardado. Guardado en memoria.');
  await expect(input).toHaveValue('https://otro.org/leer');
  await expect(page.getByTestId('card-link-tarjeta-1')).toHaveText('↗ otro.org/leer');
  await page.screenshot({ path: testInfo.outputPath('link-card.png') });
  await closeEditor(page);

  // La búsqueda encuentra la tarjeta por su dirección; el filtro por tipo limita el resultado.
  await addNote(page, 'Leer después');
  await closeEditor(page);
  await button(page, 'Abrir la búsqueda').click();
  await page.getByTestId('search-input').fill('otro.org');
  await expect(page.getByTestId('search-count')).toHaveText('1 RESULTADO');
  await expect(page.getByTestId('search-result-tarjeta-1')).toContainText('ENLACE · Tablero principal');
  await page.getByTestId('search-input').fill('');
  await button(page, 'Solo Nota (1 tarjeta)').click();
  await expect(page.getByTestId('search-count')).toHaveText('1 RESULTADO');
  await expect(page.getByTestId('search-result-tarjeta-2')).toBeVisible();
  await button(page, 'Quitar el filtro Nota (1 tarjeta)').click();
  await expect(page.getByTestId('search-count')).toHaveText('RESULTADOS');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('búsqueda en todos los proyectos: explícita, agrupada, con aviso de consulta cambiada e «Ir» a otro proyecto (ADR 0020)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Alfa');
  await addNote(page, 'Mapa del río');
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Beta');
  await addNote(page, 'Río oculto');
  await closeEditor(page);
  await button(page, 'Abrir la búsqueda').click();
  await button(page, 'Buscar en todos los proyectos (2)').click();
  await page.getByTestId('search-input').fill('rio');
  // No se busca con cada tecla: hasta pulsar «Buscar» no hay resultados.
  await expect(page.getByTestId('search-all-count')).toHaveCount(0);
  await button(page, 'Buscar ahora en todos los proyectos').click();
  await expect(page.getByTestId('search-all-count')).toHaveText('2 RESULTADOS EN 2 PROYECTOS');
  await expect(page.getByTestId('search-panel')).toContainText('Beta (este proyecto)');
  await page.screenshot({ path: testInfo.outputPath('search-all.png') });
  await page.getByTestId('search-input').fill('rio oculto');
  await expect(page.getByTestId('search-all-stale')).toHaveText('Resultados de «rio». Pulsa «Buscar» para actualizar.');
  await page.getByTestId('search-input').fill('rio');
  await button(page, 'Ir a Mapa del río').click();
  await expect(page.getByRole('heading', { name: 'Alfa', exact: true })).toBeVisible();
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Mapa del río');
});

test('nota con imágenes ordenadas: insertar tras el párrafo del cursor, reordenar, texto alternativo, reemplazar, quitar y editor enfocado (ADR 0021)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Cuaderno');
  await addNote(page, 'Viaje');
  const editor = page.getByLabel('Contenido Markdown');
  await editor.fill('Llegada.\n\nTemplos y <b>jardines</b>.');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  const pick = async (name: string) => {
    const chooser = page.waitForEvent('filechooser');
    return (await chooser).setFiles({ name, mimeType: 'image/png', buffer: readFileSync(image) });
  };
  // Con el cursor al final del texto, la imagen va al final.
  await editor.press('Control+End');
  const first = pick('portada.png');
  await button(page, 'Insertar una imagen en la nota').click();
  await first;
  await expect(feedback(page)).toHaveText('Imagen «portada.png» insertada en la nota. Guardado en memoria.');
  await expect(editor).toHaveValue('Llegada.\n\nTemplos y <b>jardines</b>.\n\n![portada](assets/images/tarjeta-1-1.png)');
  // Con el cursor en el primer párrafo, la segunda va justo después de él.
  await editor.focus();
  await editor.press('Control+Home');
  await editor.press('ArrowRight');
  await editor.press('ArrowRight');
  const second = pick('mapa.png');
  await button(page, 'Insertar una imagen en la nota').click();
  await second;
  await expect(editor).toHaveValue('Llegada.\n\n![mapa](assets/images/tarjeta-1-2.png)\n\nTemplos y <b>jardines</b>.\n\n![portada](assets/images/tarjeta-1-1.png)');
  // La ficha muestra los bloques en orden: el HTML sigue siendo texto.
  const preview = page.getByTestId('note-preview-tarjeta-1');
  // En una ficha de tamaño inicial caben el primer párrafo y la primera imagen; el resto se indica.
  // (RN Web dibuja dentro un <img> accesible: se busca por nombre, no por número de roles.)
  await expect(preview.getByRole('img', { name: 'mapa' }).first()).toBeVisible();
  await expect(preview.getByRole('img', { name: 'portada' })).toHaveCount(0);
  await expect(preview).toContainText('+2 bloques más');
  await page.screenshot({ path: testInfo.outputPath('note-images.png') });

  // Reordenar y texto alternativo: van al borrador y se guardan con «Guardar texto».
  await button(page, 'Subir la imagen portada').click();
  await expect(editor).toHaveValue('Llegada.\n\n![mapa](assets/images/tarjeta-1-2.png)\n\n![portada](assets/images/tarjeta-1-1.png)\n\nTemplos y <b>jardines</b>.');
  await page.getByLabel('Texto alternativo de la imagen 2').fill('Portada del viaje');
  await expect(editor).toHaveValue(/!\[Portada del viaje\]\(assets\/images\/tarjeta-1-1\.png\)/);
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');

  // Reemplazar conserva la posición con un archivo nuevo; quitar saca la línea.
  const third = pick('mapa-nuevo.png');
  await button(page, 'Reemplazar la imagen mapa').click();
  await third;
  await expect(feedback(page)).toHaveText('Imagen reemplazada por «mapa-nuevo.png». Guardado en memoria.');
  await expect(editor).toHaveValue(/^Llegada\.\n\n!\[mapa\]\(assets\/images\/tarjeta-1-3\.png\)\n\n!\[Portada del viaje\]/);
  await button(page, 'Quitar la imagen Portada del viaje de la nota').click();
  await button(page, 'Guardar texto').click();
  await expect(page.getByTestId('note-block-3')).toHaveCount(0);
  await expect(editor).not.toHaveValue(/Portada/);
  await expect(page.getByTestId('note-blocks')).toContainText('Quitar o reemplazar una imagen no borra su archivo');

  // Editor enfocado: ocupa el sitio del lienzo y vuelve sin perder el borrador.
  await editor.fill(`${await editor.inputValue()}\n\nBorrador sin guardar`);
  await button(page, 'Ampliar el editor').click();
  await expect(page.getByTestId('board-canvas')).toBeHidden();
  await expect(editor).toHaveValue(/Borrador sin guardar$/);
  await page.screenshot({ path: testInfo.outputPath('note-focus.png') });
  await button(page, 'Volver al tablero').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(editor).toHaveValue(/Borrador sin guardar$/);
  await button(page, 'Guardar texto').click();
  await closeEditor(page);
  // Doble toque o doble clic en la ficha: selecciona y abre el editor enfocado.
  await card(page, 1).dblclick();
  await expect(page.getByTestId('board-canvas')).toBeHidden();
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Viaje');
  await button(page, 'Volver al tablero').click();
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('biblioteca de assets: importar, pestañas y recuentos, Usado en e Ir, añadir al tablero sin copiar, reemplazar y eliminar los sin usar (ADR 0022)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Archivo visual');
  const pick = async (name: string) => {
    const chooser = page.waitForEvent('filechooser');
    return (await chooser).setFiles({ name, mimeType: 'image/png', buffer: readFileSync(image) });
  };
  // Una nota con una imagen intercalada: el archivo está en uso.
  await addNote(page, 'Ruta');
  await page.getByLabel('Contenido Markdown').press('Control+End');
  const inNote = pick('mapa.png');
  await button(page, 'Insertar una imagen en la nota').click();
  await inNote;
  await expect(feedback(page)).toHaveText('Imagen «mapa.png» insertada en la nota. Guardado en memoria.');
  await closeEditor(page);

  const openAssets = async () => {
    if (isCompactWidth(page)) {
      await button(page, 'Más secciones').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
    await button(page, 'Abrir los assets').click();
    await expect(page.getByTestId('assets-view')).toBeVisible();
  };
  await openAssets();
  await expect(page.getByTestId('assets-count')).toHaveText('1 ARCHIVO');
  // Importar sin crear tarjeta: el nombre del archivo se vuelve portable.
  const imported = pick('Plano del Río.png');
  await button(page, 'Importar una imagen a la biblioteca').click();
  await imported;
  await expect(feedback(page)).toHaveText('Imagen «Plano del Río.png» añadida a la biblioteca. Guardado en memoria.');
  await expect(page.getByTestId('assets-count')).toHaveText('2 ARCHIVOS');
  await expect(button(page, 'Imágenes (2)')).toBeVisible();
  await expect(button(page, 'Documentos (0)')).toBeVisible();
  await expect(button(page, 'Solo sin usar (1)')).toBeVisible();
  // Recién importada queda seleccionada: nadie la usa.
  await expect(page.getByTestId('asset-detail')).toContainText('Ninguna tarjeta lo usa');
  await expect(page.getByTestId('asset-path')).toHaveText('assets/images/plano-del-rio.png');
  // Búsqueda por nombre de archivo, sin mayúsculas.
  await page.getByTestId('assets-search').fill('TARJETA');
  await expect(page.getByTestId('assets-count')).toHaveText('1 ARCHIVO');
  await button(page, 'Ver tarjeta-1-1.png').click();
  await expect(page.getByTestId('asset-detail')).toContainText('Ruta · Tablero principal');
  await page.screenshot({ path: testInfo.outputPath('assets.png') });
  // Un archivo en uso no se puede eliminar; «Ir» lleva a la tarjeta.
  await expect(button(page, 'Eliminar tarjeta-1-1.png')).toHaveCount(0);
  await button(page, 'Ir a Ruta').click();
  // Sigue montada (oculta) para conservar su búsqueda al volver (ADR 0036), no se desmonta.
  await expect(page.getByTestId('assets-view')).toBeHidden();
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);

  // Añadir al tablero: tarjeta de imagen que usa el mismo archivo (sin copia).
  await openAssets();
  // El panel conserva la búsqueda anterior: se vacía para ver todo.
  await page.getByTestId('assets-search').fill('');
  await button(page, 'Ver plano-del-rio.png').click();
  await button(page, 'Añadir plano-del-rio.png al tablero').click();
  await expect(feedback(page)).toHaveText('«plano-del-rio.png» añadido al tablero sin copiar el archivo. Guardado en memoria.');
  await expect(page.getByTestId('image-preview-tarjeta-2')).toBeVisible();
  await closeEditor(page);
  await openAssets();
  await expect(page.getByTestId('assets-count')).toHaveText('2 ARCHIVOS');
  await expect(button(page, 'Solo sin usar (0)')).toBeVisible();

  // Reemplazar cambia la referencia de la nota; el anterior queda sin usar y se puede eliminar.
  await button(page, 'Ver tarjeta-1-1.png').click();
  const replacement = pick('mapa nuevo.png');
  await button(page, 'Reemplazar tarjeta-1-1.png').click();
  await replacement;
  await expect(feedback(page)).toHaveText('«tarjeta-1-1.png» reemplazado por «mapa nuevo.png» en 1 tarjeta; el archivo anterior queda sin usar. Guardado en memoria.');
  await expect(button(page, 'Solo sin usar (1)')).toBeVisible();
  await button(page, 'Eliminar los sin usar (1)').click();
  await expect(page.getByTestId('assets-confirm-unused')).toContainText('¿Eliminar 1 archivo sin usar?');
  await button(page, 'Confirmar eliminar 1 archivo sin usar').click();
  await expect(feedback(page)).toHaveText('1 archivo sin usar eliminado. Guardado en memoria.');
  await expect(page.getByTestId('assets-count')).toHaveText('2 ARCHIVOS');
  await expect(page.getByTestId('asset-tarjeta-1-1.png')).toHaveCount(0);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('note-preview-tarjeta-1').getByRole('img', { name: 'mapa' }).first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('Assets: importar un documento y un audio, sin «Añadir al tablero», y abrir uno en una pestaña nueva (ADR 0038)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca');
  const pick = async (name: string, mimeType: string, buffer: Buffer) => {
    const chooser = page.waitForEvent('filechooser');
    return (await chooser).setFiles({ name, mimeType, buffer });
  };
  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();

  const importPdf = pick('Guion.pdf', 'application/pdf', Buffer.from('%PDF-1.4 contenido de prueba'));
  await button(page, 'Importar un documento o audio a la biblioteca').click();
  await importPdf;
  await expect(feedback(page)).toHaveText('«Guion.pdf» añadido a la biblioteca. Guardado en memoria.');
  await expect(button(page, 'Documentos (1)')).toBeVisible();
  await expect(page.getByTestId('asset-detail')).toContainText('DOCUMENTO');
  await expect(button(page, 'Añadir Guion.pdf al tablero')).toHaveCount(0);
  await expect(button(page, 'Reemplazar Guion.pdf')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('assets-library.png') });

  const importMp3 = pick('tema.mp3', 'audio/mpeg', Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]));
  await button(page, 'Importar un documento o audio a la biblioteca').click();
  await importMp3;
  await expect(feedback(page)).toHaveText('«tema.mp3» añadido a la biblioteca. Guardado en memoria.');
  await expect(button(page, 'Audio (1)')).toBeVisible();

  // «Abrir» deja que el navegador decida cómo mostrarlo, en una pestaña nueva (no una descarga forzada).
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    button(page, 'Abrir tema.mp3').click(),
  ]);
  expect(popup.url()).toContain('blob:');
  await popup.close();

  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Assets: importar una fuente TTF/OTF con consentimiento de licencia y activarla en las notas (ADR 0041)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Tipografía propia');
  const pick = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent('filechooser');
    return (await chooser).setFiles({ name, mimeType: 'font/ttf', buffer });
  };
  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();

  // Firma binaria, no la extensión: un archivo que dice «.ttf» pero no lo es, se rechaza.
  const rejected = pick('falsa.ttf', Buffer.from('esto no es una fuente'));
  await button(page, 'Importar una fuente TTF u OTF a la biblioteca').click();
  await rejected;
  await expect(page.getByTestId('assets-problem')).toContainText('Formato no admitido');
  await expect(button(page, 'Fuentes (0)')).toBeVisible();

  // Firma TTF válida (00 01 00 00): pide consentimiento antes de importar, no importa antes de tiempo.
  const chosen = pick('Mi Fuente.ttf', Buffer.from([0x00, 0x01, 0x00, 0x00, 1, 2, 3, 4]));
  await button(page, 'Importar una fuente TTF u OTF a la biblioteca').click();
  await chosen;
  await expect(page.getByTestId('assets-font-consent')).toContainText('Importar «Mi Fuente.ttf»');
  await expect(button(page, 'Fuentes (0)')).toBeVisible();
  await page.getByTestId('assets-font-license-input').fill('SIL Open Font License 1.1');
  await expect(button(page, 'Importar')).toBeDisabled(); // sin marcar la casilla, no se puede importar.
  await button(page, 'Tengo derecho a usar y compartir esta fuente.').click();
  await expect(button(page, 'Importar')).toBeEnabled();
  await button(page, 'Importar').click();
  await expect(feedback(page)).toHaveText('«Mi Fuente.ttf» añadida a la biblioteca. Guardado en memoria.');
  await expect(page.getByTestId('assets-font-consent')).toHaveCount(0);
  await expect(button(page, 'Fuentes (1)')).toBeVisible();
  await expect(page.getByTestId('asset-detail')).toContainText('FUENTE');
  await page.screenshot({ path: testInfo.outputPath('assets-font.png') });

  // Activarla: si el navegador no puede analizar estos bytes de prueba como una fuente real, lo dice sin
  // romper nada (ADR 0041, «mantener el texto legible si falta una fuente»); si la acepta, queda en uso.
  // El nombre portable sale del archivo original en minúsculas y sin espacios («mi-fuente.ttf»).
  await button(page, 'Usar mi-fuente.ttf como tipografía de las notas').click();
  await expect(page.getByTestId('assets-problem').or(page.getByText('En uso en las notas'))).toBeVisible();

  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Assets: Google Fonts, descarga explícita con la API pública css2 (sin clave), familia inexistente, consentimiento con nota de licencia pre-rellenada y exportar el archivo individual (ADR 0042, ADR 0043)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  // Red simulada con la forma exacta de la respuesta real (verificada contra el servidor antes de programar):
  // hoja CSS con un bloque «latin» y su url(), y el archivo WOFF2 con su firma binaria.
  const fakeWoff2 = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
  await page.route('https://fonts.googleapis.com/css2**', async (route) => {
    const family = new URL(route.request().url()).searchParams.get('family') ?? '';
    if (family.startsWith('Fuente')) {
      await route.fulfill({ status: 400, contentType: 'text/html', body: '<html>Missing font family</html>' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/fake.woff2) format('woff2');\n}\n`,
    });
  });
  await page.route('https://fonts.gstatic.com/s/fake.woff2', (route) => route.fulfill({ status: 200, contentType: 'font/woff2', body: fakeWoff2 }));

  await page.goto('./');
  await createWorkspace(page, 'Google Fonts');
  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();

  // Sin nombre: error antes de llamar a la red.
  await button(page, 'Buscar una fuente en Google Fonts').click();
  await expect(page.getByTestId('assets-google-search')).toBeVisible();
  await button(page, 'Buscar').click();
  await expect(page.getByTestId('assets-problem')).toContainText('Escribe el nombre de una familia');

  // Familia inexistente (400 de la API real): error claro, nada se importa.
  await page.getByTestId('assets-google-input').fill('Fuente Que No Existe');
  await button(page, 'Buscar').click();
  await expect(page.getByTestId('assets-problem')).toContainText('No se encontró una fuente de Google llamada «Fuente Que No Existe»');
  await expect(button(page, 'Fuentes (0)')).toBeVisible();

  // Familia real: descarga explícita (solo al pulsar «Buscar»), consentimiento con nota de licencia
  // pre-rellenada (no vacía, como en una fuente local) y edición del nombre no vacío.
  await page.getByTestId('assets-google-input').fill('Roboto');
  await button(page, 'Buscar').click();
  await expect(page.getByTestId('assets-google-search')).toHaveCount(0);
  await expect(page.getByTestId('assets-font-consent')).toContainText('Importar «Roboto.woff2»');
  await expect(page.getByTestId('assets-font-license-input')).toHaveValue(/SIL Open Font License.*Roboto/);
  await page.screenshot({ path: testInfo.outputPath('assets-google-fonts.png') });
  await button(page, 'Tengo derecho a usar y compartir esta fuente.').click();
  await button(page, 'Importar').click();
  await expect(feedback(page)).toHaveText('«Roboto.woff2» añadida a la biblioteca. Guardado en memoria.');
  await expect(button(page, 'Fuentes (1)')).toBeVisible();
  await expect(page.getByTestId('asset-path')).toHaveText('assets/fonts/roboto.woff2');

  // Exportación individual (ADR 0043, cierra el pendiente de ADR 0031): descargar el archivo tal cual.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button(page, 'Descargar roboto.woff2').click(),
  ]);
  expect(download.suggestedFilename()).toBe('roboto.woff2');

  // Caché local: una vez descargada, activarla no vuelve a tocar la red (misma tubería que E7c).
  await page.unroute('https://fonts.googleapis.com/css2**');
  await page.unroute('https://fonts.gstatic.com/s/fake.woff2');
  await button(page, 'Usar roboto.woff2 como tipografía de las notas').click();
  await expect(page.getByTestId('assets-problem').or(page.getByText('En uso en las notas'))).toBeVisible();

  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Archivo: archivar sin destruir, fuera de la búsqueda, buscar y restaurar en su sitio, y enviar a la Papelera con confirmación (ADR 0023)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Estudio');
  await addNote(page, 'Borrador viejo');
  await addNote(page, 'Plan');
  await tapCard(page, 1);
  await button(page, 'Conectar con Plan').click();
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);
  await button(page, 'Archivar la tarjeta Borrador viejo').click();
  await expect(feedback(page)).toHaveText('Tarjeta archivada. Guardado en memoria.');
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);

  // Fuera de la búsqueda del proyecto.
  await button(page, 'Abrir la búsqueda').click();
  await page.getByTestId('search-input').fill('borrador');
  await expect(page.getByTestId('search-empty')).toBeVisible();
  await page.keyboard.press('Escape');

  const openArchive = async (count: number) => {
    if (isCompactWidth(page)) {
      await button(page, 'Más secciones').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
    await button(page, `Abrir el Archivo (${count})`).click();
    await expect(page.getByTestId('archive-view')).toBeVisible();
  };
  await openArchive(1);
  await expect(page.getByTestId('archive-item-tarjeta-1')).toContainText('NOTA · ARCHIVADA');
  await expect(page.getByTestId('archive-item-tarjeta-1')).toContainText('Estaba en Tablero principal');
  await page.getByTestId('archive-search').fill('BORRADOR');
  await expect(page.getByTestId('archive-count')).toHaveText('1 TARJETA');
  await page.getByTestId('archive-search').fill('nada');
  await expect(page.getByTestId('archive-count')).toHaveText('0 TARJETAS');
  await page.getByTestId('archive-search').fill('');
  await page.screenshot({ path: testInfo.outputPath('archive.png') });
  await button(page, 'Restaurar Borrador viejo del Archivo').click();
  await expect(feedback(page)).toHaveText('Tarjeta restaurada del Archivo. Guardado en memoria.');
  await expect(page.getByTestId('archive-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page, 1)).toBeVisible();
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);

  // «Eliminar» desde el Archivo = enviar a la Papelera, con confirmación; solo la Papelera borra.
  await tapCard(page, 1);
  await button(page, 'Archivar la tarjeta Borrador viejo').click();
  await openArchive(1);
  await button(page, 'Enviar Borrador viejo a la Papelera desde el Archivo').click();
  await expect(page.getByTestId('archive-trash-confirmation')).toContainText('Desde allí aún podrás restaurarla o eliminarla definitivamente.');
  await button(page, 'Confirmar enviar Borrador viejo a la Papelera').click();
  await expect(feedback(page)).toHaveText('Tarjeta enviada del Archivo a la Papelera. Guardado en memoria.');
  await expect(page.getByTestId('archive-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Abrir la Papelera (1)')).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Archivo: archivar un tablero completo y selección múltiple para restaurar o enviar varias tarjetas a la Papelera (ADR 0039)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  // Con varios tableros, el ID global de una tarjeta nueva no coincide con lo que ya se ve en el
  // tablero activo: se crea sin la aserción estricta de `addNote` y se elige por su título.
  const addNoteAnywhere = async (title: string) => {
    await button(page, 'Añadir nota').click();
    await page.getByLabel('Título de la tarjeta').fill(title);
    await button(page, 'Guardar texto').click();
    await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  };
  const selectCardByTitle = (title: string) => page.locator('[data-testid^="card-tarjeta-"]').filter({ hasText: title });

  await page.goto('./');
  await createWorkspace(page, 'Estudio3');
  await addNote(page, 'Idea original');
  await closeEditor(page);

  // Segundo tablero con dos tarjetas, para archivarlo entero. «Tablero principal» ya existe, así
  // que el primero creado a mano es «Tablero 2» (cuenta todos los tableros, no solo los con nombre «Tablero N»).
  if (isCompactWidth(page)) await button(page, 'Abrir un tablero').click();
  await button(page, 'Crear un tablero').click();
  await addNoteAnywhere('Escena 1');
  await closeEditor(page);
  await addNoteAnywhere('Escena 2');
  await closeEditor(page);

  const openArchive = async () => {
    if (isCompactWidth(page)) {
      await button(page, 'Más secciones').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
    // Las tres veces que se abre en este flujo, el Archivo tiene 2 tarjetas.
    await button(page, 'Abrir el Archivo (2)').click();
    await expect(page.getByTestId('archive-view')).toBeVisible();
  };

  // Archivar el tablero completo desde la navegación.
  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Archivar el tablero Tablero 2 con sus tarjetas').click();
  await expect(feedback(page)).toHaveText('Tablero «Tablero 2» archivado con sus tarjetas. Guardado en memoria.');
  await openArchive();
  await expect(page.getByTestId(/^archive-board-/)).toContainText('Tablero 2');
  await expect(page.getByTestId(/^archive-board-/)).toContainText('2 tarjetas');
  await page.screenshot({ path: testInfo.outputPath('archive-board.png') });
  await button(page, 'Restaurar el tablero Tablero 2 con sus tarjetas').click();
  await expect(feedback(page)).toHaveText('Tablero «Tablero 2» restaurado. Guardado en memoria.');
  await expect(page.getByTestId(/^archive-board-/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(button(page, 'Tablero Tablero 2')).toBeVisible();

  // Selección múltiple: archivar dos tarjetas del tablero principal y restaurarlas juntas.
  await button(page, 'Tablero Tablero principal').click();
  await selectCardByTitle('Idea original').click();
  await button(page, 'Archivar la tarjeta Idea original').click();
  await addNoteAnywhere('Otra idea');
  await closeEditor(page);
  await selectCardByTitle('Otra idea').click();
  await button(page, 'Archivar la tarjeta Otra idea').click();
  await openArchive();
  await expect(page.getByTestId('archive-count')).toHaveText('2 TARJETAS');
  await button(page, 'Añadir a la selección a Idea original').click();
  await button(page, 'Añadir a la selección a Otra idea').click();
  await expect(page.getByTestId('archive-selection-bar')).toContainText('2 SELECCIONADAS');
  await button(page, 'Restaurar las tarjetas seleccionadas').click();
  await expect(feedback(page)).toHaveText('2 tarjetas restauradas del Archivo. Guardado en memoria.');
  await expect(page.getByTestId('archive-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selectCardByTitle('Idea original')).toBeVisible();
  await expect(selectCardByTitle('Otra idea')).toBeVisible();

  // Ahora, seleccionar y enviar juntas a la Papelera.
  await selectCardByTitle('Idea original').click();
  await button(page, 'Archivar la tarjeta Idea original').click();
  await selectCardByTitle('Otra idea').click();
  await button(page, 'Archivar la tarjeta Otra idea').click();
  await openArchive();
  await button(page, 'Añadir a la selección a Idea original').click();
  await button(page, 'Añadir a la selección a Otra idea').click();

  // Exportar la selección: un ZIP nuevo, no el del workspace; la selección sigue intacta después.
  const exportDownload = page.waitForEvent('download');
  await button(page, 'Exportar la selección como ZIP con sus assets').click();
  const exported = await exportDownload;
  expect(exported.suggestedFilename()).toBe('archivo-seleccion-2.zip');
  await expect(feedback(page)).toHaveText('Selección exportada como ZIP (2 tarjetas).');
  await expect(page.getByTestId('archive-selection-bar')).toContainText('2 SELECCIONADAS');

  await button(page, 'Enviar las tarjetas seleccionadas a la Papelera').click();
  await expect(page.getByTestId('archive-selection-confirm')).toBeVisible();
  await button(page, 'Confirmar enviar la selección a la Papelera').click();
  await expect(feedback(page)).toHaveText('2 tarjetas enviadas del Archivo a la Papelera. Guardado en memoria.');
  await expect(page.getByTestId('archive-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Abrir la Papelera (2)')).toBeVisible();

  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Diario: nota de hoy sin duplicar, cronología con fechas reales, archivadas, cambiar de día y estado vacío sin cifras (ADR 0024)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Bitácora');
  await addNote(page, 'Idea del día');
  await closeEditor(page);
  const openDiary = async () => {
    if (isCompactWidth(page)) {
      await button(page, 'Más secciones').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
    await button(page, 'Abrir el diario').click();
    await expect(page.getByTestId('diary-view')).toBeVisible();
  };
  await openDiary();
  await expect(page.getByTestId('log-day')).toContainText('· hoy');
  await expect(page.getByTestId('log-summary')).toHaveText('0 ENTRADAS · 1 TARJETA CREADA · 0 ARCHIVADAS');
  await expect(page.getByTestId('log-created-tarjeta-1')).toContainText('CREADA · NOTA');
  await button(page, 'Escribir la nota de hoy').click();
  await expect(feedback(page)).toHaveText('Entrada del diario lista. Guardado en memoria.');
  await page.getByLabel('Texto de la entrada').fill('Hoy empecé el plan.');
  await button(page, 'Guardar entrada').click();
  await expect(feedback(page)).toHaveText('Entrada del diario guardada. Guardado en memoria.');
  await expect(page.getByTestId('log-summary')).toHaveText('1 ENTRADA · 1 TARJETA CREADA · 0 ARCHIVADAS');
  // «Escribir la nota de hoy» no crea otra.
  await button(page, 'Escribir la nota de hoy').click();
  await expect(page.getByLabel('Texto de la entrada')).toHaveValue('Hoy empecé el plan.');
  await button(page, 'Cancelar la edición de la entrada').click();
  await page.screenshot({ path: testInfo.outputPath('daily-log.png') });

  // Un día sin datos no muestra cifras inventadas.
  await button(page, 'Día anterior').click();
  await expect(page.getByTestId('log-summary')).toHaveText('SIN ACTIVIDAD REGISTRADA');
  await button(page, 'Ir a hoy').click();
  await expect(page.getByTestId('log-summary')).toHaveText('1 ENTRADA · 1 TARJETA CREADA · 0 ARCHIVADAS');
  await button(page, 'Ir a Idea del día').click();
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Archivar la tarjeta Idea del día').click();
  await openDiary();
  await expect(page.getByTestId('log-summary')).toHaveText('1 ENTRADA · 0 TARJETAS CREADAS · 1 ARCHIVADA');
  await expect(page.getByTestId('log-archived-tarjeta-1')).toContainText('ARCHIVADA · NOTA');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Diario: buscar por rango con filtros de etiqueta y texto, y exportar como Markdown (ADR 0037)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Rango');
  await addNote(page, 'Con etiqueta viaje');
  await page.getByTestId('tag-input').fill('viaje');
  await button(page, 'Añadir la etiqueta').click();
  await closeEditor(page);
  await addNote(page, 'Sin etiqueta');
  await closeEditor(page);

  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Abrir el diario').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await button(page, 'Buscar por fecha, tipo, etiqueta o tablero (ADR 0037)').click();
  await expect(page.getByTestId('diary-search-count')).toHaveText('2 RESULTADOS');

  // Filtro por etiqueta.
  await button(page, 'Solo #viaje').click();
  await expect(page.getByTestId('diary-search-count')).toHaveText('1 RESULTADO');
  await expect(page.getByTestId('diary-search-result-tarjeta-1')).toContainText('Con etiqueta viaje');
  await expect(page.getByTestId('diary-search-result-tarjeta-2')).toHaveCount(0);
  await button(page, 'Todas las etiquetas').click();

  // Búsqueda de texto, sin distinguir mayúsculas.
  await page.getByTestId('diary-search-text').fill('SIN ETIQUETA');
  await expect(page.getByTestId('diary-search-count')).toHaveText('1 RESULTADO');
  await page.getByTestId('diary-search-text').fill('');
  await expect(page.getByTestId('diary-search-count')).toHaveText('2 RESULTADOS');

  // Un rango con la fecha final antes que la inicial se rechaza, sin cifras inventadas.
  await page.getByTestId('diary-search-to').fill('2000-01-01');
  await expect(page.getByTestId('diary-search-count')).toHaveText('SIN RESULTADOS');
  await expect(page.getByText('Escribe dos fechas reales, con la inicial antes o igual que la final.')).toBeVisible();
  await page.getByTestId('diary-search-to').fill(await page.getByTestId('diary-search-from').inputValue());

  // Exportar descarga un Markdown del rango, no un ZIP.
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este rango como Markdown').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^diario-\d{4}-\d{2}-\d{2}\.md$/);
  await page.screenshot({ path: testInfo.outputPath('diary-search.png') });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('Configuración: tema desde el proyecto y fecha de creación visible en las fichas, que sobrevive a recargar (ADR 0029)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  const settings = async (action: () => Promise<void>) => {
    await openSettings(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await action();
    await button(page, 'Cerrar configuración').click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  };
  const dateSwitch = () => page.getByRole('switch', { name: 'Mostrar la fecha de creación en las fichas' });
  await page.goto('./');
  await createWorkspace(page, 'Fechas');
  await addNote(page, 'Con fecha');
  // El editor siempre dice cuándo se creó.
  await expect(page.getByTestId('card-created')).toHaveText(/^Creada el \d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) \d{4}, \d{2}:\d{2}$/);
  await closeEditor(page);
  await expect(page.getByTestId('card-meta-tarjeta-1')).toHaveCount(0);

  // Tema oscuro desde la Configuración del proyecto: cambia toda la app al instante.
  await settings(async () => {
    await button(page, 'Usar el tema oscuro').click();
    await expect(button(page, 'Usar el tema oscuro')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.getByTestId('workspace-screen').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(rgb(themeColors.dark.background));
    await dateSwitch().click();
    await expect(dateSwitch()).toHaveAttribute('aria-checked', 'true');
  });
  await expect(page.getByTestId('card-meta-tarjeta-1')).toHaveText(/^\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) \d{4}$/);
  await page.screenshot({ path: testInfo.outputPath('dates-dark.png') });

  // Las preferencias son del dispositivo: tras recargar (el espacio en memoria se pierde) siguen activas.
  await page.goto('./');
  await createWorkspace(page, 'Otra');
  await addNote(page, 'Nueva');
  await closeEditor(page);
  await expect(page.getByTestId('card-meta-tarjeta-1')).toBeVisible();
  await expect.poll(() => page.getByTestId('workspace-screen').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(rgb(themeColors.dark.background));
  await settings(async () => {
    await button(page, 'Usar el tema claro').click();
    await dateSwitch().click();
  });
  await expect(page.getByTestId('card-meta-tarjeta-1')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('Configuración: tipografía de las notas (Serif, Monoespaciada) en la ficha y en el editor; solo el texto, no los títulos (ADR 0030)', async ({ page }) => {
  const { runtimeErrors } = trackProblems(page);
  const settings = async (action: () => Promise<void>) => {
    await openSettings(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await action();
    await button(page, 'Cerrar configuración').click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  };
  await page.goto('./');
  await createWorkspace(page, 'Tipos');
  await addNote(page, 'Con texto');
  await page.getByLabel('Contenido Markdown').fill('Cuerpo de la nota.');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  const bodyInEditor = () => page.getByLabel('Contenido Markdown').evaluate((node) => getComputedStyle(node).fontFamily);
  const titleInEditor = () => page.getByLabel('Título de la tarjeta').evaluate((node) => getComputedStyle(node).fontFamily);
  const systemBody = await bodyInEditor();
  const systemTitle = await titleInEditor();
  await closeEditor(page);
  const bodyInCard = () => page.getByTestId('card-tarjeta-1').getByText('Cuerpo de la nota.').evaluate((node) => getComputedStyle(node).fontFamily);

  await settings(async () => {
    await button(page, 'Usar tipografía serif en las notas').click();
    await expect(button(page, 'Usar tipografía serif en las notas')).toHaveAttribute('aria-pressed', 'true');
  });
  await expect.poll(bodyInCard).toContain('Georgia');
  await tapCard(page, 1);
  await expect.poll(bodyInEditor).toContain('Georgia');
  // El título de la tarjeta no cambia: la tipografía solo afecta al texto de la nota.
  expect(await titleInEditor()).toBe(systemTitle);
  await closeEditor(page);

  await settings(async () => {
    await button(page, 'Usar tipografía monoespaciada en las notas').click();
  });
  await expect.poll(bodyInCard).toMatch(/monospace|Menlo|Consolas/);

  // Es del dispositivo: sobrevive a volver al inicio y a otro proyecto.
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Otro tipo');
  await addNote(page, 'Nueva');
  await page.getByLabel('Contenido Markdown').fill('Otro cuerpo.');
  await expect.poll(bodyInEditor).toMatch(/monospace|Menlo|Consolas/);

  await settings(async () => { await button(page, 'Usar tipografía sistema en las notas').click(); });
  await expect.poll(bodyInEditor).toBe(systemBody);
  expect(runtimeErrors).toEqual([]);
});

test('Presentar: pantalla completa en cualquier plataforma, cuenta y navegación; Imprimir abre una pestaña con el documento (ADR 0031)', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Lectura');
  await addNote(page, 'Primera');
  await page.getByLabel('Contenido Markdown').fill('Cuerpo de la primera.');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);
  await addNote(page, 'Segunda');
  await closeEditor(page);

  const openPresent = async () => {
    if (isCompactWidth(page)) {
      await button(page, 'Más secciones').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
    await button(page, 'Presentar este tablero').click();
    await expect(page.getByTestId('present-view')).toBeVisible();
  };
  await openPresent();
  await expect(page.getByTestId('present-count')).toHaveText('1 / 2');
  await expect(page.getByRole('heading', { name: 'Primera' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('present.png') });
  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-count')).toHaveText('2 / 2');
  await expect(page.getByRole('heading', { name: 'Segunda' })).toBeVisible();
  // No se puede pasar de la última.
  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-count')).toHaveText('2 / 2');
  await button(page, 'Cerrar la presentación').click();
  await expect(page.getByTestId('present-view')).toHaveCount(0);
  // Reabrir vuelve siempre a la primera.
  await openPresent();
  await expect(page.getByTestId('present-count')).toHaveText('1 / 2');
  await button(page, 'Cerrar la presentación').click();

  // Imprimir (web): abre una pestaña con el documento, en el orden de lectura, sin ejecutar nada.
  if (isCompactWidth(page)) {
    await button(page, 'Más secciones').click();
    await expect(page.getByTestId('more-sheet')).toBeVisible();
  }
  await expect(button(page, 'Imprimir este tablero')).toBeVisible();
  // Solo Chromium para la apertura real: en Firefox, un clic simulado por Playwright no lleva la
  // «activación de usuario» reciente que ese motor exige para `window.open` (aunque `page.evaluate()`
  // sí la tiene). Limitación de la herramienta, no del código; el botón ya se comprobó arriba.
  test.skip(testInfo.project.name.startsWith('firefox'), 'window.open tras un clic simulado no se abre en Firefox (activación de usuario); ver testing.md.');
  const [tab] = await Promise.all([page.waitForEvent('popup'), button(page, 'Imprimir este tablero').click()]);
  await tab.waitForLoadState();
  // El encabezado es el título del tablero (no el del proyecto): es lo que se está presentando/imprimiendo.
  expect(await tab.title()).toBe('Tablero principal');
  await expect(tab.getByRole('heading', { name: 'Primera', level: 2 })).toBeVisible();
  await expect(tab.getByText('Cuerpo de la primera.')).toBeVisible();
  await expect(tab.getByRole('heading', { name: 'Segunda', level: 2 })).toBeVisible();
  await tab.close();
  expect(runtimeErrors).toEqual([]);
});

test('Configuración: idioma de la interfaz (ES/EN) traduce la barra, la navegación y el propio panel; el contenido de las notas no se traduce (ADR 0032)', async ({ page }) => {
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Idioma');
  await addNote(page, 'Nota en español');
  await closeEditor(page);

  await openSettings(page);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
  await button(page, 'Usar inglés').click();
  // El propio panel cambia al instante.
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Appearance', { exact: true })).toBeVisible();
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  await button(page, 'Close settings').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);

  // La barra de herramientas y la navegación cambian con ella.
  await expect(page.getByRole('button', { name: 'Select tool' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  if (isCompactWidth(page)) {
    await button(page, 'More sections').click();
    await expect(page.getByRole('button', { name: 'Open Trash (0)' })).toBeVisible();
    await button(page, 'Close more').click();
  } else {
    await expect(page.getByRole('button', { name: /Open Trash/ })).toBeVisible();
  }

  // El contenido de la nota, en español, no cambia.
  await expect(page.getByText('Nota en español')).toBeVisible();

  // Es del dispositivo: sobrevive a volver al inicio. Desde E7a (ADR 0040) Inicio también se traduce,
  // así que aquí se crea el espacio con las etiquetas en inglés, no con el helper en español.
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Give your ideas/ })).toBeVisible();
  await page.getByLabel('New space name').fill('Otro idioma');
  await button(page, 'Create a space').click();
  await expect(page.getByRole('heading', { name: 'Otro idioma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();

  // Volver a español (la interfaz sigue en inglés aquí: se abre con sus propios textos).
  if (isCompactWidth(page)) await button(page, 'More sections').click();
  await button(page, 'Open settings').click();
  await button(page, 'Use Spanish').click();
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
  await button(page, 'Cerrar configuración').click();
  await expect(page.getByRole('button', { name: 'Añadir nota' })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('Idioma (E7a, ADR 0040): Inicio, Papelera, enlaces, búsqueda, Diario, Assets y Archivo también cambian a inglés', async ({ page }) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Language extended');

  await openSettings(page);
  await button(page, 'Usar inglés').click();
  await button(page, 'Close settings').click();

  // Inicio: vuelve a mostrarse en inglés (el idioma es del dispositivo, como el tema). Recargar pierde
  // los espacios en memoria (ADR 0011): no se reabre «Language extended», se crea uno nuevo con el
  // formulario ya en inglés para seguir probando el resto de superficies.
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Give your ideas/ })).toBeVisible();
  await expect(button(page, 'Create a space')).toBeVisible();
  await page.getByLabel('New space name').fill('Language extended 2');
  await button(page, 'Create a space').click();
  await expect(page.getByRole('heading', { name: 'Language extended 2', exact: true })).toBeVisible();

  const openMore = async () => {
    if (isCompactWidth(page)) {
      await button(page, 'More sections').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
    }
  };

  // Papelera: vacía, en inglés (en compacto va directa en la barra, no dentro de «More»).
  await button(page, 'Open Trash (0)').click();
  await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible();
  await expect(page.getByTestId('trash-empty')).toHaveText('The Trash is empty.');
  await button(page, 'Close trash').click();
  await expect(page.getByTestId('trash-panel')).toHaveCount(0);

  // Enlace: título y campos del diálogo.
  await button(page, 'Add link').click();
  const linkDialog = page.getByTestId('link-dialog');
  await expect(linkDialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New link' })).toBeVisible();
  await expect(page.getByLabel('Address')).toBeVisible();
  await expect(page.getByLabel('Title (optional)')).toBeVisible();
  await button(page, 'Cancel the new link').click();
  await expect(linkDialog).toHaveCount(0);

  // Búsqueda: título del panel y ámbito.
  await button(page, 'Open search').click();
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await expect(button(page, 'Search only in this project')).toBeVisible();
  await button(page, 'Close search').click();
  await expect(page.getByTestId('search-panel')).toHaveCount(0);

  // Diario: encabezado, modo y calendario del mes.
  await openMore();
  await button(page, 'Open diary').click();
  await expect(page.getByRole('heading', { name: 'Diary' })).toBeVisible();
  await expect(button(page, 'View a day')).toBeVisible();
  await expect(button(page, 'Go to today')).toBeVisible();
  await button(page, 'Back to the board').click();
  await expect(page.getByTestId('diary-view')).toBeHidden();

  // Assets: encabezado, importar y estado vacío.
  await openMore();
  await button(page, 'Open assets').click();
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
  await expect(button(page, 'Import an image to the library')).toBeVisible();
  await expect(page.getByTestId('assets-empty')).toContainText('This project has no files yet.');
  await button(page, 'Back to the board').click();
  await expect(page.getByTestId('assets-view')).toBeHidden();

  // Archivo: encabezado y estado vacío.
  await openMore();
  await button(page, 'Open Archive (0)').click();
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
  await expect(page.getByTestId('archive-empty')).toHaveText('Nothing is archived.');
  await button(page, 'Back to the board').click();
  await expect(page.getByTestId('archive-view')).toBeHidden();

  expect(runtimeErrors).toEqual([]);
});

test('Idioma (E7b, ADR 0040): el editor de tarjeta e inspector también cambian a inglés, incluida la fecha de creación', async ({ page }) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Language inspector');

  await openSettings(page);
  await button(page, 'Usar inglés').click();
  await button(page, 'Close settings').click();

  await button(page, 'Add note').click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  // En móvil el encabezado propio del inspector se oculta (la hoja ya muestra título y «Close»).
  if (!isCompactWidth(page)) await expect(page.getByText('SELECTED CARD', { exact: true })).toBeVisible();
  await page.getByLabel('Card title').fill('English card');
  await button(page, 'Save text').click();
  // Antes de E7f (ADR 0044) el aviso de guardar texto se quedaba fijo en español pese al idioma
  // elegido; con la clave única y compuesta, se traduce igual que el resto.
  await expect(feedback(page)).toHaveText('Text saved. Saved in memory.');

  // La fecha de creación cambia de orden, no solo de palabras (ADR 0040): «28 sep 2026» -> «Sep 28, 2026».
  await expect(page.getByTestId('card-created')).toContainText(/^Created [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}$/);
  await expect(page.getByTestId('card-geometry')).toContainText(/^Column \d+, row \d+/);
  await expect(page.getByText('CONNECTIONS', { exact: true })).toBeVisible();
  await expect(page.getByText('No connections.', { exact: true })).toBeVisible();
  await expect(button(page, 'Archive the card English card')).toBeVisible();
  await expect(button(page, 'Send the card English card to the Trash')).toBeVisible();

  // Los avisos de acción y las etiquetas de deshacer/rehacer también se traducen (ADR 0044),
  // incluida la barra compacta de móvil, que antes quedaba fija en español.
  await button(page, 'Move right').click();
  await expect(feedback(page)).toHaveText('Card moved. Saved in memory.');
  const undoButton = page.getByRole('button', { name: 'Undo: Card moved' });
  const redoButton = page.getByRole('button', { name: 'Redo: Card moved' });
  await expect(undoButton).toBeVisible();
  await undoButton.click();
  await expect(feedback(page)).toHaveText('Undone: Card moved. Saved in memory.');
  await expect(redoButton).toBeVisible();
  await redoButton.click();
  await expect(feedback(page)).toHaveText('Redone: Card moved. Saved in memory.');

  await button(page, 'Close the card editor').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);

  expect(runtimeErrors).toEqual([]);
});

test('Conexiones: tipo y rótulo al crear, editarlos después, elegir el estilo de flecha y verlo en el lienzo (ADR 0034)', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Mapa');
  await addNote(page, 'A');
  await closeEditor(page);
  await addNote(page, 'B');
  await closeEditor(page);

  // Crear con un tipo nuevo y conectar.
  await tapCard(page, 1);
  await page.getByTestId('connect-type-input').fill('Bloquea');
  await button(page, 'Conectar con B').click();
  await expect(feedback(page)).toHaveText('Tarjetas conectadas. Guardado en memoria.');
  const connections = page.getByTestId('card-connections');
  await expect(connections).toContainText('→ B (Bloquea)');

  // Editar tipo y rótulo de la conexión ya creada.
  await button(page, 'Editar el tipo y el rótulo de la conexión con B').click();
  await page.getByLabel('Rótulo sobre la línea').fill('hasta el jueves');
  await button(page, 'Guardar los cambios de la conexión').click();
  await expect(feedback(page)).toHaveText('Conexión actualizada. Guardado en memoria.');
  await expect(connections).toContainText('→ B (Bloquea: hasta el jueves)');

  // Estilo de flecha: se aplica al instante y se ve en el lienzo (rótulo como texto, no solo color).
  await expect(page.getByTestId(/^relation-label-/)).toHaveText('hasta el jueves');
  await button(page, 'Usar doble flecha en esta conexión').click();
  await expect(feedback(page)).toHaveText('Estilo de la conexión cambiado. Guardado en memoria.');
  await expect(button(page, 'Usar doble flecha en esta conexión')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('connection.png') });

  // Minimizada, la línea y el rótulo siguen visibles (la huella se reduce a 1 × 1, no desaparece).
  await tapCard(page, 1);
  await button(page, 'Mostrar minimizada').click();
  await closeEditor(page);
  await expect(page.getByTestId(/^relation-line-/)).toBeVisible();
  await expect(page.getByTestId(/^relation-label-/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('connection-minimized.png') });
  expect(runtimeErrors).toEqual([]);
});
