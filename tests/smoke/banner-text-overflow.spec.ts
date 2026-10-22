import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { openFullCardEditor } from './support';

// Reuse the established folder mock without importing a spec (which would register its tests).
const folderSource = readFileSync(new URL('./folder.spec.ts', import.meta.url), 'utf8');
const folderMock = folderSource.split('const fakeFolder = `')[1]?.split('`;')[0];
if (!folderMock) throw new Error('No se encontró el mock de carpeta existente.');
const folderKey = 'nouty-test-folder';
const cardPath = 'g1-preview/cards/nota.md';
const before = 'ANTES: texto guardado antes de la imagen.';
const after = 'DESPUÉS: texto guardado después de la imagen.';
// Canonical HTML separators avoid mistaking the existing serializer for a content change.
const body = (short: boolean) => `<p>${short ? 'ANTES.' : before}</p>\n<figure><img alt="Imagen vertical de prueba" src="assets/images/vertical.png"></figure>\n<p>${short ? 'DESPUÉS.' : after}</p>`;

async function connect(page: Page) {
  await page.getByRole('button', { name: /^Abrir (otro )?proyecto$/ }).click();
  await page.getByRole('button', { name: 'Abrir el proyecto G1 preview', exact: true }).click();
  await page.getByTestId('card-nota').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="rich-note-preview-nota-overflow-action"]')
    || Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="card-nota"] img')).some((image) => image.complete && image.naturalWidth > 0));
}

async function seed(page: Page, layout: 'banner' | 'document', short = false, height = 6, extra = '', customBody?: string) {
  await page.addInitScript({ content: folderMock! });
  await page.goto('./');
  await page.evaluate(({ layout, html, height, folderKey, cardPath }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#df7136'; ctx.fillRect(0, 0, 100, 800);
    ctx.fillStyle = '#f7d246'; ctx.fillRect(10, 10, 80, 80); ctx.fillRect(10, 710, 80, 80);
    const files: Record<string, string> = {
      'g1-preview/.nouty/workspace.yaml': 'schemaVersion: 1\nid: g1-preview\nmetadata:\n  name: G1 preview\ncardTypes:\n  - id: nota\n    label: Nota\n    base: note\n    fields: []\nrelationTypes: []\ncards: [nota]\nboards: [principal]\n',
      'g1-preview/.nouty/relations.yaml': 'schemaVersion: 1\nrelations: []\n',
      'g1-preview/.nouty/layout.yaml': `schemaVersion: 1\nlayouts:\n  - boardId: principal\n    placements:\n      - cardId: nota\n        display: expanded\n        rect: { x: 0, y: 0, w: 4, h: ${height} }\n`,
      'g1-preview/boards/principal.md': '---\nschemaVersion: 1\nid: principal\ntitle: Principal\ncardIds: [nota]\ndescriptionPresent: false\n---\n',
      [cardPath]: `---\nschemaVersion: 14\nid: nota\ntypeId: nota\ntitle: Nota G1\ntitleVisibility: hidden\ncontentLayout: ${layout}\nimageFit: contain\nfields: {}\nassetRefs: [assets/images/vertical.png]\ncontentPresent: true\ncontentFormat: html\ncontentVersion: 1\n---\n${html}`,
    };
    const store = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Array.from(new TextEncoder().encode(text))]));
    store['g1-preview/assets/images/vertical.png'] = Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (char) => char.charCodeAt(0));
    localStorage.setItem(folderKey, JSON.stringify(store));
  }, { layout, html: customBody ?? body(short) + extra, height, folderKey, cardPath });
  await connect(page);
}

async function assertReadable(preview: Locator) {
  const blocks = preview.locator(':scope > [data-testid*="-block-"]');
  await expect(blocks).toHaveCount(2);
  await expect.poll(() => blocks.evaluateAll((nodes) => nodes.every((node) => {
    const text = node.querySelector<HTMLElement>('[dir="auto"]')!;
    const line = Number.parseFloat(getComputedStyle(text).lineHeight);
    const rect = node.getBoundingClientRect();
    const parent = node.parentElement!.getBoundingClientRect();
    return rect.height >= line && node.clientHeight >= node.scrollHeight - 1
      && rect.top >= parent.top - 1 && rect.bottom <= parent.bottom + 1;
  }))).toBe(true);
}

for (const short of [true, false]) {
  test(`G1-TEXT-OVERFLOW: párrafos ${short ? 'cortos' : 'envueltos'} legibles al redimensionar y reabrir`, async ({ page }, info) => {
    await seed(page, 'banner', short, short ? 6 : 10);
    const card = page.getByTestId('card-nota');
    const preview = page.getByTestId('rich-note-preview-nota');
    await card.screenshot({ path: `artifacts/g1-text-fix-${short ? 'short' : 'wrapped'}-initial-${info.project.name}.png` });
    await assertReadable(preview);
    await info.attach('geometria-banner', { contentType: 'application/json', body: JSON.stringify(await preview.evaluate((element) => ({
      height: element.clientHeight,
      blocks: Array.from(element.children).map((block) => ({ id: (block as HTMLElement).dataset.testid, height: block.getBoundingClientRect().height, clientHeight: block.clientHeight, scrollHeight: block.scrollHeight })),
    }))) });
    const image = preview.getByTestId('rich-note-preview-nota-image-1');
    const original = (await image.boundingBox())!.height;
    await card.click();
    await card.press('Shift+ArrowDown');
    await expect.poll(async () => (await image.boundingBox())!.height).toBeGreaterThan(original);
    await assertReadable(preview);
    await card.press('Shift+ArrowUp');
    await assertReadable(preview);

    await openFullCardEditor(page, card);
    await page.getByLabel(/^(Nombre de la Nota|Note name)$/).fill('Nota guardada G1');
    await expect.poll(() => page.evaluate(({ folderKey, cardPath }) => new TextDecoder().decode(new Uint8Array(JSON.parse(localStorage.getItem(folderKey)!)[cardPath])), { folderKey, cardPath })).toContain('Nota guardada G1');
    const persisted = await page.evaluate(({ folderKey, cardPath }) => new TextDecoder().decode(new Uint8Array(JSON.parse(localStorage.getItem(folderKey)!)[cardPath])), { folderKey, cardPath });
    expect(persisted.split('\n---\n')[1]).toBe(body(short));
    await page.reload();
    await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
    await connect(page);
    await assertReadable(page.getByTestId('rich-note-preview-nota'));
    await page.getByTestId('card-nota').screenshot({ path: `artifacts/g1-text-fix-${short ? 'short' : 'wrapped'}-reopened-${info.project.name}.png` });
  });
}

test('G1-TEXT-OVERFLOW: Documento conserva miniatura y el lector permite alcanzar el final', async ({ page }) => {
  await seed(page, 'document', false, 10);
  const preview = page.getByTestId('rich-note-preview-nota');
  await assertReadable(preview);
  const image = preview.getByTestId('rich-note-preview-nota-image-1');
  await expect.poll(async () => (await image.boundingBox())!.height).toBe(88);
  await page.getByTestId('card-nota').click();
  await page.getByTestId('card-nota').press('Shift+ArrowDown');
  await expect.poll(async () => (await image.boundingBox())!.height).toBe(88);
  await assertReadable(preview);
  // A fresh isolated page changes only fixture geometry; the reader itself is unmodified.
  const readerPage = await page.context().newPage();
  await seed(readerPage, 'banner', false, 3);
  const reader = readerPage.getByTestId('card-reader-nota');
  await reader.focus(); await reader.press('End');
  await expect.poll(() => reader.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
  const last = readerPage.getByTestId('card-reader-nota-block-2');
  const rect = (await last.boundingBox())!; const area = (await reader.boundingBox())!;
  expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height + 1);
  await readerPage.close();
});

test('G1-TEXT-OVERFLOW: Lista anuncia el contenido omitido y abre el documento completo', async ({ page }, info) => {
  const nestingErrors: string[] = [];
  page.on('console', (message) => { if (/cannot contain a nested|cannot be a descendant/.test(message.text())) nestingErrors.push(message.text()); });
  await seed(page, 'banner', false, 3, '<p>FINAL COMPLETO ' + 'texto adicional '.repeat(40) + '</p>');
  await page.getByRole('button', { name: 'Vista de lista', exact: true }).click();
  const preview = page.getByTestId('list-rich-note-preview-nota');
  const action = preview.getByRole('link', { name: /Ver documento completo/ });
  await expect(action).toBeVisible();
  const rect = (await action.boundingBox())!; const area = (await preview.boundingBox())!;
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height + 1);
  await page.getByTestId('card-nota').screenshot({ path: `artifacts/g1-text-fix-overflow-preview-${info.project.name}.png` });
  await action.focus(); await action.press('Enter');
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(page.getByTestId('web-rich-text-content')).toContainText('FINAL COMPLETO');
  expect(nestingErrors).toEqual([]);
  await page.screenshot({ path: `artifacts/g1-text-fix-overflow-${info.project.name}.png` });
});

test('G1-TEXT-OVERFLOW: el aviso del Canvas recibe el puntero sin arrastrar la Nota', async ({ page }) => {
  const height = (page.viewportSize()?.width ?? 0) < 800 ? 6 : 5;
  await seed(page, 'banner', true, height, '', body(true).replaceAll('<p>', '<h1>').replaceAll('</p>', '</h1>'));
  const preview = page.getByTestId('rich-note-preview-nota');
  const action = preview.getByRole('link', { name: 'Ver documento completo', exact: true });
  await expect(action).toBeVisible();
  const beforeFiles = await page.evaluate(({ folderKey, cardPath }) => JSON.parse(localStorage.getItem(folderKey)!)[cardPath], { folderKey, cardPath });
  await action.click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(page.getByTestId('web-rich-text-content')).toContainText('DESPUÉS.');
  expect(await page.evaluate(({ folderKey, cardPath }) => JSON.parse(localStorage.getItem(folderKey)!)[cardPath], { folderKey, cardPath })).toEqual(beforeFiles);
});
