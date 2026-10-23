import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { openFullCardEditor } from './support';

const folderMock = readFileSync(new URL('./folder.spec.ts', import.meta.url), 'utf8').split('const fakeFolder = `')[1]?.split('`;')[0];
if (!folderMock) throw new Error('Falta el mock de carpeta existente');
const key = 'nouty-test-folder';
const path = 'n3-reading/cards/nota.md';
test.setTimeout(45_000);
const body = [
  '<figure><img alt="Leyenda histórica" src="assets/images/shared.png"></figure>',
  '<figure data-nouty-image-caption-policy="explicit" data-nouty-image-accessibility-intent="informative"><img alt="Descripción vigente sin leyenda" src="assets/images/shared.png"></figure>',
  '<figure data-nouty-image-caption-policy="explicit" data-nouty-image-accessibility-intent="pending"><img alt="Descripción obsoleta" src="assets/images/shared.png"><figcaption>Leyenda conservada pendiente</figcaption></figure>',
].join('\n');
async function connect(page: Page) {
  await page.getByRole('button', { name: /^Abrir (otro )?proyecto$/ }).click();
  await page.getByRole('button', { name: 'Abrir el proyecto N3 lectura', exact: true }).click();
  await expect(page.getByTestId('card-nota')).toBeVisible();
}
async function seed(page: Page, layout: 'banner' | 'document' = 'document', source = body) {
  await page.addInitScript({ content: folderMock! });
  await page.goto('./');
  const original = await page.evaluate(({ key, path, body, layout }) => {
    const files: Record<string, string> = {
      'n3-reading/.nouty/workspace.yaml': 'schemaVersion: 1\nid: n3-reading\nmetadata:\n  name: N3 lectura\ncardTypes:\n  - id: nota\n    label: Nota\n    base: note\n    fields: []\nrelationTypes: []\ncards: [nota]\nboards: [principal]\n',
      'n3-reading/.nouty/relations.yaml': 'schemaVersion: 1\nrelations: []\n',
      'n3-reading/.nouty/layout.yaml': 'schemaVersion: 1\nlayouts:\n  - boardId: principal\n    placements:\n      - cardId: nota\n        display: expanded\n        rect: { x: 0, y: 0, w: 6, h: 12 }\n',
      'n3-reading/boards/principal.md': '---\nschemaVersion: 1\nid: principal\ntitle: Principal\ncardIds: [nota]\ndescriptionPresent: false\n---\n',
      [path]: `---\nschemaVersion: 14\nid: nota\ntypeId: nota\ntitle: Lectura mixta\ntitleVisibility: hidden\ncontentLayout: ${layout}\nimageFit: contain\nfields: {}\nassetRefs: [assets/images/shared.png]\ncontentPresent: true\ncontentFormat: html\ncontentVersion: 2\n---\n${body}`,
    };
    const store = Object.fromEntries(Object.entries(files).map(([name, source]) => [name, Array.from(new TextEncoder().encode(source))]));
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#bd451c'; ctx.fillRect(0, 0, 80, 160);
    store['n3-reading/assets/images/shared.png'] = Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (char) => char.charCodeAt(0));
    localStorage.setItem(key, JSON.stringify(store));
    return store[path];
  }, { key, path, body: source, layout });
  await connect(page);
  return original;
}

async function checkMixed(reading: Locator) {
  await expect(reading).toContainText('Leyenda histórica');
  await expect(reading).not.toContainText('Descripción vigente sin leyenda');
  await expect(reading).toContainText('Leyenda conservada pendiente');
  await expect(reading.getByRole('img', { name: 'Descripción obsoleta', exact: true })).toHaveCount(0);
  await expect(reading.getByRole('img', { name: 'Descripción vigente sin leyenda', exact: true }).first()).toHaveAccessibleName('Descripción vigente sin leyenda');
  await expect(reading).not.toContainText('nouty-caption:v1');
}
async function resize(page: Page, direction: 'Up' | 'Down', steps: number) {
  const card = page.getByTestId('card-nota');
  await card.click({ position: { x: 10, y: 10 } });
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await card.focus();
  for (let i = 0; i < steps; i += 1) {
    const before = (await card.boundingBox())!.height;
    await card.press(`Shift+Arrow${direction}`);
    await expect.poll(async () => (await card.boundingBox())!.height).not.toBe(before);
  }
}
async function accessibleEvidence(reading: Locator, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.yml`);
  writeFileSync(file, await reading.ariaSnapshot());
  await info.attach(name, { path: file, contentType: 'text/plain' });
}

test('N3 lectura mixta: Documento, lector, Lista, copia y carpeta reabierta', async ({ page }, info) => {
  const before = await seed(page);
  const preview = page.getByTestId('rich-note-preview-nota');
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(3);
  await checkMixed(preview);
  for (const [index, image] of (await preview.locator('img').all()).entries()) {
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const geometry = await preview.getByTestId(`rich-note-preview-nota-image-${index}`).evaluate((element) => {
      const node = element as HTMLElement; const rect = node.getBoundingClientRect();
      return { height: rect.height, scale: rect.width / node.offsetWidth };
    });
    expect(geometry.height / geometry.scale).toBeCloseTo(88, 0);
  }
  await expect(preview).toBeVisible();
  expect(await page.evaluate(({ key, path }) => JSON.parse(localStorage.getItem(key)!)[path], { key, path })).toEqual(before);
  await accessibleEvidence(preview, info, 'lectura-accesible');
  await page.screenshot({ path: info.outputPath('canvas-mixto.png'), fullPage: true });
  await resize(page, 'Up', 6);
  const reader = page.getByTestId('card-reader-nota');
  await expect(reader).toBeVisible();
  await checkMixed(reader);
  await reader.focus();
  await reader.press('End');
  await expect.poll(() => reader.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
  // End's existing settleAtEnd(3) schedules four frames. Home after completion is the
  // contract here; the independent immediate End→Home race is recorded, not fixed by N3.
  await reader.evaluate(() => new Promise<void>((resolve) => {
    const settled = (frames: number) => requestAnimationFrame(() => frames > 1 ? settled(frames - 1) : resolve());
    settled(4);
  }));
  await reader.press('Home');
  await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBe(0);
  await accessibleEvidence(reader, info, 'lector-accesible');
  await page.screenshot({ path: info.outputPath('lector-mixto.png'), fullPage: true });
  await resize(page, 'Down', 6);
  await checkMixed(preview);
  await page.getByTestId('card-nota').press('Shift+F10');
  await page.getByRole('button', { name: 'Duplicar la Nota Lectura mixta', exact: true }).click();
  await page.getByRole('button', { name: 'Vista de lista', exact: true }).click();
  await checkMixed(page.getByTestId('list-rich-note-preview-nota'));
  await checkMixed(page.getByTestId('list-rich-note-preview-tarjeta-1'));
  await page.screenshot({ path: info.outputPath('lista-copia.png'), fullPage: true });
  const files = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as Record<string, number[]>, key);
  const asset = files['n3-reading/assets/images/shared.png'];
  expect(Object.keys(files).filter((name) => name.includes('/assets/'))).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await connect(page);
  // El modo de vista puede volver a Canvas; se comprueban los datos y las dos Notas reabiertas.
  await checkMixed(page.getByTestId('card-nota'));
  await checkMixed(page.getByTestId('card-tarjeta-1'));
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!)['n3-reading/assets/images/shared.png'], key)).toEqual(asset);
  await page.screenshot({ path: info.outputPath('reabierto.png'), fullPage: true });
  // Reemplazo real por N2: la copia conserva su descripción, la referencia reemplazada queda pending.
  await openFullCardEditor(page, page.getByTestId('card-nota'));
  const editorImage = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]').nth(1);
  await editorImage.getByTestId('image-media').click();
  await editorImage.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await editorImage.getByRole('button', { name: 'Reemplazar la imagen Descripción vigente sin leyenda', exact: true }).click();
  await (await chooser).setFiles({ name: 'reemplazo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await expect(editorImage.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('pending');
  await expect(editorImage.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción vigente sin leyenda');
  await page.getByRole('button', { name: 'Guardar texto', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expect(page.getByTestId('card-nota').getByRole('img', { name: 'Descripción vigente sin leyenda', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('card-tarjeta-1').getByRole('img', { name: 'Descripción vigente sin leyenda', exact: true }).first()).toHaveAccessibleName('Descripción vigente sin leyenda');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!)['n3-reading/assets/images/shared.png'], key)).toEqual(asset);
  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await connect(page);
  await expect(page.getByTestId('card-nota').getByRole('img', { name: 'Descripción vigente sin leyenda', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('card-tarjeta-1').getByRole('img', { name: 'Descripción vigente sin leyenda', exact: true }).first()).toHaveAccessibleName('Descripción vigente sin leyenda');
  await page.screenshot({ path: info.outputPath('reemplazo-pendiente-reabierto.png'), fullPage: true });
});

test('N3 Banner: decorativa visible, informative incompleta y leyenda rica independiente', async ({ page }, info) => {
  const source = [
    '<figure data-nouty-image-caption-policy="explicit" data-nouty-image-accessibility-intent="decorative"><img alt="Alt decorativo almacenado" src="assets/images/shared.png"><figcaption>Pie decorativo visible</figcaption></figure>',
    '<figure data-nouty-image-caption-policy="explicit" data-nouty-image-accessibility-intent="informative"><img alt="Descripción activa" src="assets/images/shared.png"><figcaption><strong>Leyenda escrita</strong></figcaption></figure>',
    '<figure data-nouty-image-caption-policy="explicit" data-nouty-image-accessibility-intent="informative"><img alt="" src="assets/images/shared.png"></figure>',
  ].join('\n');
  await seed(page, 'banner', source);
  const preview = page.getByTestId('rich-note-preview-nota');
  await expect(preview.locator('img')).toHaveCount(3);
  await expect(preview).toContainText('Pie decorativo visible');
  await expect(preview).toContainText('Leyenda escrita');
  await expect(preview).not.toContainText('Descripción activa');
  await expect(preview.getByRole('img', { name: 'Alt decorativo almacenado', exact: true })).toHaveCount(0);
  await expect(preview.getByRole('img', { name: 'Descripción activa', exact: true }).first()).toHaveAccessibleName('Descripción activa');
  await expect(preview.locator('img').first()).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    const height = await preview.getByTestId(`rich-note-preview-nota-image-${index}`).evaluate((element) => {
      const node = element as HTMLElement; const rect = node.getBoundingClientRect();
      return rect.height / (rect.width / node.offsetWidth);
    });
    expect(height).toBeGreaterThanOrEqual(88);
  }
  const bounds = (await preview.boundingBox())!;
  const last = (await preview.locator('img').last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  await accessibleEvidence(preview, info, 'banner-accesible');
  await page.screenshot({ path: info.outputPath('banner-intenciones.png'), fullPage: true });
  await resize(page, 'Up', 6);
  const reader = page.getByTestId('card-reader-nota');
  await expect(reader).toBeVisible();
  await expect(reader.getByRole('img', { name: 'Alt decorativo almacenado', exact: true })).toHaveCount(0);
  await expect(reader.getByRole('img', { name: 'Descripción activa', exact: true })).toHaveAccessibleName('Descripción activa');
  await expect(reader.locator('img').last()).toHaveAttribute('alt', '');
  await expect(reader.locator('img').last()).toHaveAttribute('role', 'img');
  await expect(reader.locator('figcaption').last()).toHaveText('Leyenda escrita');
  await expect(reader.getByRole('img', { name: 'Leyenda escrita', exact: true })).toHaveCount(0);
  await accessibleEvidence(reader, info, 'lector-intenciones');
});
