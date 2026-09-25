import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Bytes reales en disco, sin handles de Chrome. Esta prueba sustituye `showDirectoryPicker` y crea
 * sus propios objetos de directorio, archivo, permiso (`queryPermission` siempre `granted`) y
 * escritura, conectados a `node:fs` mediante `window.__disk`. Ejercita el código de la app
 * (`folderAccess.ts` y `FolderStorage`) contra archivos reales, pero **no** el selector, los
 * permisos ni los handles nativos de Chrome (la prueba OPFS sí usa handles nativos). Imita que
 * `createWritable` use un `<nombre>.crswap` hasta `close()`. Todas las rutas quedan confinadas a la
 * carpeta `notes` de la prueba.
 */
const diskBridge = `
(() => {
  const missing = () => Object.assign(new Error('Missing'), { name: 'NotFoundError' });
  const directory = (path) => ({
    kind: 'directory',
    name: path.split('/').filter(Boolean).pop() || 'notes',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(name, options = {}) {
      const child = path + name + '/';
      if (!(await window.__disk('isDir', child))) {
        if (!options.create) throw missing();
        await window.__disk('mkdir', child);
      }
      return directory(child);
    },
    async getFileHandle(name, options = {}) {
      const file = path + name;
      if (!(await window.__disk('isFile', file))) {
        if (!options.create) throw missing();
        await window.__disk('write', file, []);
      }
      return {
        getFile: async () => new Blob([new Uint8Array(await window.__disk('read', file))]),
        createWritable: async () => {
          await window.__disk('write', file + '.crswap', []);
          let bytes = [];
          return {
            write: async (value) => { bytes = Array.from(value); },
            close: async () => { await window.__disk('write', file, bytes); await window.__disk('remove', file + '.crswap'); },
          };
        },
      };
    },
    async removeEntry(name) {
      if (!(await window.__disk('remove', path + name))) throw missing();
    },
    async *entries() {
      for (const [name, kind] of await window.__disk('list', path)) {
        yield [name, kind === 'directory' ? directory(path + name + '/') : { kind: 'file' }];
      }
    },
  });
  window.showDirectoryPicker = async () => directory('');
})();`;

/**
 * Ruta absoluta dentro de `root` para una ruta relativa con «/» emitida por el puente; «» es la raíz.
 * Rechaza, antes de tocar el disco, rutas absolutas (incluida «/»), unidades, «\», «:», NUL, segmentos
 * vacíos, «.» y «..»; solo se admite una «/» final (directorios). Después comprueba que el resultado
 * sigue dentro de `root`: escapa «..» exacto o «..» + separador, no un nombre como «...txt».
 */
function confinedPath(root: string, relative: unknown): string {
  if (typeof relative !== 'string') throw new Error('Ruta no textual rechazada.');
  // Solo la cadena vacía es la raíz; «/» es una ruta absoluta.
  if (relative === '') return root;
  if (relative.startsWith('/')) throw new Error(`Ruta absoluta rechazada: ${JSON.stringify(relative)}`);
  const trimmed = relative.endsWith('/') ? relative.slice(0, -1) : relative;
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\\:\0]/.test(segment))) {
    throw new Error(`Ruta fuera del puente rechazada: ${JSON.stringify(relative)}`);
  }
  const target = resolve(root, ...segments);
  const inside = relativePath(root, target);
  // Escapa solo «..» exacto o «..» seguido del separador; «...txt» es un nombre válido dentro de root.
  const escapes = inside === '..' || inside.startsWith(`..${sep}`);
  if (inside === '' || escapes || isAbsolute(inside)) throw new Error(`Ruta fuera de la carpeta rechazada: ${JSON.stringify(relative)}`);
  return target;
}

async function useDiskFolder(page: Page, root: string) {
  mkdirSync(root, { recursive: true });
  await page.exposeFunction('__disk', (operation: string, relative: unknown, bytes?: number[]) => {
    const target = confinedPath(root, relative);
    switch (operation) {
      case 'isDir': return existsSync(target) && statSync(target).isDirectory();
      case 'isFile': return existsSync(target) && statSync(target).isFile();
      case 'mkdir': mkdirSync(target, { recursive: true }); return true;
      case 'read': return Array.from(readFileSync(target));
      case 'write': writeFileSync(target, Uint8Array.from(bytes ?? [])); return true;
      // unlinkSync: en esta máquina, rmSync recursivo dejó un archivo bajo una ruta con acento (ver changelog).
      case 'remove': if (!existsSync(target)) return false; unlinkSync(target); return true;
      case 'list': return readdirSync(target, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? 'directory' : 'file']);
      default: throw new Error(`Operación desconocida: ${operation}`);
    }
  });
  await page.addInitScript({ content: diskBridge });
}

/** Rutas relativas de todos los archivos bajo una carpeta, con separador «/». */
function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  }).sort();
}

test('carpeta física en disco: nota, edición rápida, cierre inmediato, recarga y reconexión', async ({ page }, testInfo) => {
  const notes = testInfo.outputPath('notes');
  await useDiskFolder(page, notes);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');

  await page.getByRole('button', { name: 'Abrir una carpeta', exact: true }).click();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  await page.getByLabel('Nombre del nuevo espacio').fill('prueba');
  await page.getByRole('button', { name: 'Crear un espacio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'prueba', exact: true })).toBeVisible();
  expect(filesUnder(notes)).toEqual(['prueba/.nouty/layout.yaml', 'prueba/.nouty/relations.yaml', 'prueba/.nouty/workspace.yaml']);

  // Añadir una nota, editar su título y cerrar el editor sin esperar al autoguardado.
  await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  await page.getByTestId('card-tarjeta-1').click();
  await page.getByLabel('Título de la tarjeta').fill('Nota en disco');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');

  // Bytes reales: documento de la tarjeta con el título editado y sin temporales ni marcadores.
  const card = join(notes, 'prueba', 'cards', 'tarjeta-1.md');
  expect(readFileSync(card, 'utf8')).toContain('title: Nota en disco');
  expect(filesUnder(notes)).toEqual([
    'prueba/.nouty/layout.yaml', 'prueba/.nouty/relations.yaml', 'prueba/.nouty/workspace.yaml',
    'prueba/boards/principal.md', 'prueba/cards/tarjeta-1.md',
  ]);
  await page.screenshot({ path: testInfo.outputPath('disk-saved.png') });

  // Recargar pierde la conexión; volver a elegir la misma carpeta la recupera con la nota editada.
  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir prueba', exact: true }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota en disco');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('disk-reconnected.png') });
});

test('el puente de disco rechaza rutas que escapan de la carpeta de la prueba', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'El confinamiento no depende del viewport.');
  const notes = testInfo.outputPath('notes');
  const outside = testInfo.outputPath('victima.txt');
  writeFileSync(outside, 'intacto');
  await useDiskFolder(page, notes);
  await page.goto('./');
  // Barra invertida real (código 92): un literal con una sola barra la convertía en otro carácter.
  const backslash = String.fromCharCode(92);
  const hostile = ['../fuera.txt', `..${backslash}fuera.txt`, `sub${backslash}..${backslash}..${backslash}fuera.txt`, 'a/../../fuera.txt', '/fuera.txt', 'C:/fuera.txt', `${testInfo.outputPath('fuera.txt')}`, 'a/./b.txt', 'a//b.txt'];
  for (const path of hostile) {
    for (const operation of ['write', 'read', 'isFile', 'isDir', 'mkdir', 'list']) {
      const outcome = await page.evaluate(async ([op, target]) => {
        try { await (window as unknown as { __disk: (...args: unknown[]) => Promise<unknown> }).__disk(op, target, [120]); return 'aceptada'; }
        catch { return 'rechazada'; }
      }, [operation, path] as const);
      expect(`${operation} ${path}: ${outcome}`).toBe(`${operation} ${path}: rechazada`);
    }
  }
  const removed = await page.evaluate(async () => {
    try { await (window as unknown as { __disk: (...args: unknown[]) => Promise<unknown> }).__disk('remove', '../victima.txt'); return 'aceptada'; }
    catch { return 'rechazada'; }
  });
  expect(removed).toBe('rechazada');
  expect(readFileSync(outside, 'utf8')).toBe('intacto');
  expect(existsSync(testInfo.outputPath('fuera.txt'))).toBe(false);
  expect(existsSync(testInfo.outputPath('a'))).toBe(false);
  expect(filesUnder(notes)).toEqual([]);
});

test('el puente de disco: raíz vacía para listar, «/» rechazada y nombres que empiezan por «..» válidos', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'El confinamiento no depende del viewport.');
  const notes = testInfo.outputPath('notes');
  await useDiskFolder(page, notes);
  await page.goto('./');
  const call = (operation: string, path: string, bytes?: number[]) => page.evaluate(async ([op, target, data]) => {
    try { return { ok: true, value: await (window as unknown as { __disk: (...args: unknown[]) => Promise<unknown> }).__disk(op, target, data) }; }
    catch { return { ok: false, value: null }; }
  }, [operation, path, bytes] as const);

  // La ruta vacía es la raíz de la carpeta de la prueba; «/» es absoluta y se rechaza.
  expect(await call('list', '')).toEqual({ ok: true, value: [] });
  for (const operation of ['list', 'isDir', 'mkdir', 'write', 'read']) {
    expect(`${operation} /: ${(await call(operation, '/', [1])).ok}`).toBe(`${operation} /: false`);
  }

  // Nombres válidos dentro de notes aunque empiecen por dos puntos.
  for (const name of ['...txt', '..nota.md', 'sub/..oculto']) {
    expect(`write ${name}: ${(await call('mkdir', name.includes('/') ? 'sub/' : '')).ok && (await call('write', name, [111, 107])).ok}`).toBe(`write ${name}: true`);
    expect(await call('read', name)).toEqual({ ok: true, value: [111, 107] });
  }
  expect(filesUnder(notes)).toEqual(['...txt', '..nota.md', 'sub/..oculto']);
  expect((await call('list', '')).value).toEqual(expect.arrayContaining([['...txt', 'file'], ['..nota.md', 'file'], ['sub', 'directory']]));
});
