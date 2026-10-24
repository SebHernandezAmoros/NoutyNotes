import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { insertFromMenu, openFullCardEditor, openMore, openSettings } from './support';

async function openFolderProject(page: Page, name: string) {
  // Solo sustituye el selector: los handles, bytes e IndexedDB son reales (OPFS, no carpeta externa).
  await page.addInitScript(() => {
    Object.assign(window, { showDirectoryPicker: async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('f5-projects', { create: true });
    } });
    if (location.pathname.includes('/workspace')) {
      const bad: string[] = [];
      Object.assign(window, { __f5Bad: bad });
      new MutationObserver(() => {
        for (const id of ['workspace-missing', 'home-screen']) {
          if (document.querySelector(`[data-testid="${id}"]`)) bad.push(id);
        }
      }).observe(document, { childList: true, subtree: true });
    }
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
  await page.getByLabel('Nombre del proyecto').fill(name);
  await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function filesOfProject(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('f5-projects');
    const result: Record<string, string> = {};
    const walk = async (folder: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, entry] of folder.entries()) {
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else result[`${prefix}${name}`] = await (await (entry as FileSystemFileHandle).getFile()).text();
      }
    };
    await walk(directory, '');
    return result;
  });
}

async function privateDrafts(page: Page) {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('noutynotes-private-drafts', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('snapshots', 'readonly');
      const read = tx.objectStore('snapshots').get('editorial-v1');
      read.onsuccess = () => resolve(typeof read.result === 'string' ? read.result : null);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
    request.onerror = () => reject(request.error);
  }));
}

test('F5 PW-01: restaura la carpeta antes de montar el editor sobre memoria vacía', async ({ page }, testInfo) => {
  await openFolderProject(page, 'F5 continuidad');
  const before = page.url();
  const files = await filesOfProject(page);
  await page.reload();
  if (process.env.F5_EVIDENCE_STAGE === 'red') await page.screenshot({ path: `artifacts/recovery-f5/red-${testInfo.project.name}.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: 'F5 continuidad', exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.getByTestId('workspace-missing')).toHaveCount(0);
  await expect(page.getByTestId('workspace-memory')).toContainText('CARPETA LOCAL');
  expect(page.url()).toBe(before);
  expect(await filesOfProject(page)).toEqual(files);
  expect(await page.evaluate(() => (window as typeof window & { __f5Bad: string[] }).__f5Bad)).toEqual([]);
  await page.screenshot({ path: `artifacts/recovery-f5/green-${testInfo.project.name}.png`, fullPage: true });
  // Journal controlado de la fixture OPFS: nunca archivos ni corrupción del proyecto del usuario.
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('f5-projects');
    const folder = await root.getDirectoryHandle('f5-continuidad');
    const file = await folder.getFileHandle('.nouty-transaction.json', { create: true });
    const writer = await file.createWritable();
    await writer.write(JSON.stringify({ version: 1, committed: true, old: {} }));
    await writer.close();
  });
  const interrupted = await filesOfProject(page);
  await page.reload();
  await expect(page.getByTestId('workspace-resume')).toContainText('Hay una transacción pendiente');
  await expect(page.getByTestId('workspace-screen')).toHaveCount(0);
  expect(await filesOfProject(page)).toEqual(interrupted);
  await page.screenshot({ path: `artifacts/recovery-f5/recovery-required-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir el proyecto F5 continuidad', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'F5 continuidad', exact: true })).toBeVisible();
  expect(await filesOfProject(page)).toEqual(files); // recuperación existente solo tras apertura explícita
});

test('F5 PW-02: cambiar a B y cerrar voluntariamente no reabre A ni B', async ({ page }) => {
  await openFolderProject(page, 'F5 proyecto A');
  await openMore(page);
  await page.getByRole('button', { name: 'Cambiar de proyecto', exact: true }).click();
  await page.getByTestId('project-sheet-new').click();
  await page.getByTestId('project-sheet-create-form').getByRole('textbox').fill('F5 proyecto B');
  await page.getByTestId('project-sheet-create-confirm').click();
  await expect(page.getByRole('heading', { name: 'F5 proyecto B', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'F5 proyecto B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios', exact: true }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('noutynotes.session-resume.v1'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('workspace-screen')).toHaveCount(0);
});

test('F5 PW-03: permiso dirigido por teclado, rechazo y borrador protegido sin escritura automática', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'desktop' ? 'dark' : 'light' });
  // Solo este escenario simula permisos. Handles/IndexedDB/archivos continúan siendo nativos OPFS.
  await page.addInitScript(() => {
    const prototype = FileSystemDirectoryHandle.prototype as FileSystemDirectoryHandle & {
      queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
      requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
    };
    const query = prototype.queryPermission;
    prototype.queryPermission = async function(options) {
      const permission = localStorage.getItem('f5-permission');
      return permission ? permission as PermissionState : query.call(this, options);
    };
    prototype.requestPermission = async function() {
      const state = window as typeof window & { __f5PermissionRequests?: number };
      state.__f5PermissionRequests = (state.__f5PermissionRequests ?? 0) + 1;
      const next = localStorage.getItem('f5-next-permission') ?? 'denied';
      localStorage.setItem('f5-permission', next);
      return next as PermissionState;
    };
  });
  await openFolderProject(page, 'F5 borrador');
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.evaluate(() => localStorage.setItem('f5-permission', 'prompt'));
  await page.getByLabel('Contenido visual').fill('F5 BORRADOR PROTEGIDO');
  await expect.poll(async () => (await privateDrafts(page))?.includes('F5 BORRADOR PROTEGIDO')).toBe(true);
  const snapshot = await privateDrafts(page);
  const files = await filesOfProject(page);
  await page.reload();
  const reconnect = page.getByRole('button', { name: 'Reconectar proyecto', exact: true });
  await expect(reconnect).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __f5PermissionRequests?: number }).__f5PermissionRequests ?? 0)).toBe(0);
  expect(await privateDrafts(page)).toBe(snapshot);
  await reconnect.focus();
  await page.keyboard.press('Enter');
  await expect(reconnect).toBeVisible(); // denegación no instala otro proyecto
  await expect(page.getByTestId('workspace-screen')).toHaveCount(0);
  expect(await filesOfProject(page)).toEqual(files);
  expect(await privateDrafts(page)).toBe(snapshot);
  await page.screenshot({ path: `artifacts/recovery-f5/reconnect-${testInfo.project.name}.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem('f5-next-permission', 'granted'));
  await reconnect.click();
  await expect(page.getByRole('heading', { name: 'F5 borrador', exact: true })).toBeVisible();
  expect(await filesOfProject(page)).toEqual(files);
  expect(await privateDrafts(page)).toBe(snapshot);
  await openSettings(page);
  await page.getByTestId('settings-open-recovery').click();
  await expect(page.getByTestId('recovery-preview-tarjeta-1')).toContainText('F5 BORRADOR PROTEGIDO');
  await page.screenshot({ path: `artifacts/recovery-f5/draft-${testInfo.project.name}.png`, fullPage: true });
});

test('F5 PW-04: dos pestañas independientes e intención copiada desde opener', async ({ page, context }) => {
  await openFolderProject(page, 'F5 pestaña A');
  const originalUrl = page.url();
  const originalIntent = await page.evaluate(() => sessionStorage.getItem('noutynotes.session-resume.v1'));
  await context.addInitScript(() => {
    Object.assign(window, { __f5InitialIntent: sessionStorage.getItem('noutynotes.session-resume.v1') });
  });
  const opened = context.waitForEvent('page');
  await page.evaluate(() => { window.open(location.href, '_blank'); });
  const other = await opened;
  await expect(other.getByTestId('workspace-missing')).toBeVisible();
  expect(await other.evaluate(() => (window as typeof window & { __f5InitialIntent: string }).__f5InitialIntent)).toBe(originalIntent);
  expect(await other.evaluate(() => sessionStorage.getItem('noutynotes.session-resume.v1'))).toBeNull();
  await openFolderProject(other, 'F5 pestaña B');
  const otherUrl = other.url();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'F5 pestaña A', exact: true })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  expect(other.url()).toBe(otherUrl);
  await other.reload();
  await expect(other.getByRole('heading', { name: 'F5 pestaña B', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('noutynotes.session-resume.v1'))).toBe(originalIntent);
});
