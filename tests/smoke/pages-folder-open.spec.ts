import { expect, test } from '@playwright/test';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { fillCardTitle, openFullCardEditor } from './support';

for (const container of [false, true]) {
  test(`folder-open: handle nativo de laboratorio ${container ? 'contenedor' : 'proyecto'} conserva activación y abre sin escrituras`, async ({ page }) => {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Abrir proyecto', exact: true })).toBeEnabled();
    const workspace = { ...validWorkspace(), metadata: { name: 'Apertura laboratorio' } };
    const serialized = serializeWorkspace(workspace);
    if (!serialized.ok) throw new Error(JSON.stringify(serialized.issues));
    await page.evaluate(async ({ files, container }) => {
      // Solo OPFS privado del contexto de prueba, nunca una carpeta de Windows.
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('folder-open-lab', { create: true });
      const project = container ? await root.getDirectoryHandle('project', { create: true }) : root;
      for (const [path, value] of Object.entries(files)) {
        const segments = path.split('/'); const name = segments.pop()!; let directory = project;
        for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
        const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
        await writer.write(value); await writer.close();
      }
      Object.assign(window, { __folderOpenLab: { project, files }, __folderActivation: null });
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: function (options: { mode: string }) {
        Object.assign(window, { __folderActivation: { active: navigator.userActivation.isActive, mode: options.mode } });
        return Promise.resolve(root);
      } });
    }, { files: serialized.value, container });
    await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
    const project = page.getByRole('button', { name: 'Abrir el proyecto Apertura laboratorio', exact: true });
    await expect(project).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __folderActivation: unknown }).__folderActivation)).toEqual({ active: true, mode: 'readwrite' });
    await project.click();
    await expect(page.getByRole('heading', { name: 'Apertura laboratorio', exact: true })).toBeVisible();
    const unchanged = await page.evaluate(async () => {
      const { project, files } = (window as unknown as { __folderOpenLab: { project: FileSystemDirectoryHandle; files: Record<string, string> } }).__folderOpenLab;
      for (const [path, value] of Object.entries(files)) {
        const segments = path.split('/'); const name = segments.pop()!; let directory = project;
        for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
        if (await (await (await directory.getFileHandle(name)).getFile()).text() !== value) return false;
      }
      return true;
    });
    expect(unchanged).toBe(true);
    if (!container) {
      await openFullCardEditor(page, page.getByTestId('card-idea-a'));
      await fillCardTitle(page, 'Guardado laboratorio');
      await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
      await expect.poll(() => page.evaluate(async () => {
        const { project } = (window as unknown as { __folderOpenLab: { project: FileSystemDirectoryHandle } }).__folderOpenLab;
        return (await (await (await project.getDirectoryHandle('cards')).getFileHandle('idea-a.md')).getFile()).text();
      })).toContain('Guardado laboratorio');
    }
    // Evita un error de transporte Response/GUID del driver; se sigue esperando la recarga real.
    await Promise.all([page.waitForEvent('domcontentloaded'), page.evaluate(() => location.reload())]);
    await expect(page.getByRole('heading', { name: 'Apertura laboratorio', exact: true })).toBeVisible();
    if (!container) await expect(page.getByTestId('card-idea-a')).toContainText('Guardado laboratorio');
  });
}

test('folder-open: carpeta vacía explica raíz y contenedora sin confundirla con cancelación', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => navigator.storage.getDirectory() }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await expect(page.getByTestId('home-projects-empty')).toContainText('.nouty/workspace.yaml');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const [name, outcome] of [['AbortError', 'aborted'], ['NotAllowedError', 'denied'], ['SecurityError', 'security']] as const) {
  test(`folder-open: ${name} informa sin cancelar falsamente ni exponer datos`, async ({ page }) => {
    await page.addInitScript((name) => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
      throw new DOMException('private-directory-name', name);
    } }), name);
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
    await expect(page.getByRole('alert')).not.toContainText('No se seleccionó ninguna carpeta.');
    await expect(page.getByRole('alert')).not.toContainText('private-directory-name');
    const details = page.getByTestId('folder-open-diagnostic');
    await details.locator('summary').click();
    await expect(details).toContainText(`"exception": "${name}"`);
    await expect(details).toContainText(`"outcome": "${outcome}"`);
    await expect(details).toContainText('"handleObtained": false');
    await expect(details).toContainText('"userActivation": true');
    await expect(page.getByTestId('home-projects-empty')).toBeVisible();
  });
}

test('folder-open: handle obtenido pero proyecto inválido explica estructura sin escribir', async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Abrir proyecto', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const meta = await root.getDirectoryHandle('.nouty', { create: true });
    const writer = await (await meta.getFileHandle('workspace.yaml', { create: true })).createWritable();
    await writer.write('invalid laboratory manifest'); await writer.close();
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  });
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('.nouty/workspace.yaml');
  const details = page.getByTestId('folder-open-diagnostic'); await details.locator('summary').click();
  await expect(details).toContainText('"stage": "validation"');
  await expect(details).toContainText('"handleObtained": true');
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await (await root.getDirectoryHandle('.nouty')).getFileHandle('workspace.yaml')).getFile()).text();
  })).toBe('invalid laboratory manifest');
});
