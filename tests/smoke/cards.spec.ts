import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { themeColors } from '../../packages/ui/src/theme';
import { hasHorizontalOverflow, rgb, trackProblems } from './support';

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
  await expect(feedback(page)).toHaveText('Texto guardado en memoria.');
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

  await button(page, 'Abrir la configuración').click();
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
  await button(page, 'Abrir la configuración').click();
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
  if (narrow.width < 3 * 44 + 4) {
    await button(page, 'Acciones de Guion').click();
    await expect(page.getByTestId('card-menu')).toBeVisible();
    await button(page, 'Minimizar Guion').click();
    await expect(page.getByTestId('card-menu')).toHaveCount(0);
    await expect(page.getByTestId('minimized-tarjeta-1')).toBeVisible();
    await button(page, 'Expandir Guion').click();
  }

  // «×» envía a la Papelera existente, no elimina definitivamente (en una tarjeta estrecha, desde «⋯»).
  if (narrow.width < 3 * 44 + 4) await button(page, 'Acciones de Guion').click();
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
    await button(page, 'Abrir la configuración').click();
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
    await button(page, 'Abrir la configuración').click();
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
  await expect(feedback(page)).toHaveText('Texto guardado en memoria.');
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
