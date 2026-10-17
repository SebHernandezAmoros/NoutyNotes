import { expect, test } from '@playwright/test';

const fakeFolder = `
(() => {
  const storeKey = 'nouty-d1-folder';
  const data = () => JSON.parse(localStorage.getItem(storeKey) || '{}');
  const put = (value) => localStorage.setItem(storeKey, JSON.stringify(value));
  const missing = () => Object.assign(new Error('Missing'), { name: 'NotFoundError' });
  const directory = (prefix = '') => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || 'PROYECTOS D1',
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    isSameEntry: async (other) => other?.name === (prefix.split('/').filter(Boolean).pop() || 'PROYECTOS D1'),
    async getDirectoryHandle(name, options = {}) {
      const path = prefix + name + '/';
      if (!options.create && !Object.keys(data()).some((key) => key.startsWith(path))) throw missing();
      return directory(path);
    },
    async getFileHandle(name, options = {}) {
      const path = prefix + name;
      if (!options.create && !(path in data())) throw missing();
      return {
        getFile: async () => new Blob([new Uint8Array(data()[path])]),
        createWritable: async () => {
          let bytes;
          return { write: async (value) => { bytes = Array.from(value); }, close: async () => { const files = data(); files[path] = bytes; put(files); } };
        },
      };
    },
    async removeEntry(name) { const files = data(); delete files[prefix + name]; put(files); },
    async *entries() {
      const children = new Map();
      for (const key of Object.keys(data())) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [first, ...tail] = rest.split('/');
        if (first) children.set(first, tail.length ? directory(prefix + first + '/') : { kind: 'file' });
      }
      yield* children;
    },
  });
  window.showDirectoryPicker = async () => directory();
})();`;

test('D1: el modal valida nombre, muestra el destino actual y se puede cancelar', async ({ page }, testInfo) => {
  await page.goto('./');
  await expect(page.getByTestId('home-projects-empty')).toBeVisible();
  const surface = testInfo.project.name;
  await page.screenshot({ path: `artifacts/ux7-d1/home-empty-${surface}.png`, fullPage: true });
  await page.getByTestId('home-workspace').screenshot({ path: `artifacts/ux7-d1/home-workspace-empty-${surface}.png` });
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await page.screenshot({ path: `artifacts/ux7-d1/home-dark-${surface}.png`, fullPage: true });
  await page.getByTestId('home-workspace').screenshot({ path: `artifacts/ux7-d1/home-workspace-dark-${surface}.png` });
  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  const dialog = page.getByTestId('create-project-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('create-project-destination')).toContainText('Memoria de esta sesión');
  await dialog.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Escribe un nombre');
  await page.screenshot({ path: `artifacts/ux7-d1/modal-${surface}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('D1: elegir destino no cambia la sesión y crear activa la carpeta solo después de escribir', async ({ page }, testInfo) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await expect(page.getByTestId('memory-notice')).toContainText('MEMORIA');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  const dialog = page.getByTestId('create-project-dialog');
  await dialog.getByLabel('Nombre del proyecto').fill('Proyecto en destino');
  await dialog.getByRole('button', { name: 'Elegir otra carpeta', exact: true }).click();
  await expect(dialog.getByTestId('create-project-destination')).toContainText('PROYECTOS D1');
  await expect(page.getByTestId('memory-notice')).toContainText('MEMORIA');
  await page.screenshot({ path: `artifacts/ux7-d1/modal-selected-folder-${testInfo.project.name}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proyecto en destino', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await expect(page.getByTestId('create-project-destination')).toContainText('PROYECTOS D1');
});

test('D1: el proyecto de la sesión aparece una sola vez y se abre desde Inicio', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Proyecto reciente D1');
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proyecto reciente D1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  const row = page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Proyecto reciente D1' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Esta sesión');
  await page.screenshot({ path: `artifacts/ux7-d1/project-available-${testInfo.project.name}.png`, fullPage: true });
  await row.screenshot({ path: `artifacts/ux7-d1/project-row-available-${testInfo.project.name}.png` });
  await row.getByRole('button', { name: 'Abrir el proyecto Proyecto reciente D1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proyecto reciente D1', exact: true })).toBeVisible();
});

test('D1: un proyecto de otra carpeta comunica que necesita reconexión', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('noutynotes.recents.v1', JSON.stringify({
    version: 1,
    folders: [{ id: 'folder-historias', backend: 'web', name: 'Historias', origin: 'created', androidUri: null, lastUsedAt: 100 }],
    projects: [{ id: 'web:folder-historias:guion', workspaceId: 'guion', name: 'Guion', backend: 'web', folderId: 'folder-historias', lastUsedAt: 100 }],
  })));
  await page.reload();
  const row = page.getByTestId('home-project-web:folder-historias:guion');
  await expect(row).toContainText('Historias');
  await expect(row).toContainText('Reconectar');
  await page.screenshot({ path: `artifacts/ux7-d1/project-reconnect-${testInfo.project.name}.png`, fullPage: true });
  await row.screenshot({ path: `artifacts/ux7-d1/project-row-reconnect-${testInfo.project.name}.png` });
});

test('D1: cancelar o denegar el selector conserva el modal y la sesión', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __d1PickerMode?: string }).__d1PickerMode = 'cancel';
    (window as typeof window & { showDirectoryPicker?: () => Promise<never> }).showDirectoryPicker = async () => {
      const mode = (window as typeof window & { __d1PickerMode?: string }).__d1PickerMode;
      if (mode === 'cancel') throw new DOMException('Cancelado', 'AbortError');
      throw new DOMException('Denegado', 'NotAllowedError');
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  const dialog = page.getByTestId('create-project-dialog');
  await dialog.getByRole('button', { name: 'Elegir otra carpeta', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { (window as typeof window & { __d1PickerMode?: string }).__d1PickerMode = 'denied'; });
  await dialog.getByRole('button', { name: 'Elegir otra carpeta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No se pudo comprobar');
  await expect(page.getByTestId('memory-notice')).toContainText('MEMORIA');
});

test('D1: una doble confirmación crea un único proyecto', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill('Único');
  const submit = page.getByRole('button', { name: 'Crear proyecto', exact: true });
  await submit.evaluate((element: HTMLElement) => { element.click(); element.click(); });
  await expect(page.getByRole('heading', { name: 'Único', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await expect(page.locator('[data-testid^="home-project-"]').filter({ hasText: 'Único' })).toHaveCount(1);
});
