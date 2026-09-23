import { expect, test } from '@playwright/test';

test('inicio responsive, temas y acciones aún no disponibles', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  const failedResources: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => failedResources.push(request.url()));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear un espacio', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Abrir una carpeta', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Usar una plantilla', exact: true })).toBeDisabled();

  const screen = page.getByTestId('home-screen');
  const lightBackground = await screen.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tema oscuro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => screen.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground);
  const darkBackground = await screen.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.screenshot({ path: testInfo.outputPath('home-dark.png'), fullPage: true });

  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await expect(screen).toHaveCSS('background-color', lightBackground);
  await page.getByRole('button', { name: 'Tema sistema', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(screen).toHaveCSS('background-color', darkBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(screen).toHaveCSS('background-color', lightBackground);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('home-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Usar una plantilla', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('home-actions.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await expect(screen).toHaveCSS('background-color', darkBackground);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});
