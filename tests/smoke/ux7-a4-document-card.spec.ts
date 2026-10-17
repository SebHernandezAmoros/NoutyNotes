import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { isCompactWidth, openCardActions, openFullCardEditor, rgb } from './support';

// UX7.1-A4: una tarjeta de documento referencia un PDF ya catalogado en Assets (sin copiarlo), se
// identifica con icono + nombre de archivo (sin visor incrustado) y abre el mismo visor de Assets al
// activarla, sin ofrecer edición rápida de cuerpo (no tiene uno).
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openAssets(page: Page) {
  if (isCompactWidth(page)) await button(page, 'Más secciones').click();
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
}

const realPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');

/** Añade un PDF a Assets y lo coloca como tarjeta del tablero (reutilizado por varias pruebas). */
async function addPdfCard(page: Page, name: string) {
  await openAssets(page);
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un documento o audio a la biblioteca').click();
  (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: realPdfBytes });
  await button(page, `Ver ${name}`).click();
  await button(page, `Añadir ${name} al tablero`).click();
  await expect(page.getByTestId('assets-view')).toBeHidden();
}

test('UX7.1-A4: un PDF catalogado se añade como tarjeta del Canvas, abre el visor existente y no ofrece edición rápida', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Documentos del Canvas');
  await addPdfCard(page, 'reporte.pdf');

  // Vuelve sola al tablero (sin copiar el archivo) y deja la tarjeta seleccionada.
  await expect(page.getByTestId('assets-view')).toBeHidden();
  const card = page.getByTestId('card-tarjeta-1');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('document-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('document-icon-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('document-title-tarjeta-1')).toHaveText('reporte');
  await page.screenshot({ path: `artifacts/ux7-a4-document-card-${testInfo.project.name}.png`, fullPage: true });

  // Abrir (doble clic) reutiliza el mismo visor de PDF que Assets, sin un segundo sistema.
  await card.dblclick();
  const preview = page.getByTestId('asset-pdf-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('reporte');
  await expect(page.getByTestId('asset-pdf-preview-frame')).toHaveAttribute('src', /^blob:/);
  await page.screenshot({ path: `artifacts/ux7-a4-document-preview-${testInfo.project.name}.png`, fullPage: true });
  await button(page, 'Cerrar vista previa de reporte').click();
  await expect(preview).toHaveCount(0);
  await expect(card).toBeVisible();

  // El menú contextual no ofrece edición rápida (sin cuerpo de texto); Inspector sigue disponible.
  await openCardActions(page, card, 'reporte');
  const menu = page.getByTestId('card-menu');
  await expect(menu.getByRole('button', { name: 'Editar reporte dentro de la ficha', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Abrir el Inspector de reporte', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // El Inspector completo abre en Apariencia (no Contenido): icono disponible, sin «zonas» que alternar
  // (no tiene cuerpo), y el nombre sigue siendo renombrable desde «Más».
  await openFullCardEditor(page, card);
  const inspector = page.getByTestId('card-inspector');
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId('card-icon-picker')).toBeVisible();
  await expect(page.getByText('ZONAS DE LA NOTA')).toHaveCount(0);
  await page.getByTestId('card-inspector-section-more').click();
  await expect(page.getByTestId('rich-title-editor')).toBeVisible();
});

// UX7.1-A4-FIX: el icono de documento se dibuja directamente sobre `cardSurface` (clara en ambos
// temas), no sobre una cabecera de color propio — a diferencia de nota/imagen, que solo muestran su
// icono dentro de una cabecera. Un icono que siga el texto general de la interfaz (claro en tema
// oscuro) se vuelve invisible ahí; debe seguir `cardText` (oscuro constante en ambos temas).
test('UX7.1-A4-FIX: el icono de documento mantiene contraste con cardText en tema claro y oscuro, no con textPrimary', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await createWorkspace(page, 'Contraste PDF Oscuro');
  await addPdfCard(page, 'reporte.pdf');

  const card = page.getByTestId('card-tarjeta-1');
  await expect(card).toHaveCSS('background-color', rgb(themeColors.dark.cardSurface));
  // El trazo del icono (el rectángulo de la hoja, primer `div` con borde dentro de la cara expandida)
  // debe coincidir con `cardText`, el mismo tono que ya usa el nombre del archivo justo debajo — y no
  // con `textPrimary`, el valor que causó el defecto reportado (claro sobre una tarjeta clara).
  const pageShape = page.getByTestId('document-icon-tarjeta-1').locator('> div > div').first();
  await expect(pageShape).toHaveCSS('border-top-color', rgb(themeColors.dark.cardText));
  expect(rgb(themeColors.dark.cardText)).not.toBe(rgb(themeColors.dark.textPrimary));
  await page.screenshot({ path: 'artifacts/ux7-a4-fix-document-icon-dark.png' });

  // Mismo trazo también correcto en tema claro (ya funcionaba; no debe romperse con el cambio). El
  // tema sigue el sistema en vivo (sin recargar, que perdería el proyecto en memoria): cambiar el
  // color de esquema emulado basta, igual que ya hace el resto de la suite con temas (`cards.spec.ts`).
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(card).toHaveCSS('background-color', rgb(themeColors.light.cardSurface));
  await expect(pageShape).toHaveCSS('border-top-color', rgb(themeColors.light.cardText));
  await page.screenshot({ path: 'artifacts/ux7-a4-fix-document-icon-light.png' });
});
