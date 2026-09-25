import { expect, test } from '@playwright/test';

const fakeFolder = `
(() => {
  const storeKey = 'nouty-test-folder';
  const data = () => JSON.parse(localStorage.getItem(storeKey) || '{}');
  const put = (value) => localStorage.setItem(storeKey, JSON.stringify(value));
  const missing = () => Object.assign(new Error('Missing'), { name: 'NotFoundError' });
  const directory = (prefix = '') => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || 'Nouty',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(name, options = {}) {
      const path = prefix + name + '/';
      const files = data();
      if (!options.create && !Object.keys(files).some((key) => key.startsWith(path))) throw missing();
      return directory(path);
    },
    async getFileHandle(name, options = {}) {
      const path = prefix + name;
      if (!options.create && !(path in data())) throw missing();
      return {
        getFile: async () => new Blob([new Uint8Array(data()[path])]),
        createWritable: async () => {
          let bytes;
          return {
            write: async (value) => { bytes = Array.from(value); },
            close: async () => { const files = data(); files[path] = bytes; put(files); },
          };
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

test('carpeta web: crear, guardar, recargar y reconectar sin perder las tarjetas', async ({ page }, testInfo) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Abrir una carpeta' })).toBeEnabled();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  await page.getByLabel('Nombre del nuevo espacio').fill('Mi carpeta');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Mi carpeta' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  await page.getByTestId('card-tarjeta-1').click();
  await page.getByLabel('Título de la tarjeta').fill('Nota persistente');
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota persistente');
  await expect(page.getByTestId('workspace-feedback')).toContainText('guardado en la carpeta');
  await page.screenshot({ path: testInfo.outputPath('folder-saved.png'), fullPage: true });
  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByRole('button', { name: 'Abrir Mi carpeta' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir Mi carpeta' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota persistente');
  await page.screenshot({ path: testInfo.outputPath('folder-reconnected.png'), fullPage: true });
});

test('cancelar el selector conserva el modo de memoria y muestra un aviso', async ({ page }) => {
  await page.addInitScript({ content: `window.showDirectoryPicker = async () => { throw Object.assign(new Error('Cancelado'), { name: 'AbortError' }); };` });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByRole('alert')).toHaveText('No se seleccionó ninguna carpeta.');
  await expect(page.getByTestId('memory-notice')).toContainText('SOLO EN MEMORIA');
});

test('un cambio externo bloquea el siguiente guardado y conserva sus bytes', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Conflicto');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  const changed = await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const path = 'conflicto/.nouty/workspace.yaml';
    const source = files[path];
    if (!source) throw new Error('No se creó el manifiesto.');
    const original = new TextDecoder().decode(new Uint8Array(source));
    const external = original.replace('name: Conflicto', 'name: Externo');
    files[path] = Array.from(new TextEncoder().encode(external));
    localStorage.setItem('nouty-test-folder', JSON.stringify(files));
    return external;
  });
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await expect(page.getByTestId('workspace-feedback')).toContainText('cambiaron fuera de NoutyNotes');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const source = files['conflicto/.nouty/workspace.yaml'];
    if (!source) throw new Error('Desapareció el manifiesto.');
    return new TextDecoder().decode(new Uint8Array(source));
  })).toBe(changed);
});
