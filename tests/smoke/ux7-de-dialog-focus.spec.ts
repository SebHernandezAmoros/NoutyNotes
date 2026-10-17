import { expect, test } from '@playwright/test';

import { isCompactWidth } from './support';

// UX7.3-D/E, Hito D (A11Y-01): el `Dialog` compartido (Configuración, Proyectos, Plantillas, Crear
// proyecto, Recuperación…) no movía el foco al abrir ni lo devolvía a quien lo abrió al cerrar —
// confirmado leyendo `components/Dialog.tsx` (ningún efecto de foco existía). Corregido reutilizando
// exactamente el mismo patrón ya probado en `CardMenu` (`canvas/CardControls.tsx`): solo escritorio
// ancho, primer elemento enfocable del diálogo al abrir, foco devuelto al disparador al cerrar.
test('UX7.3-D/E: abrir un Dialog mueve el foco dentro y cerrarlo lo devuelve al botón que lo abrió', async ({ page }) => {
  // La corrección es deliberadamente solo de escritorio ancho (mismo alcance que `CardMenu`, que ya
  // excluye `compact` por su propia semántica táctil/de teclado nativo) — en compacto esta prueba no
  // aplica.
  test.skip(isCompactWidth(page), 'Gestión de foco solo aplica en escritorio ancho (igual que CardMenu).');
  await page.goto('./');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Foco de diálogo');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Foco de diálogo', exact: true })).toBeVisible();

  const opener = page.getByRole('button', { name: 'Abrir la configuración', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByTestId('settings-panel');
  await expect(dialog).toBeVisible();

  // Rojo antes de la corrección: el foco seguía en el botón de fondo (tapado por el propio diálogo),
  // nunca dentro de `settings-panel`.
  await expect(page.locator('[data-testid="settings-panel"] :focus')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Rojo antes de la corrección: tras cerrar, nada devolvía el foco al botón original — se perdía en
  // `<body>`, obligando a tabular desde el principio de la página para continuar por teclado.
  await expect(opener).toBeFocused();
});
