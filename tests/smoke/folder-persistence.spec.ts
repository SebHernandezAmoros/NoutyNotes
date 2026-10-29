import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fillCardTitle, insertFromMenu, openFullCardEditor } from './support';

const runtimeErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]); });
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('crash', () => console.log('LAB_PAGE_CRASH'));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => { console.log('LAB_DIALOG', dialog.type()); void dialog.dismiss(); });
  await page.addInitScript(() => {
    let writeGranted = false;
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async (options: { mode: string }) => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-lab', { create: true });
      Object.assign(window, { __pickerMode: options.mode, __lab: root });
      Object.assign(window, { __pickerCalls: ((window as unknown as { __pickerCalls?: number }).__pickerCalls ?? 0) + 1 });
      Object.defineProperty(root, 'queryPermission', { configurable: true, value: async ({ mode }: { mode: string }) => mode === 'read' || writeGranted ? 'granted' : 'prompt' });
      Object.defineProperty(root, 'requestPermission', { configurable: true, value: async () => {
        if ((window as unknown as { __deny?: boolean }).__deny) return 'denied';
        writeGranted = true; return 'granted';
      } });
      return root;
    } });
  });
});

test('persistencia: lectura autorizada, escritura denegada y reintento por teclado conservan el handle', async ({ page }, info) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await page.evaluate(() => Object.assign(window, { __deny: true }));
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  const permission = page.getByTestId('folder-write-permission');
  await expect(permission).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: `artifacts/folder-persistence-${page.url().includes(':8082') ? 'pages' : 'dev'}-${info.project.name}-permission-dark.png`, fullPage: true });
  await expect(page.getByTestId('memory-notice')).toContainText('MEMORIA');
  const authorize = permission.getByRole('button', { name: 'Autorizar escritura y continuar', exact: true });
  await authorize.focus(); await page.keyboard.press('Enter');
  await expect(permission.getByRole('alert')).toContainText('no concedió');
  await expect(permission).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __deny: false }));
  await authorize.focus(); await page.keyboard.press('Enter');
  await expect(permission).toBeHidden();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  expect(await page.evaluate(() => (window as unknown as { __pickerCalls: number }).__pickerCalls)).toBe(1);
});

test('persistencia: destino local pendiente nunca crea en memoria, temporal es explícito', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear en carpeta', exact: true }).click();
  const dialog = page.getByTestId('create-project-dialog');
  await page.getByLabel('Nombre del proyecto').fill('No temporal');
  await expect(dialog.getByRole('button', { name: 'Crear proyecto', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Crear temporalmente', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Temporal laboratorio');
  await dialog.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByTestId('workspace-memory')).toContainText('SOLO EN MEMORIA');
  await expect(page.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true })).toBeVisible();
});

test('persistencia: crear local, guardar, verificar bytes y recargar con handle OPFS', async ({ page }, info) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear en carpeta', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Local laboratorio');
  await page.getByRole('button', { name: 'Elegir otra carpeta', exact: true }).click();
  const permission = page.getByTestId('folder-write-permission');
  await expect(permission).toBeVisible();
  await permission.getByRole('button', { name: 'Autorizar escritura y continuar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(permission).toBeHidden();
  await page.getByTestId('create-project-dialog').getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByTestId('workspace-memory')).not.toContainText('SOLO EN MEMORIA');
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await fillCardTitle(page, 'Guardado en disco');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-lab');
    const project = await root.getDirectoryHandle('local-laboratorio');
    return (await (await (await project.getDirectoryHandle('cards')).getFileHandle('tarjeta-1.md')).getFile()).text();
  })).toContain('Guardado en disco');
  expect(await page.evaluate(() => (window as unknown as { __pickerMode: string }).__pickerMode)).toBe('read');
  await page.screenshot({ path: `artifacts/folder-persistence-${page.url().includes(':8082') ? 'pages' : 'dev'}-${info.project.name}-local.png`, fullPage: true });
  await page.reload();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Guardado en disco');
  await expect(page.getByTestId('workspace-memory')).not.toContainText('SOLO EN MEMORIA');
});

test('persistencia: temporal se copia y solo después cambia el indicador de guardado', async ({ page }, info) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear temporalmente', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Copia laboratorio');
  await page.getByTestId('create-project-dialog').getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await insertFromMenu(page, 'Insertar nota');
  await page.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  const transfer = page.getByTestId('save-project-folder');
  await page.screenshot({ path: `artifacts/folder-persistence-${page.url().includes(':8082') ? 'pages' : 'dev'}-${info.project.name}-transfer-dialog.png`, fullPage: true });
  await transfer.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  await page.getByTestId('folder-write-permission').getByRole('button', { name: 'Autorizar escritura y continuar', exact: true }).click();
  await expect(transfer).toBeHidden();
  await expect(page.getByTestId('workspace-memory')).not.toContainText('SOLO EN MEMORIA');
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  await page.screenshot({ path: `artifacts/folder-persistence-${page.url().includes(':8082') ? 'pages' : 'dev'}-${info.project.name}-transfer.png`, fullPage: true });
  await page.reload();
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
});

test('persistencia: cancelar autorización conserva sesión y comunica cancelación explícita', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await page.getByTestId('folder-write-permission').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Operación cancelada');
  await expect(page.getByTestId('memory-notice')).toContainText('MEMORIA');
});

test('persistencia: recarga cancelada antes de autorizar la transferencia conserva el original', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear temporalmente', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('No perder temporal');
  await page.getByTestId('create-project-dialog').getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  await page.getByTestId('save-project-folder').getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  await expect(page.getByTestId('folder-write-permission')).toBeVisible();
  let prompt = '';
  page.once('dialog', (dialog) => { prompt = dialog.type(); }); // beforeEach rechaza el aviso nativo.
  await page.reload({ waitUntil: 'commit', timeout: 1500 }).catch(() => null);
  expect(prompt).toBe('beforeunload');
  await expect(page.getByTestId('workspace-memory')).toContainText('SOLO EN MEMORIA');
  await expect(page.getByTestId('folder-write-permission')).toBeVisible();
});

test('persistencia: carpeta ocupada bloquea copia y conserva el temporal', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear temporalmente', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Original protegido');
  await page.getByTestId('create-project-dialog').getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-lab', { create: true });
    const writer = await (await root.getFileHandle('existing.txt', { create: true })).createWritable();
    await writer.write('keep original bytes'); await writer.close();
  });
  await page.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  const transfer = page.getByTestId('save-project-folder');
  await transfer.getByRole('button', { name: 'Guardar proyecto en carpeta', exact: true }).click();
  await page.getByTestId('folder-write-permission').getByRole('button', { name: 'Autorizar escritura y continuar', exact: true }).click();
  await expect(transfer.getByRole('alert')).toContainText('contiene archivos');
  await expect(page.getByTestId('workspace-memory')).toContainText('SOLO EN MEMORIA');
  expect(await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-lab');
    return (await (await root.getFileHandle('existing.txt')).getFile()).text();
  })).toBe('keep original bytes');
});
