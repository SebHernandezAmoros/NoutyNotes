import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function createWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill(name);
  await button(page, 'Crear proyecto').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function backHome(page: Page) {
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}

test('UX7-E1: recientes de proyectos en memoria — orden, reabrir, olvidar y sesión temporal', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('home-screen')).toBeVisible();

  await createWorkspace(page, 'Proyecto A');
  await backHome(page);

  const recent = page.getByTestId('home-recent');
  await expect(recent).toBeVisible();
  const entryA = recent.getByText('Proyecto A', { exact: true });
  await expect(entryA).toBeVisible();
  const rowA = page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Proyecto A' });
  await expect(rowA.getByText('Abrir', { exact: true })).toBeVisible();

  await createWorkspace(page, 'Proyecto B');
  await backHome(page);

  // RECENT-E05: B (más reciente) antes que A.
  const names = await page.locator('[data-testid^="home-project-"] >> text=/Proyecto [AB]/').allTextContents();
  expect(names.slice(0, 2)).toEqual(['Proyecto B', 'Proyecto A']);

  // Reabrir A desde Recientes lo vuelve a poner primero.
  await page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Proyecto A' }).getByText('Abrir', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proyecto A', exact: true })).toBeVisible();
  await backHome(page);
  const namesAfterReopen = await page.locator('[data-testid^="home-project-"] >> text=/Proyecto [AB]/').allTextContents();
  expect(namesAfterReopen.slice(0, 2)).toEqual(['Proyecto A', 'Proyecto B']);

  // RECENT-E07: olvidar B lo quita de Recientes sin borrar el espacio (sigue en la lista de la sesión).
  const rowB = page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Proyecto B' });
  await rowB.getByText('Olvidar', { exact: true }).click();
  await expect(rowB).toHaveCount(1);
  await expect(rowB.getByText('Olvidar', { exact: true })).toHaveCount(0);
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ux7-e1-recent-available.png', fullPage: true });

  // RECENT-E08: tras recargar, la sesión en memoria desaparece; el proyecto reciente pasa a "Sesión temporal".
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  const rowAfterReload = page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Proyecto A' });
  await expect(rowAfterReload).toBeVisible();
  await expect(rowAfterReload.getByText('Sesión temporal', { exact: false })).toBeVisible();
  await expect(rowAfterReload.getByText('Abrir', { exact: true })).toHaveCount(0);

  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ux7-e1-recent-temporary.png', fullPage: true });
});

test('UX7-E1: Recientes se ve correctamente en móvil web (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await createWorkspace(page, 'Proyecto Móvil');
  await backHome(page);
  const recent = page.getByTestId('home-recent');
  await expect(recent).toBeVisible();
  await expect(recent.getByText('Proyecto Móvil', { exact: true })).toBeVisible();
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ux7-e1-recent-mobile.png', fullPage: true });
});
