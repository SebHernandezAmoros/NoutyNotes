import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import type { Page } from '@playwright/test';
import { isCompactWidth } from './support';

async function openAssets(page: Page) {
  if (isCompactWidth(page)) await page.getByRole('button', { name: 'Más secciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir los assets', exact: true }).click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
}

test('U1 consulta parcial: no confunde cero usos conocidos con Asset libre y actualiza una referencia nueva', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'desktop' ? 'dark' : 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Consulta U1');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await openAssets(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un documento o audio a la biblioteca', exact: true }).click();
  await (await chooser).setFiles({ name: 'u1-referencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF') });
  const detail = page.getByTestId('asset-detail');
  await expect(detail).toContainText('u1-referencia.pdf');
  const query = detail.getByRole('button', { name: 'Consultar uso', exact: true });
  await expect(query).toBeVisible({ timeout: 5000 });
  await query.focus();
  await page.keyboard.press('Enter');
  const usage = detail.getByTestId('asset-reference-analysis');
  await expect(usage).toContainText('Análisis parcial');
  await expect(usage).toContainText('Propietarios conocidos: 0');
  await expect(usage).toContainText('Apariciones conocidas: 0');
  await expect(usage).toContainText('no demuestra que el recurso esté libre');
  await expect(usage).toContainText('Borradores y editores de otras sesiones');
  await expect(usage.getByRole('button', { name: /Eliminar|Confirmar/ })).toHaveCount(0);
  await usage.screenshot({ path: `artifacts/assets-u1-free-${testInfo.project.name}.png` });

  await detail.getByRole('button', { name: 'Añadir u1-referencia.pdf al tablero', exact: true }).click();
  await expect(page.getByTestId('assets-view')).toBeHidden();
  await openAssets(page);
  await page.getByRole('button', { name: 'Ver u1-referencia.pdf', exact: true }).click();
  await detail.getByRole('button', { name: 'Consultar uso', exact: true }).click();
  await expect(usage).toContainText('Propietarios conocidos: 1');
  await expect(usage).toContainText('Apariciones conocidas: 1');
  await expect(usage).toContainText('Activo');
  await expect(usage).toContainText('Tarjeta de documento');
  await expect(usage).toContainText('Análisis parcial');
  await usage.screenshot({ path: `artifacts/assets-u1-used-${testInfo.project.name}.png` });
  const overflow = await usage.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});
