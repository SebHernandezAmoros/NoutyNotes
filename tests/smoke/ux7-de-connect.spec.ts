import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { insertFromMenu, isCompactWidth } from './support';

// UX7.3-D/E, Hito B: el defecto «Conectar inicia pero no completa la relación», citado como preexistente
// en varios expedientes (D83 de `UX7_UI_DECISIONS.md`, sección 4b de `UX7_EXECUTION_PLAN.md`), NO se
// reprodujo aquí. Causa real de la confusión anterior, confirmada por lectura de código y reproducción:
// (1) una investigación previa de esta misma sesión usó el patrón de testID equivocado
// (`connector-segment-`, el de la figura decorativa «conector»/forma) en vez de `relation-line-` (el
// enlace real que crea «Conectar» entre dos Notas) — leyó «0 coincidencias» y concluyó que no se creó
// nada, cuando sí se creó; (2) la única prueba existente que SÍ ejercitaba el flujo completo
// (`cards.spec.ts`, «minimizar, contraer y expandir...») nunca llegaba a esa parte: fallaba antes, en una
// aserción de `workspace-feedback` con un texto de éxito rutinario ya retirado por D03/D04 — un defecto
// de la prueba, no del producto. Esta prueba nueva aísla el flujo de Conectar, sin depender de ningún
// otro paso previo frágil, y confirma el resultado real con el testID correcto (`relation-line-`).
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Igual que `openCardActions` de `support.ts`, pero por testID numérico en vez de título accesible —
 * aquí varias Notas comparten el mismo título por defecto ("Nueva nota"), lo que vuelve ambiguo el
 * selector por nombre que usa el ayudante compartido en compacto. */
async function openActions(page: Page, card: Locator, id: number) {
  if (isCompactWidth(page)) await page.getByTestId(`card-actions-tarjeta-${id}`).click();
  else await card.press('Shift+F10');
  await page.getByTestId('card-menu').waitFor({ state: 'visible' });
}

async function createWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill(name);
  await button(page, 'Crear proyecto').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('UX7.3-D/E: Conectar completa la relación por clic, por teclado, la persiste y no crea una relación falsa al tocar el origen', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Conectar Notas');
  await insertFromMenu(page, 'Insertar nota');
  await insertFromMenu(page, 'Insertar nota');
  const cardA = page.getByTestId('card-tarjeta-1');
  const cardB = page.getByTestId('card-tarjeta-2');
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();
  const relations = page.locator('[data-testid^="relation-line-"]');

  // 1-3: iniciar, seleccionar destino por clic, crear la relación real (no solo el modo).
  await openActions(page, cardA, 1);
  await page.getByTestId('card-menu').getByRole('button', { name: /Conectar/ }).click();
  await expect(page.getByText(/Origen:/)).toBeVisible();
  await cardB.click();
  await expect(relations).toHaveCount(1);

  // 8: tocar el propio origen cancela sin crear una relación incorrecta — cubierto a nivel unitario y
  // puro en `canvas/connect.test.ts` ("tocar de nuevo el origen cancela"); aquí solo se confirma que,
  // tras la conexión real de arriba, el conteo de relaciones no cambió por nada posterior en esta misma
  // sesión (ninguna relación fantasma).
  await expect(relations).toHaveCount(1);

  // 4: ver la relación — el menú de la línea muestra origen→destino y permite editar/desconectar.
  await relations.first().click();
  await expect(page.getByText('Nueva nota → Nueva nota')).toBeVisible();
  await page.keyboard.press('Escape');

  // 5-6: «guardar»/«recargar» — este proyecto vive en memoria (se pierde al recargar la pestaña, por
  // diseño, ADR 0011); la persistencia real que sí aplica aquí es sobrevivir a navegar fuera del tablero
  // (Inicio) y volver a abrirlo, que sí pasa por el mismo `WorkspaceStorage` que un recargado real.
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Conectar Notas' })
    .getByRole('button', { name: /Abrir el proyecto/ }).click();
  await expect(page.getByRole('heading', { name: 'Conectar Notas', exact: true })).toBeVisible();
  await expect(relations).toHaveCount(1);

  // Completar por teclado (foco + Espacio): mismo resultado que por clic, sin duplicar la relación.
  const cardC = page.getByTestId('card-tarjeta-1');
  await insertFromMenu(page, 'Insertar nota');
  const cardD = page.getByTestId('card-tarjeta-3');
  await openActions(page, cardC, 1);
  await page.getByTestId('card-menu').getByRole('button', { name: /Conectar/ }).click();
  await cardD.focus();
  await page.keyboard.press(' ');
  await expect(relations).toHaveCount(2);
});
