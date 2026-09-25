import { expect, test } from '@playwright/test';

test('los handles reales de Chromium guardan y reabren un workspace v1', async ({ page }) => {
  // Sustituye solo el diálogo del sistema: lectura, escritura y directorios son handles nativos.
  await page.addInitScript({ content: `window.showDirectoryPicker = async () => await navigator.storage.getDirectory();` });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  await page.getByLabel('Nombre del nuevo espacio').fill('Handle real');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-1').click();
  await page.getByLabel('Título de la tarjeta').fill('Persistió');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('handle-real');
    const manifest = await (await folder.getDirectoryHandle('.nouty')).getFileHandle('workspace.yaml');
    const card = await (await folder.getDirectoryHandle('cards')).getFileHandle('tarjeta-1.md');
    return { manifest: await (await manifest.getFile()).text(), card: await (await card.getFile()).text() };
  });
  expect(files.manifest).toContain('id: handle-real');
  expect(files.card).toContain('Persistió');
  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Handle real' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Persistió');
});
