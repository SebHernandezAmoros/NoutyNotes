import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { insertFromMenu, openCardActions, openFullCardEditor, openSettings, seedBodyHtml } from './support';

test.setTimeout(60_000);
const png = { name: 'nombre-original-no-es-descripcion.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, n: number) => page.getByTestId(`card-tarjeta-${n}`);
const image = (page: Page) => page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
const purpose = (block: Locator) => block.getByLabel('Propósito de la imagen', { exact: true });
async function create(page: Page) {
  await page.goto('./');
  await button(page, 'Nuevo proyecto').click();
  await page.getByLabel('Nombre del proyecto').fill('Políticas editoriales');
  await button(page, 'Crear proyecto').click();
  if ((page.viewportSize()?.width ?? 0) >= 800) {
    await openSettings(page);
    await button(page, 'Usar el tema oscuro').click();
    await button(page, 'Cerrar configuración').click();
  }
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, card(page, 1));
}
async function upload(page: Page, replace = false) {
  const chooser = page.waitForEvent('filechooser');
  if (replace) await image(page).getByRole('button', { name: /^Reemplazar la imagen/ }).click();
  else await button(page, 'Insertar una imagen').click();
  await (await chooser).setFiles(png);
}
async function options(page: Page) {
  const block = image(page);
  await block.getByTestId('image-media').click();
  await block.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  return block;
}
async function close(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}

test('N2 controles: Assets, propósito, textos independientes, teclado y reapertura', async ({ page }, testInfo) => {
  await create(page);
  await upload(page);
  const originalRef = (await image(page).getAttribute('data-testid'))!.replace('rich-image-', '');
  await close(page);
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, card(page, 2));
  await button(page, 'Insertar desde Assets').click();
  await page.getByTestId(`asset-image-picker-item-${originalRef.split('/').pop()}`).click();
  let block = await options(page);
  await expect(purpose(block)).toHaveValue('pending', { timeout: 5000 });
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('');
  await expect(block).not.toContainText(originalRef.split('/').pop()!);
  await purpose(block).focus();
  await purpose(block).press('Home');
  await purpose(block).press('Enter');
  await expect(purpose(block)).toHaveValue('informative');
  await expect(block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true })).toBeDisabled();
  await block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).press('Space');
  await block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).press('Enter');
  await expect(block.getByTestId('image-review-status')).toContainText('Falta una descripción');
  await button(page, 'Deshacer en el editor').click();
  await expect(block.getByTestId('image-review-status')).toContainText('Pendiente de revisión');
  await button(page, 'Rehacer en el editor').click();
  await expect(block.getByTestId('image-review-status')).toContainText('Falta una descripción');
  await close(page);
  await openFullCardEditor(page, card(page, 2));
  block = await options(page);
  await expect(purpose(block)).toHaveValue('informative');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('');
  await block.getByLabel(/^Texto alternativo/).fill('Descripción local');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('');
  await block.getByLabel(/^Leyenda/).fill('Leyenda local');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción local');
  await purpose(block).selectOption('decorative');
  await block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).check();
  await block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).press('Enter');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción local');
  await purpose(block).selectOption('pending');
  await block.getByRole('button', { name: 'Dejar pendiente', exact: true }).press('Enter');
  await close(page);
  await openFullCardEditor(page, card(page, 2));
  block = await options(page);
  await expect(purpose(block)).toHaveValue('pending');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción local');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('Leyenda local');
  await purpose(block).scrollIntoViewIfNeeded();
  const controlFits = await purpose(block).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const editor = node.closest('[data-testid="web-rich-text-content"]')?.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth && (!editor || (rect.left >= editor.left && rect.right <= editor.right));
  });
  expect(controlFits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('n2-controles.png'), fullPage: true });
  await close(page);
  await openFullCardEditor(page, card(page, 1));
  block = await options(page);
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('');
  await expect(purpose(block)).toHaveValue('pending');
  if (testInfo.project.name === 'desktop') {
    await close(page);
    await openCardActions(page, card(page, 1), 'Nueva nota');
    await button(page, 'Editar Nueva nota dentro de la ficha').click();
    const quick = page.getByTestId('inline-card-editor').locator('[data-testid^="rich-image-"]');
    await quick.getByTestId('image-media').click();
    await quick.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
    await purpose(quick).selectOption('decorative');
    await quick.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).check();
    await quick.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).press('Enter');
    await openFullCardEditor(page, card(page, 1));
    block = await options(page);
    await expect(purpose(block)).toHaveValue('decorative');
    await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('');
  }
});

test('N2 histórica y reemplazo: revisión conjunta, cancelación y conservación de textos', async ({ page }, testInfo) => {
  await create(page);
  await upload(page);
  const ref = (await image(page).getAttribute('data-testid'))!.replace('rich-image-', '');
  await seedBodyHtml(page, `<figure><img alt="Anterior" src="${ref}"><figcaption><em>Leyenda anterior</em></figcaption></figure>`);
  let block = await options(page);
  await expect(purpose(block)).toHaveValue('legacy');
  await block.getByLabel(/^Texto alternativo/).fill('Descripción histórica editada');
  await close(page);
  await openFullCardEditor(page, card(page, 1));
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(page.getByTestId('html-source-input')).not.toHaveValue(/image-caption-policy|image-accessibility-intent/);
  await button(page, 'Editar el cuerpo visualmente').click();
  block = await options(page);
  const cancel = page.waitForEvent('filechooser');
  await block.getByRole('button', { name: /^Reemplazar la imagen/ }).click();
  await (await cancel).setFiles([]);
  await expect(block).toHaveAttribute('data-testid', `rich-image-${ref}`);
  await upload(page, true);
  block = image(page);
  await expect(block).not.toHaveAttribute('data-testid', `rich-image-${ref}`);
  const replacedRef = await block.getAttribute('data-testid');
  await button(page, 'Deshacer en el editor').click();
  await expect(block).toHaveAttribute('data-testid', `rich-image-${ref}`);
  await button(page, 'Rehacer en el editor').click();
  await expect(block).toHaveAttribute('data-testid', replacedRef!);
  if (!await block.getByTestId('image-advanced-options').isVisible()) {
    await block.getByTestId('image-media').click();
    await block.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  }
  await expect(purpose(block)).toHaveValue('pending');
  await expect(block.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción histórica editada');
  await expect(block.getByLabel(/^Leyenda/)).toHaveValue('Leyenda anterior');
  await purpose(block).selectOption('informative');
  await expect(block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true })).toBeDisabled();
  await block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).check();
  await block.getByLabel(/^Texto alternativo/).fill('Descripción revisada');
  await expect(purpose(block)).toHaveValue('informative');
  await expect(block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true })).not.toBeChecked();
  await expect(block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true })).toBeDisabled();
  await block.getByLabel('He revisado el propósito, la descripción y la leyenda', { exact: true }).check();
  await block.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).press('Enter');
  await block.getByRole('button', { name: 'Usar solo leyenda explícita', exact: true }).press('Enter');
  await close(page);
  await openFullCardEditor(page, card(page, 1));
  block = await options(page);
  await expect(purpose(block)).toHaveValue('informative');
  await expect(block.getByText('Leyenda: solo el texto explícito', { exact: true })).toBeVisible();
  await purpose(block).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('n2-reemplazo-reabierto.png'), fullPage: true });
});
