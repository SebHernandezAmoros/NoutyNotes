import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function createWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill(name);
  await button(page, 'Crear proyecto').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('UX7-E2D: + Nuevo proyecto crea sin salir del Workspace (no navega a Inicio)', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Proyecto Origen');
  const routeBefore = page.url();

  await button(page, 'Cambiar de proyecto').click();
  await expect(page.getByTestId('project-sheet')).toBeVisible();

  // Cancelar no crea nada: el panel sigue mostrando solo el proyecto existente.
  await button(page, 'Crear un nuevo proyecto en esta carpeta').click();
  await page.getByLabel('Nombre del nuevo proyecto').fill('Se cancela');
  await button(page, 'Cancelar').click();
  await expect(page.getByTestId('project-sheet-create-form')).toHaveCount(0);
  await expect(page.getByTestId('project-sheet')).toBeVisible();

  // Crear de verdad: permanece en /workspace, nunca pasa por Inicio.
  await button(page, 'Crear un nuevo proyecto en esta carpeta').click();
  await page.getByLabel('Nombre del nuevo proyecto').fill('Proyecto Nuevo');
  await button(page, 'Crear').click();
  await expect(page.getByRole('heading', { name: 'Proyecto Nuevo', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\?id=/);
  expect(page.url()).not.toBe(routeBefore);

  // El proyecto original sigue intacto y accesible desde el mismo panel.
  await button(page, 'Cambiar de proyecto').click();
  await expect(button(page, 'Ir al proyecto Proyecto Origen')).toBeVisible();
});

test('UX7-E2C: el catálogo de Proyectos muestra proyectos recientes de otras carpetas con estado honesto', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: 'noutynotes.recents.v1',
    value: JSON.stringify({
      version: 1,
      folders: [{ id: 'web-other-1', backend: 'web', name: 'Historias', origin: 'created', androidUri: null, lastUsedAt: 100 }],
      projects: [{ id: 'web:web-other-1:guion', workspaceId: 'guion', name: 'Guion', backend: 'web', folderId: 'web-other-1', lastUsedAt: 100 }],
    }),
  });
  await page.reload();
  await createWorkspace(page, 'Proyecto Actual');

  await button(page, 'Cambiar de proyecto').click();
  await expect(page.getByTestId('project-sheet')).toBeVisible();
  const otherFolders = page.getByTestId('project-sheet-other-folders');
  await expect(otherFolders).toBeVisible();
  await expect(otherFolders).toContainText('OTRAS CARPETAS');
  await expect(otherFolders).toContainText('Historias');
  await expect(otherFolders).toContainText('Guion');
  // Sin conexión real a "Historias", el estado es honesto: Reconectar, no un Abrir engañoso.
  await expect(page.getByTestId('project-sheet-other-web:web-other-1:guion')).toContainText('Reconectar');

  await page.screenshot({ path: 'artifacts/ux7-e2c-catalog-other-folders.png', fullPage: true });
});

test('UX7-E2-15: sin IndexedDB disponible, Recientes y el panel Proyectos siguen funcionando (degradación honesta)', async ({ page }) => {
  await page.addInitScript(() => {
    // Simula un navegador sin IndexedDB (privado/bloqueado): `folderHandles.ts` debe degradar en
    // silencio, nunca lanzar ni bloquear el resto de la app.
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  await page.goto('./');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await createWorkspace(page, 'Proyecto Sin IndexedDB');
  await expect(page.getByRole('heading', { name: 'Proyecto Sin IndexedDB', exact: true })).toBeVisible();

  await button(page, 'Cambiar de proyecto').click();
  await expect(page.getByTestId('project-sheet')).toBeVisible();
  await button(page, 'Crear un nuevo proyecto en esta carpeta').click();
  await page.getByLabel('Nombre del nuevo proyecto').fill('Segundo');
  await button(page, 'Crear').click();
  await expect(page.getByRole('heading', { name: 'Segundo', exact: true })).toBeVisible();
});
