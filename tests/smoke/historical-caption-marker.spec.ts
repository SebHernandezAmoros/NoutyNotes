import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFullCardEditor } from './support';

test.setTimeout(40_000);
test.use({ actionTimeout: 5000 });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, n = 1) => page.getByTestId(`card-tarjeta-${n}`);
async function importZip(page: Page, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await chooser).setFiles({ name: 'caption-historica.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(card(page)).toBeVisible();
}

test('HISTORICAL-CAPTION: Canvas, tamaño, Lista, copia, edición y reapertura sin exponer metadatos', async ({ page }, info) => {
  await page.goto('./');
  await importZip(page, readFileSync('tests/smoke/fixtures/historical-caption-marker.zip'));
  // Carga inicial, antes de interacciones: el parser de preview no produce un párrafo técnico.
  await expect(card(page)).not.toContainText('nouty-caption:v1');
  await expect(page.getByTestId('note-preview-tarjeta-1')).toContainText('image-2');
  await expect(page.getByTestId('card-reader-tarjeta-1')).toHaveCount(0);
  await expect(page.getByTestId('note-preview-tarjeta-1-image-0')).toBeVisible();
  await page.screenshot({ path: info.outputPath('canvas-inicial.png'), fullPage: true });

  // Alternativa accesible existente: selecciona desde la cabecera, reduce y amplía de nuevo.
  await card(page).click({ position: { x: 10, y: 10 } });
  await expect(card(page)).toHaveAttribute('aria-pressed', 'true');
  const originalHeight = (await card(page).boundingBox())!.height;
  for (let i = 0; i < 6; i += 1) {
    const before = (await card(page).boundingBox())!.height;
    await card(page).press('Shift+ArrowUp');
    await expect.poll(async () => (await card(page).boundingBox())!.height).toBeLessThan(before);
  }
  await expect(page.getByTestId('card-reader-tarjeta-1')).toHaveCount(1);
  await expect(card(page)).not.toContainText('nouty-caption:v1');
  for (let i = 0; i < 6; i += 1) {
    const before = (await card(page).boundingBox())!.height;
    await card(page).press('Shift+ArrowDown');
    await expect.poll(async () => (await card(page).boundingBox())!.height).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await card(page).boundingBox())!.height).toBeCloseTo(originalHeight, 0);
  await expect(page.getByTestId('card-reader-tarjeta-1')).toHaveCount(0);
  await expect(card(page)).not.toContainText('nouty-caption:v1');

  await openFullCardEditor(page, card(page));
  const image = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await image.getByTestId('image-media').click();
  await image.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  await expect(image.getByLabel(/^Leyenda/)).toHaveValue('Leyenda histórica exacta');
  await expect(image.getByLabel(/^Leyenda/)).toBeEditable();
  await expect(image.getByLabel(/^Texto alternativo/)).toHaveValue('image-2');
  await expect(image.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('legacy');
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);

  await card(page).press('Shift+F10');
  await expect(page.getByTestId('card-menu')).toBeVisible();
  await button(page, 'Duplicar la Nota Nueva nota').click();
  await button(page, 'Vista de lista').click();
  for (const n of [1, 2]) {
    await expect(card(page, n)).not.toContainText('nouty-caption:v1');
    await expect(card(page, n)).toContainText('image-2');
  }
  await page.screenshot({ path: info.outputPath('lista-copia.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const saved = await download;
  const exportedPath = info.outputPath('persistencia.zip');
  await saved.saveAs(exportedPath);
  await button(page, `Confirmar que guardé ${saved.suggestedFilename()}`).click();
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await importZip(page, readFileSync(exportedPath));
  await expect(card(page)).not.toContainText('nouty-caption:v1');
  await expect(card(page, 2)).not.toContainText('nouty-caption:v1');
  await page.screenshot({ path: info.outputPath('reabierto.png'), fullPage: true });
});
