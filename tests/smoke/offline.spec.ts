import { expect, test } from '@playwright/test';

import { buildZip, text } from '../../packages/storage/src/__fixtures__/zip';

/**
 * Contrato de arranque sin conexión (ADR 0011): tras una primera visita CON red al export, una
 * pestaña nueva o una recarga SIN red inicia la app desde el service worker, y el fallback ZIP
 * funciona. Solo aplica al export: el servidor de desarrollo no genera ni registra el worker.
 */
const minimalWorkspace = {
  '.nouty/workspace.yaml': 'boards: []\ncardTypes: []\ncards: []\nid: sin-red\nmetadata:\n  name: Sin red\nrelationTypes: []\nschemaVersion: 1\n',
  '.nouty/layout.yaml': 'layouts: []\nschemaVersion: 1\n',
  '.nouty/relations.yaml': 'relations: []\nschemaVersion: 1\n',
};

test('arranque sin conexión tras una primera visita con red, con importación y exportación ZIP', async ({ browser, context, page, baseURL }, testInfo) => {
  test.skip(!baseURL?.includes(':8082/'), 'El servidor de desarrollo no genera ni registra el service worker; el contrato se comprueba contra el export.');
  const home = baseURL ?? './';

  // Control: sin visita previa, sin red la app no carga (la prueba distingue caché de red).
  const cold = await browser.newContext();
  await cold.setOffline(true);
  const coldPage = await cold.newPage();
  await expect(coldPage.goto(home)).rejects.toThrow();
  await cold.close();

  // Primera visita con red: el worker se instala, precachea el export y toma el control.
  await page.goto(home);
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active) && navigator.serviceWorker.controller !== null;
  }), { timeout: 15_000 }).toBe(true);

  // Sin red: pestaña nueva desde la raíz y enlace directo a la ruta del workspace.
  await context.setOffline(true);
  const offline = await context.newPage();
  const response = await offline.goto(home);
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(offline.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();

  const chooser = offline.waitForEvent('filechooser');
  await offline.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  const entries = Object.entries(minimalWorkspace).map(([name, content]) => ({ name, data: text(content) }));
  await (await chooser).setFiles({ name: 'sin-red.zip', mimeType: 'application/zip', buffer: Buffer.from(buildZip(entries)) });
  await expect(offline.getByRole('heading', { name: 'Sin red', exact: true })).toBeVisible();
  await offline.getByRole('button', { name: 'Añadir nota', exact: true }).click();
  await expect(offline.getByTestId('card-tarjeta-1')).toBeVisible();
  const download = offline.waitForEvent('download');
  await offline.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('sin-red.zip');
  await offline.screenshot({ path: testInfo.outputPath('offline-workspace.png') });

  const direct = await context.newPage();
  const routed = await direct.goto(new URL('workspace?id=sin-red', home).href);
  expect(routed?.fromServiceWorker()).toBe(true);
  // Pestaña nueva: la memoria no se comparte, y la app lo explica sin red.
  await expect(direct.getByTestId('workspace-missing')).toBeVisible();

  // Recargar sin red la ruta del workspace también arranca desde la caché (la memoria se pierde).
  const reloaded = await offline.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(offline.getByTestId('workspace-missing')).toBeVisible();
  await context.setOffline(false);
});
