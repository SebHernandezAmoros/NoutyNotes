import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { block8Document, block8PdfBytes, fontRef, pdfRef } from '../fixtures/block8-content';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { detachmentPdfRef, detachmentRef } from '../fixtures/asset-detachment';

function value<T>(r: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; }
function installedTestFont(): Uint8Array {
  const testRequire = createRequire(createRequire(import.meta.url).resolve('@playwright/test/package.json'));
  const playwrightRequire = createRequire(testRequire.resolve('playwright/package.json'));
  const directory = join(dirname(playwrightRequire.resolve('playwright-core/package.json')), 'lib/vite/traceViewer');
  const name = readdirSync(directory).find((file) => file.endsWith('.ttf'));
  if (!name) throw new Error('No installed font fixture.');
  return new Uint8Array(readFileSync(join(directory, name)));
}
async function lab(page: Page, options: { readonly font?: 'missing' | 'real'; readonly long?: boolean; readonly pdf?: 'missing' | 'broken'; readonly pdfCardSize?: { readonly w: number; readonly h: number }; readonly pdfCard?: 'long' | 'missing' | 'retired' } = {}) {
  const png = new Uint8Array(await page.evaluate(() => {
    const canvas = window.document.createElement('canvas'); canvas.width = 360; canvas.height = 540;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e8f0da'; context.fillRect(0, 0, 360, 540);
    context.fillStyle = '#216b64'; context.fillRect(20, 20, 320, 180);
    context.fillStyle = '#e9a0b9'; context.fillRect(20, 220, 150, 280);
    context.fillStyle = '#344533'; context.fillRect(190, 220, 150, 280);
    context.fillStyle = '#fff'; context.font = 'bold 28px sans-serif'; context.fillText('IMAGEN B8', 48, 112);
    return [...atob(canvas.toDataURL('image/png').split(',')[1]!)].map((character) => character.charCodeAt(0));
  }));
  const base = canvasCardsWorkspace();
  const document = options.long ? { ...block8Document, blocks: [...block8Document.blocks, ...Array.from({ length: 80 }, (_, index) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text: `Párrafo B8 ${index + 1}: texto para comprobar fuente y scroll sin mover la Nota.` }] }))] } : block8Document;
  // Área libre para redimensionar el PDF sin colisionar con la tarjeta retirada del fixture B7.
  const workspace = { ...base, ...(options.pdfCardSize ? { layouts: base.layouts.map((layout) => ({ ...layout, placements: layout.placements.map((p) => p.cardId === 'pdf' ? { ...p, rect: { ...p.rect, x: 20, y: 0, ...options.pdfCardSize } } : p) })) } : {}), metadata: { name: 'Contenido B8' }, cards: base.cards.map((card, index) => index === 0 ? { ...card, contentDocument: document,
    ...(options.font ? { noteFont: { kind: 'asset' as const, assetRef: fontRef } } : {}) }
    : card.id === 'pdf' && options.pdfCard === 'long' ? { ...card, title: 'Documento PDF con un título extenso que debe permanecer legible y centrado al redimensionar' }
    : card.id === 'pdf' && options.pdfCard === 'retired' ? { ...card, assetRefs: [], primaryResourceState: { kind: 'retired' as const, resourceKind: 'pdf' as const } } : card) };
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(workspace)), { ...(options.pdf === 'missing' ? {} : { [pdfRef]: options.pdf === 'broken' ? new TextEncoder().encode('invalid PDF') : block8PdfBytes() }), ...(options.pdfCard === 'missing' ? {} : { [detachmentPdfRef]: block8PdfBytes() }), [detachmentRef]: png,
    ...(options.font === 'real' ? { [fontRef]: installedTestFont() } : {}) }));
  if (!options.font && !options.long && !options.pdf && !options.pdfCard && !options.pdfCardSize) writeFileSync('artifacts/block8-fixture.zip', zip);
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'content.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.getByRole('heading', { name: 'Contenido B8', exact: true })).toBeVisible();
  return { png };
}
async function edit(page: Page) {
  const card = page.getByTestId('card-idea-a');
  await card.focus(); await page.keyboard.press('Shift+F10');
  const quick = page.getByRole('button', { name: 'Editar Documento extenso dentro de la ficha', exact: true });
  if (await quick.isVisible()) await quick.click(); else await page.getByRole('button', { name: 'Abrir el Inspector de Documento extenso', exact: true }).click();
  await expect(page.getByTestId('web-rich-text-content')).toBeVisible();
}
test('B8: PDF entre párrafos, apertura explícita, inserción, Undo/Redo y ZIP reabierto', async ({ page }, info) => {
  await lab(page);
  const card = page.getByTestId('card-idea-a');
  await expect(card).toContainText('Antes del PDF');
  await expect(card).toContainText('Después del PDF');
  const paragraphs = await card.evaluate((root) => {
    const scale = root.getBoundingClientRect().width / root.clientWidth;
    return [...root.querySelectorAll('[data-testid*="block"]')].filter((node) => node.textContent === 'Antes del PDF' || node.textContent === 'Despu\u00e9s del PDF').map((node) => node.getBoundingClientRect().height / scale);
  });
  expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  expect(paragraphs.every((height) => height >= 16)).toBe(true);
  await card.getByRole('button', { name: /PDF.*Manual.*Abrir/ }).click();
  await expect(page.getByTestId('asset-pdf-preview-frame')).toBeVisible();
  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar PDF', exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(new Uint8Array(readFileSync((await pdfDownload.path())!))).toEqual(block8PdfBytes());
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-pdf.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await edit(page);
  const editor = page.getByTestId('web-rich-text-content');
  await editor.click(); await page.keyboard.press('Control+End');
  const insert = page.getByRole('button', { name: 'Insertar PDF', exact: true });
  if (!await insert.isVisible()) await page.getByRole('button', { name: 'Más herramientas de formato', exact: true }).click();
  await insert.click();
  const picker = page.getByTestId('note-pdf-picker');
  await picker.getByRole('button', { name: 'manual.pdf', exact: true }).click();
  await expect(editor.getByTestId('note-pdf-block')).toHaveCount(2);
  await editor.click(); await page.keyboard.press('Control+z');
  await expect(editor.getByTestId('note-pdf-block')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor.getByTestId('note-pdf-block')).toHaveCount(2);
  const pdfObject = editor.getByRole('group', { name: 'manual.pdf', exact: true });
  await pdfObject.focus(); await pdfObject.press('Enter');
  await expect(pdfObject.getByRole('textbox', { name: 'Nombre del PDF', exact: true })).toBeVisible();
  await pdfObject.getByRole('textbox', { name: 'Nombre del PDF', exact: true }).fill('Apunte PDF');
  await editor.getByRole('group', { name: 'Apunte PDF', exact: true }).scrollIntoViewIfNeeded();
  await editor.getByRole('button', { name: 'Quitar bloque PDF', exact: true }).click();
  await expect(editor.getByTestId('note-pdf-block')).toHaveCount(1);
  await editor.click(); await page.keyboard.press('Control+z');
  await expect(editor.getByTestId('note-pdf-block')).toHaveCount(2);
  await editor.getByRole('group', { name: 'Apunte PDF', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-editor.png`, fullPage: true });
  if (await page.getByTestId('inline-card-editor').isVisible()) await page.getByRole('button', { name: 'Guardar y cerrar la edición rápida', exact: true }).click();
  else await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const download = await downloadPromise;
  const zipPath = await download.path(); expect(zipPath).not.toBeNull();
  const archive = value(readWorkspaceArchive(new Uint8Array(readFileSync(zipPath!))));
  const saved = archive.workspace.cards.find((entry) => entry.id === 'idea-a')!;
  expect(saved.contentDocument?.blocks.filter((block) => block.type === 'pdf')).toHaveLength(2);
  expect(saved.contentDocument?.blocks.some((block) => block.type === 'pdf' && block.label === 'Apunte PDF')).toBe(true);
  expect(archive.assets[pdfRef]).toEqual(block8PdfBytes());
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'reopened.zip', mimeType: 'application/zip', buffer: Buffer.from(readFileSync(zipPath!)) });
  await expect(page.getByTestId('card-idea-a')).toContainText('Después del PDF');
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-reopened.png`, fullPage: true });
});

test('B8: visor original de imagen', async ({ page }, info) => {
  const theme = info.project.name === 'mobile' ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((choice) => localStorage.setItem('noutynotes.theme.v1', choice), theme);
  const { png } = await lab(page);
  const more = page.getByRole('button', { name: 'M\u00e1s secciones', exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Abrir los assets', exact: true }).click();
  const enlarge = page.getByRole('button', { name: 'Ampliar planificador.png', exact: true });
  await expect(enlarge).toBeVisible();
  await page.getByRole('button', { name: 'Ver planificador.png', exact: true }).click();
  await expect(page.getByTestId('image-viewer')).not.toBeVisible();
  await enlarge.click();
  await expect(page.getByTestId('image-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(enlarge).toBeFocused();
  const thumbnail = page.getByRole('button', { name: 'Ampliar vista previa de planificador.png', exact: true });
  await thumbnail.click();
  await expect(page.getByTestId('image-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(thumbnail).toBeFocused();
  await page.getByRole('button', { name: 'Abrir imagen', exact: true }).click();
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer).toBeVisible();
  const close = viewer.getByRole('button', { name: 'Cerrar planificador.png', exact: true });
  await expect(close).toBeFocused();
  const centered = async () => viewer.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: Math.abs(rect.x + rect.width / 2 - window.innerWidth / 2), y: Math.abs(rect.y + rect.height / 2 - window.innerHeight / 2) };
  });
  await expect.poll(async () => (await centered()).y).toBeLessThanOrEqual(2);
  await expect.poll(async () => (await centered()).x).toBeLessThanOrEqual(2);
  const image = viewer.locator('img');
  const region = viewer.getByRole('region');
  const fits = () => image.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return false;
    const rect = node.getBoundingClientRect(); const parent = node.parentElement!.getBoundingClientRect();
    return node.naturalWidth > 0 && rect.width > 0 && rect.width <= node.naturalWidth
      && Math.abs(rect.width / rect.height - node.naturalWidth / node.naturalHeight) < 0.01
      && rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && rect.top >= parent.top - 1 && rect.bottom <= parent.bottom + 1;
  });
  await expect.poll(fits).toBe(true);
  await page.screenshot({ path: `artifacts/block8-viewer-corrective-${info.project.name}-image.png`, fullPage: true });
  await page.keyboard.press('Shift+Tab');
  await expect(region).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await viewer.getByRole('button', { name: '100%', exact: true }).click();
  await expect.poll(() => image.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-image.png`, fullPage: true });
  const originalWidth = await image.evaluate((node) => node.getBoundingClientRect().width);
  await viewer.getByRole('region').focus();
  await page.keyboard.press('+');
  await expect.poll(() => image.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(originalWidth);
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('+');
  await expect.poll(() => region.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(20);
  const box = (await region.boundingBox())!;
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 50, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(20);
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll);
  await viewer.getByRole('button', { name: 'Ajustar', exact: true }).click();
  await expect.poll(fits).toBe(true);
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBe(0);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 844, height: 390 } : { width: 768, height: 600 });
  await expect.poll(fits).toBe(true);
  await expect.poll(async () => (await centered()).y).toBeLessThanOrEqual(2);
  await page.setViewportSize(originalViewport);
  await expect.poll(fits).toBe(true);
  await expect.poll(async () => (await centered()).y).toBeLessThanOrEqual(2);
  await region.focus();
  await page.keyboard.press('0');
  await expect.poll(() => image.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(originalWidth);
  await page.keyboard.press('Escape');
  await expect(viewer).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir imagen', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Abrir imagen', exact: true }).click();
  await close.click();
  await expect(viewer).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir imagen', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Volver al tablero', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const downloaded = await downloadPromise;
  const archive = value(readWorkspaceArchive(new Uint8Array(readFileSync((await downloaded.path())!))));
  expect(archive.assets[detachmentRef]).toEqual(png);
  expect(archive.assets[pdfRef]).toEqual(block8PdfBytes());
});

test('B8 correctivo: PDF de Nota y A4 con cabecera compacta y bytes íntegros', async ({ page }, info) => {
  const theme = info.project.name === 'desktop' ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((choice) => localStorage.setItem('noutynotes.theme.v1', choice), theme);
  await lab(page);
  for (const source of ['note', 'a4']) {
    if (source === 'note') await page.getByTestId('card-idea-a').getByRole('button', { name: /PDF.*Manual.*Abrir/ }).click();
    else {
      const card = page.getByTestId('card-pdf'); const box = (await card.boundingBox())!;
      // El centro de esta tarjeta pequeña al50% coincide con la cruz de arrastre B7; abrir desde el cuerpo libre.
      await card.dblclick({ position: { x: box.width * 0.8, y: box.height * 0.75 } });
    }
    const viewer = page.getByTestId('asset-pdf-preview');
    const frame = viewer.getByTestId('asset-pdf-preview-frame');
    await expect(frame).toBeVisible();
    const help = viewer.getByText(/Si no aparecen las páginas/);
    await expect(help).not.toBeVisible();
    const url = await frame.getAttribute('src');
    await expect(viewer.getByRole('link', { name: 'Abrir PDF en otra pestaña', exact: true })).toHaveAttribute('href', url!);
    await expect(viewer.getByRole('link', { name: 'Abrir PDF en otra pestaña', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
    const opened = page.waitForEvent('popup');
    await viewer.getByRole('link', { name: 'Abrir PDF en otra pestaña', exact: true }).click();
    const external = await opened;
    // Chromium headless puede convertir el PDF externo en descarga y dejar URL vacía.
    // El evento comprueba apertura real; href/target/rel y descarga exacta protegen el destino.
    await test.info().attach(`pdf-popup-${source}`, { body: JSON.stringify({ requested: url, observed: external.url(), closed: external.isClosed() }), contentType: 'application/json' });
    await external.close();
    const downloadPromise = page.waitForEvent('download');
    await viewer.getByRole('link', { name: 'Descargar PDF', exact: true }).click();
    const downloaded = await downloadPromise;
    expect(new Uint8Array(readFileSync((await downloaded.path())!))).toEqual(block8PdfBytes());
    await expect(viewer.locator('summary')).toHaveCount(0);
    const controls = viewer.getByTestId('asset-pdf-header');
    const links = controls.getByRole('link');
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      const bounds = (await link.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThanOrEqual(1);
      await expect(link).toHaveAttribute('title', /.+/);
    }
    const rows = await controls.locator('a, button').evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return r.y + r.height / 2; }));
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
    await expect(controls.getByRole('button', { name: /^Cerrar/ }).locator('..')).toHaveAttribute('title', 'Cerrar');
    await expect(controls.getByTestId('icon-external-link')).toBeVisible();
    await expect(controls.getByTestId('icon-download')).toBeVisible();
    await expect(frame).toHaveAttribute('src', url!);
    await page.screenshot({ path: `artifacts/block8-viewer-corrective-${info.project.name}-pdf-${source}.png`, fullPage: true });
    await viewer.getByRole('button', { name: /^Cerrar vista previa de/ }).click();
    await expect(viewer).not.toBeVisible();
  }
});

test('B8 final: PDF centra icono y título en la tarjeta completa a 50, 100 y 125%', async ({ page }, info) => {
  const theme = info.project.name === 'mobile' ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((choice) => localStorage.setItem('noutynotes.theme.v1', choice), theme);
  const card = page.getByTestId('card-pdf');
  const measurements: unknown[] = [];
  const measure = () => card.evaluate((node) => {
    const card = node.getBoundingClientRect();
    const icon = node.querySelector('[data-testid="document-icon-pdf"]')!.getBoundingClientRect();
    const title = node.querySelector('[data-testid="document-title-pdf"]')!.getBoundingClientRect();
    const group = { left: Math.min(icon.left, title.left), right: Math.max(icon.right, title.right), top: Math.min(icon.top, title.top), bottom: Math.max(icon.bottom, title.bottom) };
    return { dx: Math.abs(card.x + card.width / 2 - (group.left + group.right) / 2), dy: Math.abs(card.y + card.height / 2 - (group.top + group.bottom) / 2), card: { x: card.x, y: card.y, width: card.width, height: card.height }, group };
  });
  for (const size of [{ w: 8, h: 6 }, { w: 10, h: 8 }]) {
  await lab(page, { pdfCardSize: size, ...(size.w === 10 ? { pdfCard: 'long' as const } : {}) });
  await card.focus();
  for (const zoom of [1, 1.25, 0.5]) {
    const content = page.getByTestId('canvas-content');
    const current = await content.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a);
    await page.getByTestId('board-canvas').evaluate((node, deltaY) => {
      const r = node.getBoundingClientRect();
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: r.left + 20, clientY: r.top + 20 }));
    }, -1200 * Math.log(zoom / current));
    await expect.poll(() => content.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBeCloseTo(zoom, 3);
    await page.getByTestId('board-canvas').focus(); await card.focus();
    const measured = await measure(); measurements.push({ size, zoom, ...measured });
    // 2 CSS px absorben redondeo de borde/fuente escalados; referencia: tarjeta completa.
    await expect.poll(async () => (await measure()).dy).toBeLessThanOrEqual(2);
    expect(measured.dx).toBeLessThanOrEqual(2);
  }
  }
  await card.press('Enter');
  const beforeResize = await measure();
  const handle = (await page.getByTestId('resize-se-pdf').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await measure()).card.width).toBeGreaterThan(beforeResize.card.width);
  const resized = await measure();
  expect(resized.dx).toBeLessThanOrEqual(2); expect(resized.dy).toBeLessThanOrEqual(2);
  measurements.push({ afterResize: true, zoom: 0.5, ...resized });
  writeFileSync(`artifacts/block8-final-${info.project.name}-geometry.json`, JSON.stringify(measurements, null, 2));
  await test.info().attach('pdf-centering-dom', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: `artifacts/block8-final-${info.project.name}-card.png`, fullPage: true });
});

test('B8 final: PDF ausente, retirado y mínimo conserva contenido y acciones', async ({ page }, info) => {
  for (const state of ['missing', 'retired'] as const) {
    await lab(page, { pdfCard: state, pdfCardSize: { w: 8, h: 6 } });
    const card = page.getByTestId('card-pdf');
    await expect(card).toContainText('PDF');
    const content = state === 'retired' ? card.getByTestId('retired-card-pdf') : card.getByTestId('document-group-pdf');
    await expect(content).toBeVisible();
    const rect = (await card.boundingBox())!, body = (await content.boundingBox())!;
    expect(Math.abs(body.x + body.width / 2 - rect.x - rect.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(body.y + body.height / 2 - rect.y - rect.height / 2)).toBeLessThanOrEqual(2);
    if (state === 'missing') {
      await card.dblclick({ position: { x: rect.width * 0.8, y: rect.height * 0.75 } });
      await expect(page.getByTestId('asset-pdf-preview-error')).toBeVisible();
      await page.keyboard.press('Escape');
    } else await expect(card).toContainText('Recurso retirado');
  }
  await lab(page, { pdfCardSize: { w: 1, h: 1 } });
  await expect(page.getByTestId('compact-card-pdf')).toHaveText('PDF');
  await page.getByTestId('card-pdf').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('card-menu')).toBeVisible();
  await page.screenshot({ path: `artifacts/block8-final-${info.project.name}-pdf-small.png`, fullPage: true });
});

test('B8: fuente por Nota persiste y Visual/HTML conserva PDF y formato', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('noutynotes.theme.v1', 'dark'));
  await lab(page);
  const card = page.getByTestId('card-idea-a');
  await card.press('Shift+F10');
  await page.getByRole('button', { name: 'Abrir el Inspector de Documento extenso', exact: true }).click();
  await page.getByTestId('card-inspector-section-appearance').click();
  const font = page.getByRole('combobox', { name: 'Fuente del cuerpo', exact: true });
  await font.selectOption('serif');
  await expect(font).toHaveValue('serif');
  await page.getByTestId('card-inspector-section-content').click();
  await page.getByRole('button', { name: 'Editar el código HTML del cuerpo', exact: true }).click();
  await expect(page.getByTestId('html-source-input')).toHaveValue(/data-nouty-pdf-ref/);
  await page.getByRole('button', { name: 'Editar el cuerpo visualmente', exact: true }).click();
  await expect(page.getByTestId('web-rich-text-content')).toContainText('Después del PDF');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  await expect.poll(() => card.getByText('Antes del PDF', { exact: true }).evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/Georgia|serif/);
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-font-dark.png`, fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const download = await downloadPromise;
  const path = (await download.path())!;
  const archive = value(readWorkspaceArchive(new Uint8Array(readFileSync(path))));
  expect(archive.workspace.cards.find((entry) => entry.id === 'idea-a')?.noteFont).toEqual({ kind: 'builtin', family: 'serif' });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles(path);
  await expect.poll(() => page.getByTestId('card-idea-a').getByText('Antes del PDF', { exact: true }).evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/Georgia|serif/);
});

test('B8: fuente ausente conserva referencia y Nota larga alcanza principio/final', async ({ page }, info) => {
  await lab(page, { font: 'missing', long: true });
  const card = page.getByTestId('card-idea-a');
  await card.press('Shift+F10');
  await page.getByRole('button', { name: 'Abrir el Inspector de Documento extenso', exact: true }).click();
  await page.getByTestId('card-inspector-section-appearance').click();
  await expect(page.getByTestId('note-font-picker')).toContainText('Fuente no disponible: se usa Sistema.');
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-font-fallback.png`, fullPage: true });
  await page.getByRole('combobox', { name: 'Fuente del cuerpo', exact: true }).selectOption('mono');
  await expect(page.getByRole('combobox', { name: 'Fuente del cuerpo', exact: true })).toHaveValue('mono');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  const reader = page.getByTestId('card-reader-idea-a');
  await reader.press('End');
  await expect(reader.getByText(/Párrafo B8 80:/)).toBeVisible();
  await reader.press('Home');
  await expect(reader.getByText('Antes del PDF', { exact: true })).toBeVisible();
});

test('B8: fuente de Asset válida carga bytes locales sin red ni confusión de identidad', async ({ page }, info) => {
  await lab(page, { font: 'real' });
  const card = page.getByTestId('card-idea-a');
  const first = card.getByText('Antes del PDF', { exact: true });
  await expect.poll(() => first.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/noty-session-/);
  const family = await first.evaluate((node) => getComputedStyle(node).fontFamily);
  expect(await page.evaluate((name) => document.fonts.check(`16px ${name}`), family)).toBe(true);
  await page.screenshot({ path: `artifacts/block8-${info.project.name}-font-asset.png`, fullPage: true });
});

for (const pdf of ['missing', 'broken'] as const) {
  test(`B8: PDF ${pdf} informa el problema sin perder los párrafos`, async ({ page }) => {
    await lab(page, { pdf });
    const card = page.getByTestId('card-idea-a');
    await expect(card).toContainText('Antes del PDF');
    if (pdf === 'missing') await expect(card.getByTestId('note-pdf-block')).toContainText('Recurso no disponible');
    await card.getByRole('button', { name: /PDF.*Manual.*Abrir/ }).click();
    await expect(page.getByTestId('asset-pdf-preview-error')).toBeVisible();
    if (pdf === 'broken') await expect(page.getByTestId('asset-pdf-preview-error')).toContainText('PDF válido');
    await expect(page.getByTestId('asset-pdf-preview-frame')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(card).toContainText('Después del PDF');
  });
}

test('B8: redimensionar escritorio/tablet/móvil conserva descriptor sin overflow de página', async ({ page }) => {
  await lab(page);
  for (const width of [1366, 768, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('card-idea-a')).toContainText('Antes del PDF');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});
