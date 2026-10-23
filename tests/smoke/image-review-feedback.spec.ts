import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { insertFromMenu, openCardActions, openFullCardEditor, openSettings } from './support';

test.setTimeout(45_000);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const checkedName = 'He revisado el propósito, la descripción y la leyenda';
async function visibleFeedback(feedback: Locator) {
  await expect(feedback).toBeInViewport({ ratio: 0.9 });
  expect(await feedback.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const front = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return front === node || (front !== null && node.contains(front));
  })).toBe(true);
}
async function create(page: Page) {
  await page.goto('./');
  await button(page, 'Nuevo proyecto').click();
  await page.getByLabel('Nombre del proyecto').fill('Feedback de revisión');
  await button(page, 'Crear proyecto').click();
  if ((page.viewportSize()?.width ?? 0) >= 800) {
    await openSettings(page);
    await button(page, 'Usar el tema oscuro').click();
    await button(page, 'Cerrar configuración').click();
  }
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Insertar una imagen').click();
  await (await chooser).setFiles({ name: 'revision.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  const image = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await image.getByTestId('image-media').click();
  await image.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  return image;
}

test('confirmación: casilla, feedback visible/accesible y estado real', async ({ page }, info) => {
  const image = await create(page);
  await image.getByLabel(/^Texto alternativo/).fill('Descripción por revisar');
  await image.getByLabel(/^Leyenda/).fill('Leyenda independiente');
  await image.getByLabel('Propósito de la imagen', { exact: true }).selectOption('informative');
  const confirm = image.getByRole('button', { name: 'Confirmar propósito y textos', exact: true });
  await expect(confirm).toBeDisabled();
  await expect(image.getByTestId('image-review-status')).toContainText('Pendiente de revisión');
  await expect(image.getByTestId('image-review-hint')).toContainText('Marca la casilla');
  await confirm.evaluate((node) => (node as HTMLButtonElement).click());
  await expect(image.getByTestId('image-review-feedback')).toHaveCount(0);
  await expect(image.getByTestId('image-review-status')).toContainText('Pendiente de revisión');
  const checkbox = image.getByLabel(checkedName, { exact: true });
  await checkbox.focus();
  await expect(checkbox).toHaveAccessibleDescription(/Marca la casilla/);
  await checkbox.press('Space');
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await confirm.press('Enter');
  await expect(image.getByTestId('image-review-status')).toContainText('Informativa');
  const feedback = image.getByTestId('image-review-feedback');
  await expect(feedback).toContainText('Propósito y textos confirmados');
  await visibleFeedback(feedback);
  await expect(feedback).toHaveAttribute('role', 'status');
  await expect(feedback).toHaveAttribute('aria-live', 'polite');
  await expect(feedback).toHaveAttribute('aria-atomic', 'true');
  await expect(confirm).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  writeFileSync(info.outputPath('confirmacion-accesible.yml'), await feedback.ariaSnapshot());
  await page.screenshot({ path: info.outputPath('confirmacion.png'), fullPage: true });
  // Otro clic accidental no debe crear otra confirmación/hito de Undo.
  await confirm.evaluate((node) => (node as HTMLButtonElement).click());
  await button(page, 'Deshacer en el editor').click();
  await expect(image.getByTestId('image-review-status')).toContainText('Pendiente de revisión');
  await expect(feedback).toHaveCount(0);
  await button(page, 'Rehacer en el editor').click();
  await expect(image.getByTestId('image-review-status')).toContainText('Informativa');
  await expect(feedback).toHaveCount(0);
  await checkbox.check();
  await confirm.click();
  await expect(feedback).toContainText('Propósito y textos confirmados');
  await image.getByLabel(/^Texto alternativo/).fill('Descripción revisada');
  await expect(feedback).toHaveCount(0);
  await checkbox.check();
  await confirm.click();
  await expect(feedback).toContainText('Propósito y textos confirmados');
  await expect(feedback).toHaveCount(0, { timeout: 6000 });
  await button(page, 'Guardar texto').click();
  await button(page, 'Cerrar el editor de la tarjeta').click();
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const saved = await download;
  const zip = info.outputPath('confirmacion.zip');
  await saved.saveAs(zip);
  await button(page, `Confirmar que guardé ${saved.suggestedFilename()}`).click();
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await chooser).setFiles({ name: 'confirmacion.zip', mimeType: 'application/zip', buffer: readFileSync(zip) });
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  const reopened = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await reopened.getByTestId('image-media').click();
  await reopened.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
  await expect(reopened.getByLabel('Propósito de la imagen', { exact: true })).toHaveValue('informative');
  await expect(reopened.getByLabel(/^Texto alternativo/)).toHaveValue('Descripción revisada');
  await expect(reopened.getByLabel(/^Leyenda/)).toHaveValue('Leyenda independiente');
  await expect(reopened.getByTestId('image-review-feedback')).toHaveCount(0);
  await expect(reopened.getByLabel(checkedName, { exact: true })).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('reabierto.png'), fullPage: true });
  if ((page.viewportSize()?.width ?? 0) >= 800) {
    await button(page, 'Cerrar el editor de la tarjeta').click();
    await openCardActions(page, page.getByTestId('card-tarjeta-1'), 'Nueva nota');
    await button(page, 'Editar Nueva nota dentro de la ficha').click();
    const quick = page.getByTestId('inline-card-editor').locator('[data-testid^="rich-image-"]');
    await quick.getByTestId('image-media').click();
    await quick.getByRole('button', { name: 'Más opciones de imagen', exact: true }).click();
    await quick.getByLabel('Propósito de la imagen', { exact: true }).selectOption('decorative');
    await quick.getByLabel(checkedName, { exact: true }).check();
    await quick.getByRole('button', { name: 'Confirmar propósito y textos', exact: true }).click();
    await expect(quick.getByTestId('image-review-feedback')).toContainText('Propósito y textos confirmados');
    await visibleFeedback(quick.getByTestId('image-review-feedback'));
    await expect(quick.getByTestId('image-review-status')).toContainText('Decorativa');
    await page.screenshot({ path: info.outputPath('confirmacion-rapida.png'), fullPage: true });
  }
});
