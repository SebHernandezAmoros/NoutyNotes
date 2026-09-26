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
  await card(page, id).focus();
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

test('minimizar, contraer y expandir: barra de la tarjeta e inspector; la colisión al expandir se resuelve a elección', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Formas');
  await addNote(page, 'Primera');
  await addNote(page, 'Segunda');
  await tapCard(page, 1);
  await button(page, 'Minimizar Primera').click();
  await expect(feedback(page)).toHaveText('Tarjeta minimizada. Guardado en memoria.');
  await expect(page.getByTestId('minimized-tarjeta-1')).toContainText('P');
  // El tamaño expandido se conserva aunque la huella sea 1 × 1.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Primera, minimizada');
  // Una ficha minimizada sigue siendo tocable en móvil.
  const tile = await box(card(page, 1));
  expect(tile.width).toBeGreaterThanOrEqual(44);
  expect(tile.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('minimized.png') });

  // Segunda ocupa el sitio que Primera necesita para expandirse.
  await tapCard(page, 2);
  for (let step = 0; step < 3; step += 1) await button(page, 'Mover a la izquierda').click();
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  await tapCard(page, 1);
  await button(page, 'Expandir Primera').click();
  await expect(feedback(page)).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(page.getByTestId('relocate-offer')).toBeVisible();
  await expect(page.getByTestId('minimized-tarjeta-1')).toBeVisible();
  await button(page, 'Expandir en un hueco libre').click();
  await expect(feedback(page)).toHaveText('Tarjeta expandida en un hueco libre. Guardado en memoria.');
  await expect(page.getByTestId('minimized-tarjeta-1')).toHaveCount(0);
  await expect(geometry(page)).toHaveText('Columna 6, fila 1 · 4 × 3');

  // Contraer desde el inspector; conexiones intactas.
  await button(page, 'Conectar con Segunda').click();
  await button(page, 'Mostrar contraída').click();
  await expect(card(page, 1)).toContainText('CONTRAÍDA');
  await expect(button(page, 'Mostrar contraída')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('card-connections')).toContainText('→ Segunda');
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
  await card(page, 1).click();
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
  for (let index = 0; index < 3; index += 1) await button(page, 'Añadir nota').click();
  const canvas = page.getByTestId('board-canvas');
  const offset = async () => {
    const [content, viewport] = [await box(page.getByTestId('canvas-content')), await box(canvas)];
    return Math.round(content.x - viewport.x);
  };
  const before = await offset();
  // La tercera nota nace fuera del área visible (a 390 px y bajo el inspector en escritorio).
  const [outside, frame] = [await box(card(page, 3)), await box(canvas)];
  expect(outside.x).toBeGreaterThanOrEqual(frame.x + frame.width);
  // El scroll nativo que intenta el navegador (o Playwright) para mostrarla se deshace: el contenido
  // nunca se separa del pan.
  await canvas.evaluate((element) => { element.scrollLeft = 300; });
  await expect.poll(offset).toBe(before);
  expect(await canvas.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  // El foco (teclado o lector de pantalla) la trae con el pan y después se puede tocar.
  await tapCard(page, 3);
  await expect(card(page, 3)).toHaveAttribute('aria-pressed', 'true');
  expect(await canvas.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  const [shown, visible] = [await box(card(page, 3)), await box(canvas)];
  expect(shown.x).toBeLessThan(visible.x + visible.width);
  expect(shown.x + shown.width).toBeGreaterThan(visible.x);
  expect(await offset()).toBeLessThan(before);
  // La primera quedó a la izquierda, donde el scroll nativo no llega: el foco del teclado la trae.
  const hidden = await box(card(page, 1));
  expect(hidden.x + hidden.width).toBeLessThanOrEqual(visible.x);
  await card(page, 1).focus();
  await expect.poll(async () => (await box(card(page, 1))).x).toBeGreaterThanOrEqual(visible.x);
  expect(await canvas.evaluate((element) => element.scrollLeft)).toBe(0);
  // El desplazamiento vive en el pan: restablecer la vista vuelve al origen.
  if ((page.viewportSize()?.width ?? 0) < 800) {
    await button(page, 'Abrir la configuración').click();
    await button(page, 'Restablecer la vista del lienzo').click();
    await button(page, 'Cerrar configuración').click();
  } else {
    await button(page, 'Zoom 100 %, restablecer a 100 %').click();
  }
  await expect.poll(offset).toBe(before);
  expect(await canvas.evaluate((element) => element.scrollLeft)).toBe(0);
});
