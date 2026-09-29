import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { openMore, trackProblems } from './support';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/**
 * Selector de plantillas incorporadas (fase 11a, ADR 0033): listar, previsualizar nombre/descripción/
 * README y crear un espacio a partir de una, con su asset copiado. Importar, exportar y duplicar una
 * plantilla propia (11b) no están implementados y no se comprueban aquí.
 *
 * Límite conocido, documentado en el ADR: el asset de las tres plantillas incorporadas es un SVG. La
 * miniatura en el lienzo (`useImagePreviews`) y `inspectImage` (ADR 0015) solo reconocen PNG/JPEG/GIF/
 * WebP por firma binaria, así que no se ve una vista previa dibujada del SVG ni en el lienzo ni en
 * Assets; el archivo sí se copia de verdad y es legible y descargable (comprobado abajo), que es lo que
 * puede afirmarse con evidencia real.
 */
test('Selector de plantillas: listar las tres, previsualizar su README y crear un espacio desde GDD con su asset copiado', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');

  await button(page, 'Usar una plantilla').click();
  const dialog = page.getByTestId('template-picker');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elegir una plantilla' })).toBeVisible();

  // Las tres plantillas incorporadas, cada una con su propio nombre (el botón anuncia «Elegir la
  // plantilla X»: su accessibilityLabel, no el texto visible, ADR 0033/riesgo recurrente de la app).
  await expect(button(page, 'Elegir la plantilla Game Design Document')).toBeVisible();
  await expect(button(page, 'Elegir la plantilla Film Storyboard')).toBeVisible();
  await expect(button(page, 'Elegir la plantilla Research Board')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('template-picker.png'), fullPage: true });

  // Elegir otra plantilla cambia la vista previa (descripción y README propios).
  await button(page, 'Elegir la plantilla Research Board').click();
  await expect(dialog).toContainText('Fuentes, hallazgos y evidencias.');
  await expect(dialog).toContainText('Registra fuentes y enlázalas con los hallazgos que respaldan.');

  // Volver a GDD, que es la que se va a crear.
  await button(page, 'Elegir la plantilla Game Design Document').click();
  await expect(dialog).toContainText('Visión y mecánicas de un juego.');
  await expect(dialog).toContainText('Define la visión del juego y conecta sus mecánicas.');

  await page.getByLabel('Nombre del espacio creado desde la plantilla').fill('Mi GDD');
  await button(page, 'Crear el espacio').click();

  // Navega al tablero del espacio nuevo, con las tarjetas, tipos y la conexión de la plantilla.
  await expect(page.getByRole('heading', { name: 'Mi GDD', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Un jardín en movimiento')).toBeVisible();
  await expect(page.getByText('Mover semillas')).toBeVisible();

  // El asset que declara la plantilla se copió de verdad: aparece en Assets y se puede descargar.
  await openMore(page);
  await button(page, 'Abrir los assets').click();
  await expect(page.getByTestId('assets-view')).toBeVisible();
  await button(page, 'Ver gdd.svg').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button(page, 'Descargar gdd.svg').click(),
  ]);
  expect(download.suggestedFilename()).toBe('gdd.svg');

  expect(runtimeErrors).toEqual([]);
});

test('Selector de plantillas: cerrar sin crear nada no toca el almacenamiento', async ({ page }) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  await button(page, 'Usar una plantilla').click();
  const dialog = page.getByTestId('template-picker');
  await expect(dialog).toBeVisible();
  await button(page, 'Cerrar elegir una plantilla').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  expect(runtimeErrors).toEqual([]);
});
