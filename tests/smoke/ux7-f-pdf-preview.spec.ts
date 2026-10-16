import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openAssets(page: Page) {
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
}

async function importDocument(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un documento o audio a la biblioteca').click();
  (await chooser).setFiles({ name, mimeType, buffer });
}

const realPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');

// Los nombres de archivo ya se piden en minúsculas: el importador los normaliza (igual que
// `plano-del-rio.png` en las pruebas existentes de Assets) — usar el nombre real desde el principio
// evita que cada aserción tenga que adivinar la normalización.
test('UX7-F PDF-02/03/04: vista previa embebida se abre, muestra el documento y cierra sin salir de Assets', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca PDF');
  await openAssets(page);
  await importDocument(page, 'manual.pdf', 'application/pdf', realPdfBytes);
  await expect(page.getByTestId('asset-detail')).toContainText('manual.pdf');

  await button(page, 'Previsualizar manual.pdf').click();
  const preview = page.getByTestId('asset-pdf-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('manual.pdf');
  const frame = page.getByTestId('asset-pdf-preview-frame');
  await expect(frame).toHaveAttribute('src', /^blob:/);
  await page.screenshot({ path: 'artifacts/ux7-f-pdf-preview-desktop.png', fullPage: true });

  // Cerrar vuelve a Assets, sin salir del Workspace ni perder el proyecto.
  await button(page, 'Cerrar vista previa de manual.pdf').click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId('assets-view')).toBeVisible();
  await expect(page.getByTestId('asset-detail')).toContainText('manual.pdf');
});

test('UX7-F PDF-05: cambiar de documento no deja contenido obsoleto del anterior', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca Dos PDF');
  await openAssets(page);
  await importDocument(page, 'a.pdf', 'application/pdf', realPdfBytes);
  await importDocument(page, 'b.pdf', 'application/pdf', realPdfBytes);

  await button(page, 'Ver a.pdf').click();
  await button(page, 'Previsualizar a.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toContainText('a.pdf');
  const urlA = await page.getByTestId('asset-pdf-preview-frame').getAttribute('src');
  await button(page, 'Cerrar vista previa de a.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toHaveCount(0);

  await button(page, 'Ver b.pdf').click();
  await button(page, 'Previsualizar b.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toContainText('b.pdf');
  const urlB = await page.getByTestId('asset-pdf-preview-frame').getAttribute('src');
  expect(urlB).not.toBe(urlA);
});

test('UX7-F PDF-06: cerrar la vista previa revoca el Blob URL temporal', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __revokedUrls: string[] }).__revokedUrls = [];
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      (window as unknown as { __revokedUrls: string[] }).__revokedUrls.push(url);
      return original(url);
    };
  });
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca Revocacion');
  await openAssets(page);
  await importDocument(page, 'revocar.pdf', 'application/pdf', realPdfBytes);

  await button(page, 'Previsualizar revocar.pdf').click();
  const url = await page.getByTestId('asset-pdf-preview-frame').getAttribute('src');
  await button(page, 'Cerrar vista previa de revocar.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toHaveCount(0);

  const revoked = await page.evaluate(() => (window as unknown as { __revokedUrls: string[] }).__revokedUrls);
  expect(revoked).toContain(url);
});

test('UX7-F PDF-08/09: un archivo .pdf cuyo contenido no es un PDF real se rechaza de forma controlada', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca PDF Falso');
  await openAssets(page);
  // Pasa el filtro por nombre/extensión, pero su contenido no empieza con "%PDF-": debe fallar en la
  // vista previa (firma binaria), no en la importación, que no distingue PDF de otros documentos.
  await importDocument(page, 'falso.pdf', 'application/pdf', Buffer.from('esto no es un PDF real'));
  await expect(page.getByTestId('asset-detail')).toContainText('falso.pdf');

  await button(page, 'Previsualizar falso.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview-error')).toContainText('no es un PDF válido');
  await expect(page.getByTestId('asset-pdf-preview-frame')).toHaveCount(0);
  // La aplicación sigue estable: se puede cerrar y Assets conserva el archivo (no se corrompió nada).
  await button(page, 'Cerrar vista previa de falso.pdf').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
});

test('UX7-F PDF-10: cambiar de proyecto no deja visible un PDF del Workspace anterior', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Proyecto Uno');
  await openAssets(page);
  await importDocument(page, 'deuno.pdf', 'application/pdf', realPdfBytes);
  await button(page, 'Previsualizar deuno.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toBeVisible();

  // Cerrar el preview y cambiar de proyecto (crear uno nuevo) — el visor nunca debe reaparecer solo.
  await button(page, 'Cerrar vista previa de deuno.pdf').click();
  await button(page, 'Volver al tablero').click();
  await button(page, 'Cambiar de proyecto').click();
  await button(page, 'Crear un nuevo proyecto en esta carpeta').click();
  await page.getByLabel('Nombre del nuevo proyecto').fill('Proyecto Dos');
  await button(page, 'Crear').click();
  await expect(page.getByRole('heading', { name: 'Proyecto Dos', exact: true })).toBeVisible();
  await expect(page.getByTestId('asset-pdf-preview')).toHaveCount(0);
});

test('UX7-F PDF-11/12: Descargar y Abrir externamente siguen funcionando junto al nuevo botón de vista previa', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca Regresion');
  await openAssets(page);
  await importDocument(page, 'regresion.pdf', 'application/pdf', realPdfBytes);
  await expect(button(page, 'Previsualizar regresion.pdf')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button(page, 'Descargar regresion.pdf').click(),
  ]);
  expect(download.suggestedFilename()).toBe('regresion.pdf');

  // El visor nativo de PDF de Chromium envuelve el blob en su propia página interna (a diferencia de
  // un audio/mp3, donde la URL del popup expone "blob:" directamente) — por eso aquí solo se confirma
  // que «Abrir» sigue abriendo una pestaña nueva sin error, sin exigir el contenido exacto de su URL.
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    button(page, 'Abrir regresion.pdf').click(),
  ]);
  await expect.poll(() => popup.url()).not.toBe('about:blank');
  await popup.close();
});

test('UX7-F: vista previa se ve correctamente en móvil web (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await createWorkspace(page, 'Biblioteca Movil');
  await button(page, 'Más secciones').click();
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
  await importDocument(page, 'movil.pdf', 'application/pdf', realPdfBytes);
  await button(page, 'Previsualizar movil.pdf').click();
  await expect(page.getByTestId('asset-pdf-preview')).toBeVisible();
  await expect(page.getByTestId('asset-pdf-preview-frame')).toHaveAttribute('src', /^blob:/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: 'artifacts/ux7-f-pdf-preview-mobile.png', fullPage: true });
});
