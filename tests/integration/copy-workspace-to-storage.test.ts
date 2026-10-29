import { expect, it, vi } from 'vitest';
import { ArchiveStorage } from '../../packages/storage/src/archive-storage';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import type { AssetRef } from '../../packages/domain/src/index';
import { copyWorkspaceToStorage, verifyWorkspaceCopy } from '../../packages/application/src/copy-workspace-to-storage';
import { htmlWorkspace } from '../../packages/storage/src/__fixtures__/html-workspace';
import { writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { FolderStorage } from '../../packages/storage/src/folder-storage';
import type { WorkspaceDirectory } from '../../packages/storage/src/folder-storage';

function laboratoryFolder() {
  const directories = new Map<string, WorkspaceDirectory>();
  return new FolderStorage({ permission: async () => true, folders: async () => [...directories].map(([key, folder]) => ({ key, folder })),
    createFolder: async (key) => {
      const files = new Map<string, Uint8Array>();
      const folder: WorkspaceDirectory = { listPaths: async () => [...files.keys()], read: async path => files.get(path)?.slice(), write: async (path, bytes) => { files.set(path, bytes.slice()); }, remove: async path => { files.delete(path); } };
      directories.set(key, folder); return folder;
    },
  });
}

it('copia y verifica documento y binario sin retirar el origen', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage();
  const workspace = validWorkspace();
  await source.create(workspace);
  const ref = 'assets/unused.bin' as AssetRef; const bytes = new Uint8Array([0, 255, 17]);
  await source.writeAsset(workspace.id, ref, bytes);
  const original = await source.open(workspace.id);
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: true });
  expect(await destination.open(workspace.id)).toEqual(original);
  expect(await destination.readAsset(workspace.id, ref)).toEqual({ ok: true, value: bytes });
  expect(await source.open(workspace.id)).toEqual(original);
  expect(await source.readAsset(workspace.id, ref)).toEqual({ ok: true, value: bytes });
});

it.each(['archive', 'folder'])('conserva README y comentarios originales al copiar a %s', async (kind) => {
  const source = new ArchiveStorage(); const destination = kind === 'folder' ? laboratoryFolder() : new ArchiveStorage(); const workspace = validWorkspace();
  const serialized = serializeWorkspace(workspace); if (!serialized.ok) throw new Error('fixture');
  const card = serialized.value['cards/idea-a.md']; if (!card) throw new Error('fixture card');
  const files = { ...serialized.value, 'README.md': 'Laboratorio: conservar exactamente\r\n', 'cards/idea-a.md': card.replace('---', '---\n# comentario original') };
  const zipped = writeWorkspaceArchive(files, {}); if (!zipped.ok) throw new Error('fixture zip');
  expect(await source.importArchive(zipped.value)).toMatchObject({ ok: true });
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: true });
  const exported = await destination.exportDocuments(workspace.id); if (!exported.ok) throw new Error('export');
  expect(exported.value).toEqual(files);
});

it('reabre HTML histórico y conserva referencias de imagen y binarios usados y no usados', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = htmlWorkspace();
  await source.create(workspace);
  for (const ref of ['assets/images/a.png', 'assets/pdfs/doc.pdf', 'assets/fonts/font.ttf']) {
    await source.writeAsset(workspace.id, ref as AssetRef, new Uint8Array([0, 255, 10, 13]));
  }
  const original = await source.open(workspace.id);
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: true });
  expect(await destination.open(workspace.id)).toEqual(original);
  expect(await destination.listAssets(workspace.id)).toEqual(await source.listAssets(workspace.id));
});

it('bloquea destino ocupado antes de escribir y no elimina origen ni destino', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = validWorkspace();
  await source.create(workspace); await destination.create(workspace);
  const create = vi.spyOn(destination, 'create'); const remove = vi.spyOn(source, 'delete');
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: false, stage: 'prepare', partial: false });
  expect(create).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  expect(await destination.open(workspace.id)).toEqual(await source.open(workspace.id));
});

it('reintentar activación requiere verificar otra vez si el origen cambió después de copiar', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = validWorkspace();
  await source.create(workspace);
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: true });
  expect(await verifyWorkspaceCopy(source, destination, workspace.id)).toBe(true);
  await source.save({ ...workspace, metadata: { name: 'Edición posterior' } });
  expect(await verifyWorkspaceCopy(source, destination, workspace.id)).toBe(false);
});

it('fallo al copiar binario conserva exactamente el origen e informa copia parcial sin limpiar', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = validWorkspace();
  await source.create(workspace); await source.writeAsset(workspace.id, 'assets/a.bin' as AssetRef, new Uint8Array([5]));
  const original = await source.open(workspace.id); const remove = vi.spyOn(destination, 'delete');
  vi.spyOn(destination, 'writeAsset').mockResolvedValue({ ok: false, issues: [{ code: 'permission-denied', path: 'asset', message: 'Denied' }] });
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: false, stage: 'write', partial: true });
  expect(await source.open(workspace.id)).toEqual(original); expect(remove).not.toHaveBeenCalled();
  expect(await source.readAsset(workspace.id, 'assets/a.bin' as AssetRef)).toEqual({ ok: true, value: new Uint8Array([5]) });
});

it('no confirma persistencia si el binario releído no coincide', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = validWorkspace();
  await source.create(workspace); await source.writeAsset(workspace.id, 'assets/a.bin' as AssetRef, new Uint8Array([5]));
  vi.spyOn(destination, 'readAsset').mockResolvedValue({ ok: true, value: new Uint8Array([7]) });
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: false, stage: 'verify', partial: true });
  expect(await source.readAsset(workspace.id, 'assets/a.bin' as AssetRef)).toEqual({ ok: true, value: new Uint8Array([5]) });
});

it('no publica la candidata si el origen cambia durante la copia', async () => {
  const source = new ArchiveStorage(); const destination = new ArchiveStorage(); const workspace = validWorkspace();
  await source.create(workspace);
  const create = destination.create.bind(destination);
  vi.spyOn(destination, 'create').mockImplementation(async (snapshot) => {
    const result = await create(snapshot); await source.save({ ...workspace, metadata: { name: 'Cambio concurrente' } }); return result;
  });
  expect(await copyWorkspaceToStorage(source, destination, workspace.id)).toMatchObject({ ok: false, stage: 'verify', partial: true });
  expect(await source.open(workspace.id)).toMatchObject({ ok: true, value: { metadata: { name: 'Cambio concurrente' } } });
});
