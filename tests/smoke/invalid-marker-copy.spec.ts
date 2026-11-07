import { expect, test } from '@playwright/test';

import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';

test('marcador truncado: evidencia verificada antes de abrir una copia; fuente intacta', async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const workspace = { ...validWorkspace(), metadata: { name: 'Laboratorio marcador' } };
  const serialized = serializeWorkspace(workspace);
  if (!serialized.ok) throw new Error('Fixture inválido');
  const marker = '{"version":1,"committed":fal';
  await page.evaluate(async ({ files, marker }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('marker-copy-lab', { create: true });
    const write = async (path: string, content: string | Uint8Array) => {
      const parts = path.split('/'); const name = parts.pop()!; let directory = root;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
      await writable.write(typeof content === 'string' ? content : Uint8Array.from(content)); await writable.close();
    };
    for (const [path, text] of Object.entries(files)) await write(path, text);
    await write('assets/images/a.png', new Uint8Array([0, 255, 8]));
    await write('.nouty-transaction.json', marker);
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  }, { files: serialized.value, marker });

  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await expect(page.getByTestId('folder-prepare-marker-copy')).toBeVisible();
  await page.getByTestId('folder-prepare-marker-copy').click();
  await expect(page.getByTestId('marker-copy-summary')).toContainText('2 tableros');
  await expect(page.getByTestId('marker-copy-open')).toBeDisabled();
  await expect(page.getByTestId('marker-repair-confirm')).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('marker-copy-review.png') });
  await page.getByTestId('marker-recovery-dialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('marker-recovery-dialog')).not.toBeVisible();
  await page.getByTestId('folder-prepare-marker-copy').click();
  await expect(page.getByTestId('marker-copy-open')).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('marker-copy-export-evidence').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('nouty-recovery-evidence.zip');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('marker-copy-verify-evidence').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'incorrecto.zip', mimeType: 'application/zip', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByTestId('marker-copy-error')).toBeVisible();
  await expect(page.getByTestId('marker-copy-open')).toBeDisabled();
  const correctChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('marker-copy-verify-evidence').click();
  await (await correctChooserPromise).setFiles(await download.path()!);
  await expect(page.getByTestId('marker-copy-evidence-verified')).toBeVisible();
  await expect(page.getByTestId('marker-copy-open')).toBeDisabled();
  await page.getByTestId('marker-copy-acknowledge').click();
  await page.getByTestId('marker-copy-open').click();
  await expect(page.getByRole('heading', { name: 'Laboratorio marcador — Recuperado' })).toBeVisible();
  const original = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('marker-copy-lab');
    const marker = await (await root.getFileHandle('.nouty-transaction.json')).getFile();
    const manifest = await (await (await root.getDirectoryHandle('.nouty')).getFileHandle('workspace.yaml')).getFile();
    const asset = await (await (await root.getDirectoryHandle('assets')).getDirectoryHandle('images')).getFileHandle('a.png');
    return { marker: await marker.text(), manifest: await manifest.text(), asset: [...new Uint8Array(await (await asset.getFile()).arrayBuffer())] };
  });
  expect(original.marker).toBe(marker);
  expect(original.manifest).toBe(serialized.value['.nouty/workspace.yaml']);
  expect(original.asset).toEqual([0, 255, 8]);
});

test('marcador inválido: respaldo externo verificado y acceso a la carpeta original', async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const workspace = { ...validWorkspace(), metadata: { name: 'Laboratorio reparado' } };
  const serialized = serializeWorkspace(workspace);
  if (!serialized.ok) throw new Error('Fixture inválido');
  await page.evaluate(async ({ files }) => {
    const opfs = await navigator.storage.getDirectory();
    const source = await opfs.getDirectoryHandle('marker-repair-lab', { create: true });
    const backupDir = await opfs.getDirectoryHandle('external-backups', { create: true });
    const occupied = await (await backupDir.getFileHandle('evidence.zip', { create: true })).createWritable();
    await occupied.write(Uint8Array.from([42])); await occupied.close();
    for (const [path, text] of Object.entries(files)) {
      const segments = path.split('/'); const name = segments.pop()!; let parent = source;
      for (const segment of segments) parent = await parent.getDirectoryHandle(segment, { create: true });
      const writer = await (await parent.getFileHandle(name, { create: true })).createWritable();
      await writer.write(text); await writer.close();
    }
    const assetDir = await source.getDirectoryHandle('assets', { create: true });
    const imageDir = await assetDir.getDirectoryHandle('images', { create: true });
    const assetWriter = await (await imageDir.getFileHandle('a.png', { create: true })).createWritable();
    await assetWriter.write(Uint8Array.from([0, 255, 8])); await assetWriter.close();
    const markerWriter = await (await source.getFileHandle('.nouty-transaction.json', { create: true })).createWritable();
    await markerWriter.write('{"version":1,"committed":fal'); await markerWriter.close();
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => source });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true,
      value: async () => backupDir.getFileHandle('evidence.zip', { create: true }) });
  }, { files: serialized.value });
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await page.getByTestId('folder-prepare-marker-copy').click();
  await expect(page.getByTestId('marker-repair-confirm')).toBeDisabled();
  await page.getByTestId('marker-repair-backup').click();
  await expect(page.getByTestId('marker-copy-error')).toContainText('ya contiene datos');
  expect(await page.evaluate(async () => {
    const backupDir = await (await navigator.storage.getDirectory()).getDirectoryHandle('external-backups');
    return [...new Uint8Array(await (await (await backupDir.getFileHandle('evidence.zip')).getFile()).arrayBuffer())];
  })).toEqual([42]);
  await page.evaluate(async () => {
    const backupDir = await (await navigator.storage.getDirectory()).getDirectoryHandle('external-backups');
    await backupDir.removeEntry('evidence.zip');
  });
  await page.getByTestId('marker-repair-backup').click();
  await expect(page.getByTestId('marker-repair-backup-verified')).toBeVisible();
  expect(await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('marker-repair-lab');
    return (await (await root.getFileHandle('.nouty-transaction.json')).getFile()).size > 0;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('marker-repair-ready.png') });
  await page.getByTestId('marker-repair-acknowledge').click();
  await page.getByTestId('marker-repair-confirm').click();
  await expect(page.getByRole('heading', { name: 'Laboratorio reparado' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('marker-repair-opened.png') });
  const actual = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('marker-repair-lab');
    let markerPresent = true;
    try { await root.getFileHandle('.nouty-transaction.json'); } catch { markerPresent = false; }
    const manifest = await (await (await root.getDirectoryHandle('.nouty')).getFileHandle('workspace.yaml')).getFile();
    const image = await (await (await root.getDirectoryHandle('assets')).getDirectoryHandle('images')).getFileHandle('a.png');
    const backup = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('external-backups')).getFileHandle('evidence.zip');
    return { markerPresent, manifest: await manifest.text(), asset: [...new Uint8Array(await (await image.getFile()).arrayBuffer())], backupSize: (await backup.getFile()).size };
  });
  expect(actual.markerPresent).toBe(false);
  expect(actual.manifest).toBe(serialized.value['.nouty/workspace.yaml']);
  expect(actual.asset).toEqual([0, 255, 8]);
  expect(actual.backupSize).toBeGreaterThan(0);
});
