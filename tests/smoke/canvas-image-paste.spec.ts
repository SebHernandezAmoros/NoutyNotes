import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Card, RichTextImage } from '../../packages/domain/src/index';
import type { WorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { fillCardTitle, openFullCardEditor, trackProblems } from './support';

test.setTimeout(60_000);
test.use({ actionTimeout: 7000 });
const codecUrl = process.env.N4_CODEC_URL;
test.skip(!codecUrl, 'Requiere N4_CASE=CANVAS-PASTE y el arnés artifacts/n4/browser.test.ts.');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, id = 'tarjeta-2') => page.getByTestId(`card-${id}`);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function decode(bytes: Uint8Array): Promise<WorkspaceArchive> {
  const response = await fetch(`${codecUrl}/archive`, { method: 'POST', body: JSON.stringify(Buffer.from(bytes).toString('base64')) });
  if (!response.ok) throw new Error(await response.text());
  const wire = await response.json() as Omit<WorkspaceArchive, 'assets'> & { assets: Record<string, number[]> };
  return { ...wire, assets: Object.fromEntries(Object.entries(wire.assets).map(([ref, data]) => [ref, new Uint8Array(data)])) };
}
let historical: WorkspaceArchive;
test.beforeAll(async () => { historical = await decode(readFileSync('tests/smoke/fixtures/historical-caption-marker.zip')); });
async function importZip(page: Page, bytes: Uint8Array) {
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await chooser).setFiles({ name: 'canvas-paste.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(card(page, 'tarjeta-1')).toBeVisible();
}
async function start(page: Page) {
  await page.goto('./');
  await importZip(page, readFileSync('tests/smoke/fixtures/historical-caption-marker.zip'));
  await expect(card(page, 'tarjeta-1')).not.toContainText('nouty-caption:v1');
}
async function clipboard(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    const items = await navigator.clipboard.read();
    return [...new Uint8Array(await (await items[0]!.getType('image/png')).arrayBuffer())];
  }, png);
}
async function saved(page: Page, info: TestInfo, label: string) {
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const file = await download;
  const path = info.outputPath(`${label}.zip`);
  await file.saveAs(path);
  const confirmation = button(page, `Confirmar que guardé ${file.suggestedFilename()}`);
  if (await confirmation.isVisible()) await confirmation.click();
  const bytes = readFileSync(path);
  return { bytes, archive: await decode(bytes) };
}
function image(note: Card): RichTextImage {
  const block = note.contentDocument?.blocks[0];
  if (block?.type !== 'image') throw new Error('Falta la imagen enriquecida inicial');
  return block;
}
function checkArchive(archive: WorkspaceArchive, clipboardBytes: readonly number[]) {
  const note = archive.workspace.cards.find((entry) => entry.id === 'tarjeta-2')!;
  expect(note.title).toBe('Imagen');
  expect(note.content).toBeUndefined();
  expect(note.contentDocument?.schemaVersion).toBe(2);
  expect(image(note)).toMatchObject({ alt: '', captionPolicy: 'explicit', accessibilityIntent: 'pending' });
  expect(image(note).caption).toBeUndefined();
  expect(note.assetRefs).toEqual([image(note).assetRef]);
  expect(sha(archive.assets[image(note).assetRef]!)).toBe(sha(Uint8Array.from(clipboardBytes)));
  expect(archive.files['cards/tarjeta-2.md']).toContain('contentFormat: html');
  expect(archive.files['cards/tarjeta-2.md']).toContain('contentVersion: 2');
  expect(archive.files['cards/tarjeta-2.md']).toContain('data-nouty-image-accessibility-intent="pending"');
  expect(archive.workspace.cards.find((entry) => entry.id === 'tarjeta-1')).toEqual(historical.workspace.cards[0]);
  expect(archive.files['cards/tarjeta-1.md']).toBe(historical.files['cards/tarjeta-1.md']);
  for (const [ref, bytes] of Object.entries(historical.assets)) expect(sha(archive.assets[ref]!)).toBe(sha(bytes));
  expect(Object.keys(archive.assets)).toHaveLength(Object.keys(historical.assets).length + 1);
  return note;
}
async function visiblePending(reading: Locator) {
  const media = reading.locator('img').first();
  await expect(media).toBeVisible();
  expect(await media.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await expect(reading.getByRole('img')).toHaveCount(0);
  await expect(reading).not.toContainText('imagen-pegada');
  await expect(reading).not.toContainText('nouty-caption:v1');
}
async function options(page: Page) {
  await openFullCardEditor(page, card(page));
  const block = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await block.getByTestId('image-media').click();
  await block.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  return block;
}
async function close(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}

test('CP-01: CtrlV real crea Imagen pendiente, conserva Asset, selección e historial', async ({ page }, info) => {
  const { runtimeErrors } = trackProblems(page);
  await start(page);
  const clipboardBytes = await clipboard(page);
  await page.getByTestId('board-canvas').click({ position: { x: 900, y: 550 } });
  await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page)).toContainText('Imagen');
  await visiblePending(card(page));
  await card(page).press('ControlOrMeta+KeyZ');
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
  await expect(card(page)).toBeVisible();
  const block = await options(page);
  await expect(page.getByLabel('Nombre de la Nota', { exact: true })).toHaveValue('Imagen');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('');
  await expect(block.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('pending');
  await expect(block.getByTestId('image-review-status')).toContainText(/pendiente/i);
  await block.getByTestId('image-review-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('revision-pendiente-desktop.png'), fullPage: true });
  await close(page);
  const { archive } = await saved(page, info, 'ctrlv');
  const note = checkArchive(archive, clipboardBytes);
  writeFileSync(info.outputPath('integridad.json'), JSON.stringify({ note, sha256: sha(archive.assets[image(note).assetRef]!), clipboardSha256: sha(Uint8Array.from(clipboardBytes)) }, null, 2));
  await page.screenshot({ path: info.outputPath('canvas-desktop.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});

test('CP-02: menú, textos independientes, ZIP y lectura reabierta móvil con histórica intacta', async ({ page }, info) => {
  const { runtimeErrors } = trackProblems(page);
  await start(page);
  const clipboardBytes = await clipboard(page);
  await page.getByTestId('board-canvas').click({ button: 'right', position: { x: 900, y: 550 } });
  await button(page, 'Pegar una imagen del portapapeles aquí').click();
  await expect(card(page)).toBeVisible();
  await visiblePending(card(page));
  const initial = await saved(page, info, 'menu-inicial');
  checkArchive(initial.archive, clipboardBytes);
  const block = await options(page);
  await fillCardTitle(page, 'Imagen elegida por mí');
  await block.getByLabel(/^Texto alternativo/).fill('Descripción CP independiente');
  await block.getByLabel(/^Leyenda/).fill('Leyenda CP escrita por usuario');
  await button(page, 'Guardar texto').click();
  await expect(page.getByText('Sin cambios pendientes', { exact: true })).toBeVisible();
  await close(page);
  const final = await saved(page, info, 'menu-editado');
  const note = final.archive.workspace.cards.find((entry) => entry.id === 'tarjeta-2')!;
  // El campo de título existente guarda la edición como titleRichText, sin cambiar su contrato.
  expect(note.titleRichText).toEqual([{ type: 'text', text: 'Imagen elegida por mí' }]);
  expect(image(note)).toMatchObject({ alt: 'Descripción CP independiente', caption: [{ type: 'text', text: 'Leyenda CP escrita por usuario' }], captionPolicy: 'explicit', accessibilityIntent: 'pending' });
  expect(final.archive.files['cards/tarjeta-1.md']).toBe(historical.files['cards/tarjeta-1.md']);
  expect(sha(final.archive.assets[image(note).assetRef]!)).toBe(sha(Uint8Array.from(clipboardBytes)));
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await importZip(page, final.bytes);
  await expect(card(page)).toContainText('Imagen elegida por mí');
  await visiblePending(card(page));
  await page.screenshot({ path: info.outputPath('encuadre-inicial-movil.png'), fullPage: true });
  // El encuadre inicial del tablero puede dejar parte de una Nota fuera de pantalla.
  // Se conserva esa evidencia y se usa la acción existente de centrado para inspeccionar su cuerpo.
  await card(page).focus();
  await card(page).press('Space');
  await page.screenshot({ path: info.outputPath('canvas-reabierto-movil.png'), fullPage: true });
  await button(page, 'Vista de lista').click();
  await expect(card(page)).toContainText('Leyenda CP escrita por usuario');
  await visiblePending(card(page));
  await expect(card(page, 'tarjeta-1')).not.toContainText('nouty-caption:v1');
  await card(page).scrollIntoViewIfNeeded();
  await expect(card(page).locator('img').first()).toBeInViewport();
  await page.screenshot({ path: info.outputPath('lista-reabierta-movil.png'), fullPage: true });
  await button(page, 'Vista de lista').click();
  await card(page).click({ position: { x: 10, y: 10 } });
  for (let step = 0; step < 8 && !await page.getByTestId('card-reader-tarjeta-2').isVisible(); step += 1) await card(page).press('Shift+ArrowUp');
  const reader = page.getByTestId('card-reader-tarjeta-2');
  await expect(reader).toBeVisible();
  await visiblePending(reader);
  await expect(reader).toContainText('Leyenda CP escrita por usuario');
  await reader.press('End');
  await expect.poll(() => reader.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
  writeFileSync(info.outputPath('lector-accesible.yml'), await reader.ariaSnapshot());
  await page.screenshot({ path: info.outputPath('lector-reabierto-movil.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});
