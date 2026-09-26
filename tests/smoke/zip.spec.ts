import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { buildZip, text } from '../../packages/storage/src/__fixtures__/zip';
import { readWorkspaceArchive } from '../../packages/storage/src/index';
import { hasHorizontalOverflow, trackProblems } from './support';

/** Navegador sin File System Access: `showDirectoryPicker` no existe. */
const withoutFolderAccess = `Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });`;

const binary = Uint8Array.from({ length: 300 }, (_, index) => (index * 37) % 256);

/** Fixture editado a mano (comentarios, CRLF, README, asset de texto) más un asset binario. */
function fixture(): Record<string, Uint8Array> {
  const root = fileURLToPath(new URL('../fixtures/workspace-v1-edited/', import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  const files: Record<string, Uint8Array> = {};
  for (const path of walk(root)) files[relative(root, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  files['assets/images/pixel.png'] = binary;
  return files;
}

/** ZIP «de otra herramienta»: método stored y carpeta envolvente, como al comprimir una carpeta. */
function fixtureZip(extra: Record<string, Uint8Array> = {}): Buffer {
  const entries = Object.entries({ ...fixture(), ...extra }).map(([path, data]) => ({ name: `Demo/${path}`, data, method: 0 }));
  return Buffer.from(buildZip(entries));
}

async function importZip(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/zip', buffer });
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const DOWNLOAD_STARTED = (fileName: string) => `Descarga iniciada: «${fileName}». El navegador no confirma que se haya guardado: comprueba tus descargas y pulsa «Ya lo guardé». Hasta entonces sigue marcado como sin exportar.`;

test('sin API de carpetas: importar ZIP, editar, exportar y reimportar tras recargar sin pérdidas', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.addInitScript({ content: withoutFolderAccess });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');

  // El navegador no bloquea la app: la carpeta queda desactivada y se ofrece la vía ZIP.
  await expect(button(page, 'Abrir una carpeta')).toBeDisabled();
  await expect(page.getByTestId('open-folder')).toContainText('Usa «Importar un ZIP»');
  await expect(page.getByTestId('memory-notice')).toContainText('Exporta cada espacio como ZIP');
  await expect(button(page, 'Importar un ZIP')).toBeEnabled();

  await importZip(page, 'demo.zip', fixtureZip());
  await expect(page.getByRole('heading', { name: 'Demo', exact: true })).toBeVisible();
  await expect(page.getByTestId('archive-message')).toHaveText('ZIP importado: «Demo».');
  await expect(page.getByTestId('export-status')).toHaveText('SIN CAMBIOS PENDIENTES DE EXPORTAR');
  await expect(page.getByTestId('card-idea-a')).toContainText('Idea A');
  await expect(page.getByTestId('card-idea-b')).toBeVisible();

  // Editar: nota nueva con título y Markdown, movida en la grilla y conectada.
  await button(page, 'Añadir nota').click();
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');
  await page.getByTestId('card-tarjeta-1').click();
  await page.getByLabel('Título de la tarjeta').fill('Nota del ZIP');
  await page.getByLabel('Contenido Markdown').fill('## Desde el navegador\n\n- conservar **todo**');
  await button(page, 'Guardar texto').click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota del ZIP');
  // Desde P2 la nota nace en el primer hueco visible: se mueve una fila desde donde nació.
  const rowOf = (text: string) => Number(/fila (\d+)/.exec(text)?.[1]);
  const bornRow = rowOf(await page.getByTestId('card-geometry').innerText());
  await button(page, 'Mover abajo').click();
  await expect(page.getByTestId('card-geometry')).toContainText(`fila ${bornRow + 1}`);
  await button(page, 'Conectar con Idea A').click();
  await expect(page.getByTestId('card-connections')).toContainText('→ Idea A');

  // Cambiar de espacio no descarta nada y la lista marca lo pendiente.
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByTestId('unexported-demo')).toHaveText('SIN EXPORTAR');
  await button(page, 'Abrir Demo').click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota del ZIP');
  await page.screenshot({ path: testInfo.outputPath('zip-pending.png') });

  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('demo.zip');
  const exportedPath = testInfo.outputPath('demo-exportado.zip');
  await saved.saveAs(exportedPath);
  // La web no sabe si el archivo quedó guardado: sigue pendiente hasta que el usuario lo confirma.
  await expect(page.getByTestId('archive-message')).toHaveText(DOWNLOAD_STARTED('demo.zip'));
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');
  await button(page, 'Confirmar que guardé demo.zip').click();
  await expect(page.getByTestId('export-status')).toHaveText('SIN CAMBIOS PENDIENTES DE EXPORTAR');
  await expect(page.getByTestId('archive-message')).toHaveText('Confirmado: el estado exportado en «demo.zip» está guardado.');

  // El ZIP exportado conserva todo: textos sin cambios byte a byte, assets binarios y la edición.
  const exported = new Uint8Array(readFileSync(exportedPath));
  const archive = readWorkspaceArchive(exported);
  if (!archive.ok) throw new Error(JSON.stringify(archive.issues));
  const source = fixture();
  const decoder = new TextDecoder();
  expect(archive.value.files['README.md']).toBe(decoder.decode(source['README.md']));
  expect(archive.value.files['cards/idea-b.md']).toBe(decoder.decode(source['cards/idea-b.md']));
  expect(archive.value.assets).toEqual({ 'assets/images/pixel.png': binary, 'assets/notes/lista de ideas.txt': source['assets/notes/lista de ideas.txt'] });
  const card = archive.value.workspace.cards.find((candidate) => candidate.id === 'tarjeta-1');
  expect(card).toMatchObject({ title: 'Nota del ZIP', content: '## Desde el navegador\n\n- conservar **todo**' });
  expect(archive.value.workspace.relations.map(({ from, to }) => `${from}→${to}`)).toEqual(['idea-a→idea-b', 'tarjeta-1→idea-a']);
  expect(archive.value.workspace.layouts[0]?.placements.find((placement) => placement.cardId === 'tarjeta-1')?.rect.y).toBe(bornRow);

  // Otra sesión: recargar pierde la memoria; reimportar el ZIP exportado lo recupera todo.
  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios');
  await importZip(page, 'demo.zip', Buffer.from(exported));
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota del ZIP');
  // Enfocarla primero la trae a la vista si el lienzo no la muestra (a 390 px puede quedar fuera).
  await page.getByTestId('card-tarjeta-1').focus();
  await page.getByTestId('card-tarjeta-1').click();
  await expect(page.getByLabel('Contenido Markdown')).toHaveValue('## Desde el navegador\n\n- conservar **todo**');
  await expect(page.getByTestId('card-connections')).toContainText('→ Idea A');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('zip-reimported.png') });
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('una importación inválida explica el motivo y no sobrescribe ni deja estado parcial', async ({ page }, testInfo) => {
  await page.addInitScript({ content: withoutFolderAccess });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await importZip(page, 'demo.zip', fixtureZip());
  await page.getByTestId('card-idea-a').click();
  await page.getByLabel('Título de la tarjeta').fill('Editada antes del error');
  await button(page, 'Guardar texto').click();
  await expect(page.getByTestId('card-idea-a')).toContainText('Editada antes del error');
  await button(page, 'Volver a mis espacios').click();

  const alert = page.getByRole('alert');
  await importZip(page, 'hostil.zip', fixtureZip({ '../fuera.md': text('x') }));
  await expect(alert).toHaveText('No se importó el ZIP y no cambió nada. Demo/../fuera.md: No admite segmentos "." ni "..".');
  await importZip(page, 'roto.zip', Buffer.from('esto no es un zip'));
  await expect(alert).toHaveText('No se importó el ZIP y no cambió nada. No es un archivo ZIP o está incompleto.');
  await importZip(page, 'extra.zip', fixtureZip({ 'notas.txt': text('x') }));
  await expect(alert).toContainText('No se importó el ZIP y no cambió nada. notas.txt:');
  await page.screenshot({ path: testInfo.outputPath('zip-invalid.png') });

  // El espacio válido sigue intacto, con su edición pendiente de exportar.
  await expect(page.getByRole('button', { name: /^Abrir Demo/ })).toHaveCount(1);
  await expect(page.getByTestId('unexported-demo')).toBeVisible();

  // Mismo ID: se importa como copia sin tocar el original.
  await importZip(page, 'demo.zip', fixtureZip());
  await expect(page.getByTestId('archive-message')).toHaveText(
    'Ya existía un espacio con el ID «demo»: el ZIP se importó como copia con el ID «demo-2». No se sobrescribió nada.');
  await expect(page).toHaveURL(/id=demo-2/);
  await expect(page.getByTestId('card-idea-a')).toContainText('Idea A');
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Abrir Demo').first().click();
  await expect(page.getByTestId('card-idea-a')).toContainText('Editada antes del error');
});

/** ¿Bloquearía el navegador la salida? Evento sintético: no navega, así que no depende de una recarga. */
const blocksUnload = (page: Page) => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});

test('los cambios sin exportar no se descartan en silencio al salir ni al abrir una carpeta', async ({ page, browserName }) => {
  // Selector de carpeta presente pero que no debería llegar a usarse.
  await page.addInitScript({ content: `window.showDirectoryPicker = async () => { window.__pickerUsed = true; throw Object.assign(new Error('x'), { name: 'AbortError' }); };` });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.getByLabel('Nombre del nuevo espacio').fill('Pendiente');
  await button(page, 'Crear un espacio').click();
  await expect(page.getByTestId('export-status')).toContainText('CAMBIOS SIN EXPORTAR');

  // Recargar con cambios pendientes pide confirmación; al cancelar, todo sigue.
  expect(await blocksUnload(page)).toBe(true);
  const leaving = page.waitForEvent('dialog');
  void page.evaluate(() => window.location.reload());
  const warning = await leaving;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  await expect(page.getByRole('heading', { name: 'Pendiente', exact: true })).toBeVisible();

  // Abrir una carpeta pediría sustituir los espacios del navegador: exige confirmación.
  await button(page, 'Volver a mis espacios').click();
  // confirm() bloquea el clic hasta responder: se atiende con un manejador registrado antes.
  const questions: { type: string; message: string }[] = [];
  page.once('dialog', (dialog) => { questions.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
  await button(page, 'Abrir una carpeta').click();
  await expect.poll(() => questions.length).toBe(1);
  expect(questions[0]?.type).toBe('confirm');
  expect(questions[0]?.message).toContain('1 espacio del navegador sin exportar');
  await expect(page.getByRole('alert')).toHaveText('No se abrió la carpeta. Exporta antes como ZIP los espacios marcados «SIN EXPORTAR».');
  expect(await page.evaluate(() => (window as unknown as { __pickerUsed?: boolean }).__pickerUsed ?? false)).toBe(false);
  await expect(page.getByTestId('memory-notice')).toContainText('SOLO EN MEMORIA');

  // Tras exportar ya no hay nada pendiente: recargar no pregunta.
  await button(page, 'Abrir Pendiente').click();
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  await download;
  await expect(page.getByTestId('export-status')).toContainText('CAMBIOS SIN EXPORTAR');
  await button(page, 'Confirmar que guardé pendiente.zip').click();
  await expect(page.getByTestId('export-status')).toHaveText('SIN CAMBIOS PENDIENTES DE EXPORTAR');
  // Sin cambios pendientes ya no se bloquea la salida.
  expect(await blocksUnload(page)).toBe(false);
  // Firefox bajo Playwright no ejecuta location.reload() después de haber cancelado un beforeunload,
  // ni siquiera en una página mínima sin la app (tests/repro/firefox-beforeunload-reload.mjs). La
  // recarga real se comprueba solo en Chromium; el estado del aviso se comprobó arriba en ambos.
  if (browserName === 'chromium') {
    let prompted = false;
    page.on('dialog', (dialog) => { prompted = true; void dialog.dismiss(); });
    await page.evaluate(() => window.location.reload());
    await expect(page.getByTestId('workspace-missing')).toBeVisible();
    expect(prompted).toBe(false);
  }
});

test('accesibilidad del fallback ZIP: teclado, nombres y controles táctiles', async ({ page }) => {
  await page.addInitScript({ content: withoutFolderAccess });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  const importButton = button(page, 'Importar un ZIP');
  await expect(importButton).toBeEnabled();
  const box = await importButton.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // Enter sobre el botón enfocado abre el selector de archivos.
  await importButton.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'demo.zip', mimeType: 'application/zip', buffer: fixtureZip() });
  const exportButton = button(page, 'Exportar este espacio como ZIP');
  await expect(exportButton).toBeVisible();
  const exportBox = await exportButton.boundingBox();
  expect(exportBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(exportBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  await exportButton.focus();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Space');
  expect((await download).suggestedFilename()).toBe('demo.zip');
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('exportar no da por conservado nada si la descarga falla, se cancela o hubo cambios después (auditoría de fase 9)', async ({ page }) => {
  await page.addInitScript({ content: withoutFolderAccess });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await importZip(page, 'demo.zip', fixtureZip());
  await button(page, 'Añadir nota').click();
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');

  // 1. Iniciar la descarga falla: error visible, sigue pendiente y no se ofrece confirmar.
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('bloqueado'); }; });
  await button(page, 'Exportar este espacio como ZIP').click();
  await expect(page.getByRole('alert')).toHaveText('No se pudo iniciar la descarga del ZIP. El espacio sigue sin exportar.');
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');
  await expect(button(page, 'Confirmar que guardé demo.zip')).toHaveCount(0);
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByTestId('unexported-demo')).toBeVisible();
  await page.reload();
  await importZip(page, 'demo.zip', fixtureZip());
  await button(page, 'Añadir nota').click();

  // 2. El usuario indica que no se guardó: sigue pendiente.
  let download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  await download;
  await button(page, 'El ZIP demo.zip no se guardó').click();
  await expect(page.getByTestId('archive-message')).toHaveText('Sigue sin exportar. Vuelve a exportar cuando quieras.');
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');

  // 3. Una edición después de exportar invalida la confirmación de esa exportación.
  download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  await download;
  await button(page, 'Añadir imagen de ejemplo').click();
  await expect(page.getByTestId('card-tarjeta-2')).toBeVisible();
  await button(page, 'Confirmar que guardé demo.zip').click();
  await expect(page.getByTestId('archive-message')).toHaveText('Hubo cambios después de exportar ese ZIP: sigue sin exportar. Vuelve a exportar.');
  await expect(page.getByTestId('export-status')).toHaveText('CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.');
  await expect(button(page, 'Confirmar que guardé demo.zip')).toHaveCount(0);
});

test('fixture v1 con dos tableros: navegar y avisar de tarjetas sin posición en vez de un tablero vacío (ADR 0013)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await importZip(page, 'demo.zip', fixtureZip());
  await expect(page.getByRole('heading', { name: 'Demo', exact: true })).toBeVisible();
  // Número de tarjetas de cada tablero en su pestaña (en móvil la cabecera no repite el tablero).
  await expect(button(page, 'Tablero Resumen')).toContainText('2');
  await expect(button(page, 'Tablero Resumen')).toHaveAttribute('aria-pressed', 'true');

  // «Investigación» declara idea-a pero su layout no la coloca: v1 válido, no un tablero vacío.
  await button(page, 'Tablero Investigación').click();
  await expect(button(page, 'Tablero Investigación')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Tablero Investigación')).toContainText('1');
  await expect(page.getByTestId('board-unplaced')).toContainText('1 tarjeta de este tablero no tiene posición en la grilla: «Idea A».');
  await expect(page.getByTestId('board-empty')).toHaveCount(0);
  await expect(page.getByTestId('card-idea-a')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('zip-unplaced.png') });
  await button(page, 'Tablero Resumen').click();
  await expect(page.getByTestId('card-idea-a')).toBeVisible();
  await expect(page.getByTestId('board-unplaced')).toHaveCount(0);
});

test('ZIP: la imagen importada y la Papelera viajan en el ZIP y vuelven al reimportarlo (ADR 0015)', async ({ page }, testInfo) => {
  const icon = fileURLToPath(new URL('../../apps/noutynotes/assets/branding/app-icon.png', import.meta.url));
  await page.addInitScript({ content: withoutFolderAccess });
  await page.goto('./');
  await page.getByLabel('Nombre del nuevo espacio').fill('Viaje');
  await button(page, 'Crear un espacio').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar una imagen').click();
  await (await chooser).setFiles(icon);
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  await button(page, 'Añadir nota').click();
  await page.getByLabel('Título de la tarjeta').fill('Descartada');
  await button(page, 'Guardar texto').click();
  await button(page, 'Enviar la tarjeta Descartada a la Papelera').click();
  await expect(button(page, 'Abrir la Papelera (1)')).toBeVisible();

  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const zipPath = testInfo.outputPath('viaje.zip');
  await (await download).saveAs(zipPath);
  const archive = readWorkspaceArchive(new Uint8Array(readFileSync(zipPath)));
  expect(archive.ok).toBe(true);
  if (!archive.ok) return;
  expect(archive.value.assets['assets/images/tarjeta-1.png']).toEqual(new Uint8Array(readFileSync(icon)));
  expect(archive.value.workspace.trash?.map((entry) => entry.card.title)).toEqual(['Descartada']);

  // Otra sesión: reimportar trae la vista previa (sin red) y la Papelera.
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await importZip(page, 'viaje.zip', readFileSync(zipPath));
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  await button(page, 'Abrir la Papelera (1)').click();
  await expect(page.getByTestId('trash-item-tarjeta-2')).toContainText('Descartada');
});
