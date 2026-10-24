import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Card, RichTextDocument, RichTextImage } from '../../packages/domain/src/index';
import type { WorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { fillCardTitle, insertFromMenu, openCardActions, openFullCardEditor, openMore } from './support';

test.setTimeout(90_000);
test.use({ actionTimeout: 7000 });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const longCaption = 'Leyenda extensa N4: ' + 'Este texto pertenece al pie y nunca sustituye la descripción accesible. '.repeat(9);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, id: string) => page.getByTestId(`card-${id}`);
const codecUrl = process.env.N4_CODEC_URL;
test.skip(!codecUrl, 'Ejecutar con el arnés artifacts/n4/browser.test.ts y sus codecs reales.');
async function codec<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${codecUrl}/${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function decodeArchive(bytes: Uint8Array): Promise<WorkspaceArchive> {
  const wire = await codec<Omit<WorkspaceArchive, 'assets'> & { assets: Record<string, number[]> }>('archive', Buffer.from(bytes).toString('base64'));
  return { ...wire, assets: Object.fromEntries(Object.entries(wire.assets).map(([path, asset]) => [path, new Uint8Array(asset)])) };
}
let historical: WorkspaceArchive;
let historicalCard: Card;
let originalImage: RichTextImage;
test.beforeAll(async () => {
  historical = await decodeArchive(readFileSync('tests/smoke/fixtures/historical-caption-marker.zip'));
  historicalCard = historical.workspace.cards[0]!;
  originalImage = (await codec<RichTextDocument>('document', historicalCard)).blocks.filter((block): block is RichTextImage => block.type === 'image')[0]!;
});
function images(note: Card): readonly RichTextImage[] {
  if (!note.contentDocument) throw new Error(`La Nota ${note.id} necesita decodificación histórica explícita`);
  return note.contentDocument.blocks.filter((block): block is RichTextImage => block.type === 'image');
}
function findCard(archive: WorkspaceArchive, id: string): Card {
  const found = archive.workspace.cards.find((note) => note.id === id);
  if (!found) throw new Error(`Falta Nota ${id}`);
  return found;
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const assetHashes = (archive: WorkspaceArchive) => Object.fromEntries(Object.entries(archive.assets).map(([path, bytes]) => [path, sha(bytes)]));

async function importZip(page: Page, bytes: Uint8Array) {
  const picker = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await picker).setFiles({ name: 'n4-integracion.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(card(page, historicalCard.id)).toBeVisible();
}
async function exported(page: Page, info: TestInfo, label: string) {
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const file = await download;
  const path = info.outputPath(`${label}.zip`);
  await file.saveAs(path);
  const confirmation = button(page, `Confirmar que guardé ${file.suggestedFilename()}`);
  // Exporting an unchanged imported workspace has no unexported revision to acknowledge.
  if (await confirmation.isVisible()) await confirmation.click();
  return decodeArchive(readFileSync(path));
}
async function closeEditor(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}
async function actions(page: Page, id: string, title: string) {
  await card(page, id).click({ position: { x: 10, y: 10 } });
  await openCardActions(page, card(page, id), title);
}
async function options(block: Locator) {
  await block.getByTestId('image-media').click();
  if (!await block.getByTestId('image-advanced-options').isVisible()) {
    await block.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  }
}
async function confirm(block: Locator, intent: 'informative' | 'decorative') {
  await block.getByLabel('Propósito de la imagen', { exact: true }).selectOption(intent);
  await block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).check();
  await block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).click();
  await expect(block.getByTestId('image-review-feedback')).toHaveText('Propósito y textos confirmados');
}
async function saveEditor(page: Page) {
  await button(page, 'Guardar texto').click();
  await expect(page.getByText('Sin cambios pendientes', { exact: true })).toBeVisible();
}
async function shrinkToReader(page: Page, id: string) {
  const note = card(page, id);
  await note.click({ position: { x: 10, y: 10 } });
  await expect(note).toHaveAttribute('aria-pressed', 'true');
  for (let count = 0; count < 10 && !await page.getByTestId(`card-reader-${id}`).isVisible(); count += 1) {
    await note.press('Shift+ArrowUp');
  }
  const reader = page.getByTestId(`card-reader-${id}`);
  await expect(reader).toBeVisible();
  return reader;
}
async function readerEnds(reader: Locator) {
  await reader.press('End');
  await expect.poll(() => reader.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
  // The separate, previously recorded immediate End→Home race is outside N4.
  await reader.evaluate(() => new Promise<void>((resolve) => {
    const frame = (remaining: number) => requestAnimationFrame(() => remaining > 1 ? frame(remaining - 1) : resolve());
    frame(4);
  }));
  await reader.press('Home');
  await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBe(0);
}
async function nativeFiles(page: Page): Promise<Record<string, number[]>> {
  return page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('n4-native');
    const files: Record<string, number[]> = {};
    const visit = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'directory') await visit(handle, `${prefix}${name}/`);
        else files[`${prefix}${name}`] = [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
      }
    };
    await visit(root, '');
    return files;
  });
}
async function nativeWorkspace(files: Record<string, number[]>) {
  return codec<WorkspaceArchive['workspace']>('files', files);
}

test('T01 complementario: pegado real y reapertura con handles OPFS nativos (sin selector externo)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Portapapeles real y handles nativos se verifican en Chromium desktop.');
  info.annotations.push({ type: 'limitación-T01', description: 'OPFS nativo; sustituye solo selector. No certifica carpeta externa ni diálogo/permisos del sistema.' });
  await page.addInitScript({ content: 'window.showDirectoryPicker = async () => await navigator.storage.getDirectory();' });
  await page.goto('./');
  const seed = { ...historical.workspace, metadata: { ...historical.workspace.metadata, name: 'N4 nativo' } };
  const seedFiles = await codec<Record<string, string>>('serialize', seed);
  const payload = Object.entries(seedFiles).map(([path, text]) => ({ path, bytes: [...new TextEncoder().encode(text)] }));
  payload.push(...Object.entries(historical.assets).map(([path, bytes]) => ({ path, bytes: [...bytes] })));
  const capabilities = await page.evaluate(async (entries) => {
    const root = await navigator.storage.getDirectory();
    const project = await root.getDirectoryHandle('n4-native', { create: true });
    for (const entry of entries) {
      const parts = entry.path.split('/'); const name = parts.pop()!;
      let directory = project;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      const file = await directory.getFileHandle(name, { create: true });
      const writer = await file.createWritable(); await writer.write(new Uint8Array(entry.bytes)); await writer.close();
    }
    return { native: root instanceof FileSystemDirectoryHandle, kind: root.kind, type: Object.prototype.toString.call(root) };
  }, payload);
  expect(capabilities).toEqual({ native: true, kind: 'directory', type: '[object FileSystemDirectoryHandle]' });
  await info.attach('handles-nativos', { body: JSON.stringify(capabilities), contentType: 'application/json' });
  const connect = async () => {
    await page.getByRole('button', { name: /^Abrir (otro )?proyecto$/ }).click();
    await button(page, 'Abrir el proyecto N4 nativo').click();
    await expect(card(page, historicalCard.id)).toBeVisible();
  };
  const seeded = await nativeFiles(page);
  await connect();
  expect(await nativeFiles(page)).toEqual(seeded);
  await insertFromMenu(page, 'Insertar nota');
  const id = 'tarjeta-2';
  await openFullCardEditor(page, card(page, id));
  await fillCardTitle(page, 'Nota N4 pegado');
  const visual = page.getByLabel('Contenido visual');
  await visual.click();
  await page.keyboard.insertText('COMIENZO N4. ' + 'Texto conservado antes de la imagen. '.repeat(10));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const clipboardBytes = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    const item = (await navigator.clipboard.read())[0]!;
    return [...new Uint8Array(await (await item.getType('image/png')).arrayBuffer())];
  }, png.toString('base64'));
  await page.keyboard.press('ControlOrMeta+KeyV');
  const image = visual.locator('[data-testid^="rich-image-"]');
  await expect(image).toHaveCount(1);
  await options(image);
  await expect(image.getByLabel(/^Texto alternativo/)).toHaveValue('');
  await expect(image.getByLabel(/^Leyenda/)).toHaveValue('');
  await expect(image.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('pending');
  await image.getByLabel(/^Texto alternativo/).fill('Descripción N4 pegada');
  await image.getByLabel(/^Leyenda/).fill('Leyenda N4 independiente');
  await confirm(image, 'informative');
  await saveEditor(page);
  await closeEditor(page);
  await actions(page, id, 'Nota N4 pegado');
  await button(page, 'Editar Nota N4 pegado dentro de la ficha').click();
  const quick = page.getByTestId('inline-card-editor').locator('[data-testid^="rich-image-"]');
  await options(quick);
  await quick.getByLabel(/^Leyenda/).fill('Leyenda N4 transferida inmediatamente');
  await openFullCardEditor(page, card(page, id));
  await expect(image.getByLabel(/^Leyenda/)).toHaveValue('Leyenda N4 transferida inmediatamente');
  await saveEditor(page);
  await closeEditor(page);
  await expect.poll(async () => images((await nativeWorkspace(await nativeFiles(page))).cards.find((note) => note.id === id)!).at(0)?.caption).toEqual([{ type: 'text', text: 'Leyenda N4 transferida inmediatamente' }]);
  const persisted = await nativeFiles(page);
  const persistedWorkspace = await nativeWorkspace(persisted);
  const note = persistedWorkspace.cards.find((item) => item.id === id)!;
  expect(images(note)[0]).toMatchObject({ alt: 'Descripción N4 pegada', captionPolicy: 'explicit', accessibilityIntent: 'informative' });
  expect(await codec<RichTextDocument>('document', persistedWorkspace.cards.find((item) => item.id === historicalCard.id)!)).toEqual(await codec<RichTextDocument>('document', historicalCard));
  expect(persisted[`cards/${historicalCard.id}.md`]).toEqual(seeded[`cards/${historicalCard.id}.md`]);
  const pastedRef = images(note)[0]!.assetRef;
  expect(sha(new Uint8Array(persisted[pastedRef]!))).toBe(sha(new Uint8Array(clipboardBytes)));
  await expect(card(page, id)).not.toContainText('nouty-caption:v1');
  await page.screenshot({ path: info.outputPath('canvas-antes-recarga.png'), fullPage: true });
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await connect();
  expect(await nativeFiles(page)).toEqual(persisted);
  await expect(card(page, id)).toContainText('Leyenda N4 transferida inmediatamente');
  await expect(card(page, id).getByRole('img', { name: 'Descripción N4 pegada', exact: true }).first()).toHaveAccessibleName('Descripción N4 pegada');
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId(`list-rich-note-preview-${id}`)).toContainText('Leyenda N4 transferida inmediatamente');
  await expect(card(page, id)).not.toContainText('nouty-caption:v1');
  await button(page, 'Vista de lista').click();
  const reader = await shrinkToReader(page, id);
  await readerEnds(reader);
  await expect(reader).toContainText('COMIENZO N4');
  await expect(reader.locator('figcaption')).toHaveText('Leyenda N4 transferida inmediatamente');
  await reader.screenshot({ path: info.outputPath('lector-reconectado.png') });
  await info.attach('documento-nativo', { body: JSON.stringify(note.contentDocument), contentType: 'application/json' });
});

test('T02: mixto, Assets compartidos, reemplazo, Archivo, Papelera, ZIP y lectura', async ({ page }, info) => {
  const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] } as const);
  const mixed: RichTextDocument = { schemaVersion: 2, blocks: [
    para('ANTES N4: principio del documento.'), originalImage,
    para('ENTRE N4: texto entre las imágenes.'),
    { ...originalImage, alt: 'Descripción informativa N4', caption: [{ type: 'text', text: longCaption }], captionPolicy: 'explicit', accessibilityIntent: 'informative' },
    para('MEDIO N4: párrafo íntegro.'),
    { ...originalImage, alt: 'Alt decorativo inactivo N4', caption: [{ type: 'text', text: 'Pie decorativo N4' }], captionPolicy: 'explicit', accessibilityIntent: 'decorative' },
    { ...originalImage, alt: 'Alt pendiente inactivo N4', caption: [{ type: 'text', text: 'Pie pendiente N4' }], captionPolicy: 'explicit', accessibilityIntent: 'pending' },
    para('FINAL N4: fin accesible del documento.'),
  ] };
  const prepared = { ...historical.workspace, cards: historical.workspace.cards.map((note) => note.id === historicalCard.id ? { ...note, title: 'N4 original', content: undefined, contentDocument: mixed, contentLayout: 'banner' as const } : note) };
  // Remove the alternate source rather than persist two editorial authorities.
  const workspace = { ...prepared, cards: prepared.cards.map(({ content, ...note }) => content === undefined ? note : { ...note, content }) };
  const zipBase64 = await codec<string>('fixture', { workspace, assets: Object.fromEntries(Object.entries(historical.assets).map(([path, bytes]) => [path, [...bytes]])) });
  const zip = Buffer.from(zipBase64, 'base64');
  await page.goto('./');
  await importZip(page, zip);
  const id = historicalCard.id;
  const initial = await exported(page, info, 'inicial');
  expect(findCard(initial, id).contentDocument).toEqual(mixed);
  const initialHashes = assetHashes(initial);
  await card(page, id).click({ position: { x: 10, y: 10 } });
  await openFullCardEditor(page, card(page, id));
  const visual = page.getByLabel('Contenido visual');
  await visual.press('ControlOrMeta+End');
  await button(page, 'Insertar desde Assets').click();
  await page.getByTestId(`asset-image-picker-item-${originalImage.assetRef.split('/').pop()}`).click();
  const nodes = visual.locator('[data-testid^="rich-image-"]');
  await expect(nodes).toHaveCount(5);
  await info.attach('imagenes-tras-insertar', { body: JSON.stringify(await nodes.evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('aria-label'), html: element.innerHTML })))), contentType: 'application/json' });
  // Identify the newly inserted object by its empty alt, rather than assuming a cursor position.
  await expect(visual.getByRole('group', { name: 'Imagen: sin descripción', exact: true })).toHaveCount(1);
  const insertedIndex = await nodes.evaluateAll((elements) => elements.findIndex((element) => element.getAttribute('aria-label') === 'Imagen: sin descripción'));
  const inserted = nodes.nth(insertedIndex);
  await options(inserted);
  await expect(inserted.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('pending');
  await inserted.getByLabel(/^Texto alternativo/).fill('Descripción añadida desde Assets N4');
  await inserted.getByLabel(/^Leyenda/).fill('Pie añadido desde Assets N4');
  await confirm(inserted, 'informative');
  await saveEditor(page);
  await closeEditor(page);
  const edited = await exported(page, info, 'editado');
  const editedNote = findCard(edited, id);
  expect(images(editedNote)).toHaveLength(5);
  expect(images(editedNote)[0]).toEqual(originalImage);
  expect(assetHashes(edited)).toEqual(initialHashes);
  await actions(page, id, 'N4 original');
  await button(page, 'Duplicar la Nota N4 original').click();
  const duplicated = await exported(page, info, 'duplicado');
  const copy = duplicated.workspace.cards.find((note) => note.id !== id)!;
  expect(copy.contentDocument).toEqual(editedNote.contentDocument);
  expect(assetHashes(duplicated)).toEqual(initialHashes);
  await card(page, copy.id).click({ position: { x: 10, y: 10 } });
  await openFullCardEditor(page, card(page, copy.id));
  await fillCardTitle(page, 'N4 copia');
  const target = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]').nth(1);
  await options(target);
  const replacementPng = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sin canvas para el recurso de prueba');
    context.fillStyle = '#b32539'; context.fillRect(0, 0, 16, 32);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }), 'base64');
  expect(sha(replacementPng)).not.toBe(initialHashes[originalImage.assetRef]);
  const picker = page.waitForEvent('filechooser');
  await target.getByRole('button', { name: /^Reemplazar la imagen/ }).click();
  await (await picker).setFiles({ name: 'reemplazo-n4.png', mimeType: 'image/png', buffer: replacementPng });
  await expect(target.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('pending');
  await expect(target.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción informativa N4');
  await expect(target.getByLabel(/^Leyenda/)).toHaveValue(longCaption);
  await saveEditor(page);
  await closeEditor(page);
  const replaced = await exported(page, info, 'reemplazado');
  const expectedCopy = findCard(replaced, copy.id);
  expect(findCard(replaced, id)).toEqual(editedNote);
  const beforeImage = images(editedNote)[1]!;
  const replacedImage = images(expectedCopy)[1]!;
  expect(replacedImage).toEqual({ ...beforeImage, assetRef: replacedImage.assetRef, accessibilityIntent: 'pending' });
  expect(replacedImage.assetRef).not.toBe(beforeImage.assetRef);
  expect(assetHashes(replaced)[originalImage.assetRef]).toBe(initialHashes[originalImage.assetRef]);
  expect(assetHashes(replaced)[replacedImage.assetRef]).toBe(sha(replacementPng));
  expect(Object.keys(replaced.assets)).toHaveLength(Object.keys(initial.assets).length + 1);
  for (const kind of ['archive', 'trash'] as const) {
    await actions(page, copy.id, 'N4 copia');
    await button(page, kind === 'archive' ? 'Archivar N4 copia' : 'Enviar N4 copia a la Papelera').click();
    await expect(card(page, copy.id)).toHaveCount(0);
    const stored = await exported(page, info, kind);
    expect(kind === 'archive' ? stored.workspace.archive?.[0]?.card : stored.workspace.trash?.[0]?.card).toEqual(expectedCopy);
    expect(assetHashes(stored)).toEqual(assetHashes(replaced));
    if (kind === 'archive') await openMore(page);
    await button(page, kind === 'archive' ? 'Abrir el Archivo (1)' : 'Abrir la Papelera (1)').click();
    await button(page, kind === 'archive' ? 'Restaurar N4 copia del Archivo' : 'Restaurar N4 copia').click();
    await button(page, kind === 'archive' ? 'Volver al tablero' : 'Cerrar papelera').click();
    await expect(card(page, copy.id)).toBeVisible();
    const restored = await exported(page, info, `${kind}-restaurado`);
    expect(findCard(restored, copy.id)).toEqual(expectedCopy);
    expect(findCard(restored, id)).toEqual(editedNote);
    expect(assetHashes(restored)).toEqual(assetHashes(replaced));
  }
  const final = await exported(page, info, 'final');
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await importZip(page, readFileSync(info.outputPath('final.zip')));
  const reopened = await exported(page, info, 'reabierto');
  expect(reopened.workspace.cards).toEqual(final.workspace.cards);
  expect(assetHashes(reopened)).toEqual(assetHashes(final));
  await expect(card(page, copy.id)).not.toContainText('nouty-caption:v1');
  await expect(card(page, copy.id).getByRole('img', { name: 'Descripción informativa N4', exact: true })).toHaveCount(0);
  const pendingFigure = card(page, copy.id).locator('figure').filter({ hasText: longCaption });
  await expect(pendingFigure.locator('img')).toHaveAttribute('aria-hidden', 'true');
  await expect(pendingFigure.locator('img')).toHaveAttribute('alt', '');
  await page.screenshot({ path: info.outputPath('canvas-final.png'), fullPage: true });
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId(`list-rich-note-preview-${id}`)).not.toContainText('nouty-caption:v1');
  await page.screenshot({ path: info.outputPath('lista-final.png'), fullPage: true });
  await button(page, 'Vista de lista').click();
  const reader = await shrinkToReader(page, id);
  await expect(reader).toContainText('ANTES N4');
  const caption = reader.locator('figcaption').filter({ hasText: longCaption }).first();
  await expect(caption).toHaveText(longCaption);
  const captionGeometry = await caption.evaluate((node) => ({ height: node.getBoundingClientRect().height, line: Number.parseFloat(getComputedStyle(node).lineHeight), client: node.clientHeight, scroll: node.scrollHeight }));
  expect(captionGeometry.height).toBeGreaterThan(captionGeometry.line * 2);
  expect(captionGeometry.client).toBeGreaterThanOrEqual(captionGeometry.scroll - 1);
  for (const edge of ['start', 'end'] as const) {
    await reader.evaluate((node, { text, edge }) => {
      const caption = [...node.querySelectorAll('figcaption')].find((item) => item.textContent === text);
      if (!caption) throw new Error('Falta leyenda larga');
      const surface = node.getBoundingClientRect(); const bounds = caption.getBoundingClientRect();
      const scale = surface.width / node.clientWidth;
      node.scrollTop += (edge === 'start' ? bounds.top - surface.top : bounds.bottom - surface.bottom) / scale;
    }, { text: longCaption, edge });
    await expect.poll(() => caption.evaluate((node, edge) => {
      const bounds = node.getBoundingClientRect(); const viewport = node.closest('[aria-label="Contenido completo de la nota"]')!.getBoundingClientRect();
      return edge === 'start' ? Math.abs(bounds.top - viewport.top) <= 2 : Math.abs(bounds.bottom - viewport.bottom) <= 2;
    }, edge)).toBe(true);
    await reader.screenshot({ path: info.outputPath(`leyenda-larga-${edge}.png`) });
  }
  await reader.press('End');
  await expect(reader).toContainText('FINAL N4');
  await readerEnds(reader);
  await expect(reader).toContainText('ANTES N4');
  await reader.screenshot({ path: info.outputPath('lector-leyenda-larga.png') });
  writeFileSync(info.outputPath('lector-accesible.yml'), await reader.ariaSnapshot());
  // The duplicate is initially below the original; move it aside through normal keyboard controls
  // before growing the original, respecting the canvas collision rule rather than bypassing it.
  await card(page, copy.id).click({ position: { x: 10, y: 10 } });
  const separation = async () => {
    const [originalBox, copyBox] = await Promise.all([card(page, id).boundingBox(), card(page, copy.id).boundingBox()]);
    return { delta: copyBox!.x - originalBox!.x, width: originalBox!.width };
  };
  for (let step = 0; step < 25 && (await separation()).delta <= (await separation()).width + 20; step += 1) {
    const left = (await separation()).delta;
    await card(page, copy.id).press('ArrowRight');
    await expect.poll(async () => (await separation()).delta).toBeGreaterThan(left);
  }
  // Focus recenters an offscreen Note after moving its duplicate; Space is the accessible selection.
  await card(page, id).focus();
  await card(page, id).press('Space');
  await expect(card(page, id)).toHaveAttribute('aria-pressed', 'true');
  // Expand the same persisted content until the Banner projection is used instead of the reader.
  const preview = page.getByTestId(`rich-note-preview-${id}`);
  for (let count = 0; count < 30 && (!await preview.isVisible() || await preview.locator('img').count() < 5); count += 1) {
    const beforeHeight = (await card(page, id).boundingBox())!.height;
    await card(page, id).press('Shift+ArrowDown');
    await expect.poll(async () => (await card(page, id).boundingBox())!.height).toBeGreaterThan(beforeHeight);
  }
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(5);
  await expect(preview.getByRole('img', { name: 'Descripción informativa N4', exact: true }).first()).toHaveAccessibleName('Descripción informativa N4');
  await expect(preview.getByRole('img', { name: 'Alt decorativo inactivo N4', exact: true })).toHaveCount(0);
  await expect(preview.getByRole('img', { name: 'Alt pendiente inactivo N4', exact: true })).toHaveCount(0);
  const paragraphs = preview.locator(':scope > [data-testid*="-block-"]');
  await expect(paragraphs).toHaveCount(4);
  const geometry = await paragraphs.evaluateAll((blocks) => blocks.map((block) => {
    const text = block.querySelector<HTMLElement>('[dir="auto"]');
    if (!text) throw new Error('Falta párrafo medible');
    const box = block.getBoundingClientRect(); const parent = block.parentElement!.getBoundingClientRect();
    const scale = parent.width / block.parentElement!.offsetWidth;
    return { height: box.height, minimum: Number.parseFloat(getComputedStyle(text).lineHeight) * scale,
      client: block.clientHeight, scroll: block.scrollHeight, contained: box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1 };
  }));
  expect(geometry.every((block) => block.height >= block.minimum && block.client >= block.scroll - 1 && block.contained)).toBe(true);
  await page.screenshot({ path: info.outputPath('banner-ampliado.png'), fullPage: true });
  await card(page, id).click({ position: { x: 10, y: 10 } });
  await openFullCardEditor(page, card(page, id));
  await button(page, 'Mostrar apariencia y propiedades').click();
  await button(page, 'Documento').click();
  await expect(button(page, 'Documento')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await expect(preview).toBeVisible();
  const thumbnail = preview.getByTestId(`rich-note-preview-${id}-image-1`);
  const thumbnailHeight = await thumbnail.evaluate((element) => {
    const node = element as HTMLElement; const box = node.getBoundingClientRect();
    return box.height / (box.width / node.offsetWidth);
  });
  expect(thumbnailHeight).toBeCloseTo(88, 0);
  await page.screenshot({ path: info.outputPath('documento-ampliado.png'), fullPage: true });
  const afterAppearance = await exported(page, info, 'apariencia-final');
  expect(findCard(afterAppearance, id).contentDocument).toEqual(editedNote.contentDocument);
  expect(assetHashes(afterAppearance)).toEqual(assetHashes(final));
  writeFileSync(info.outputPath('geometria-parrafos.json'), JSON.stringify(geometry, null, 2));
  writeFileSync(info.outputPath('integridad.json'), JSON.stringify({ hashes: assetHashes(reopened), original: editedNote.contentDocument, copy: expectedCopy.contentDocument, captionGeometry }, null, 2));
});
