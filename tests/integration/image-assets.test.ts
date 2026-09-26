import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_BYTES, createEmptyWorkspaceNamed, importImageCard, inspectImage, moveCardToTrash, purgeCardFromTrash,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, BoardId, CardId } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage, readWorkspaceArchive } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const WEBP = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
const GIF = new TextEncoder().encode('GIF89a...');

describe('validación de imágenes por firma (ADR 0015)', () => {
  it('reconoce PNG, JPEG, GIF y WebP por su contenido y rechaza el resto, vacíos y demasiado grandes', () => {
    expect([PNG, JPEG, GIF, WEBP].map((bytes) => {
      const found = inspectImage(bytes);
      return found.ok ? found.value.extension : found.issues[0]?.code;
    })).toEqual(['png', 'jpg', 'gif', 'webp']);
    const text = inspectImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(text.ok ? null : text.issues[0]?.code).toBe('invalid-asset');
    expect(inspectImage(new Uint8Array()).ok).toBe(false);
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(PNG);
    expect(inspectImage(huge).ok).toBe(false);
  });
});

describe('importar una imagen real como tarjeta (ADR 0015)', () => {
  it('ZIP/memoria: copia el binario, crea la tarjeta con su asset y el ZIP exportado lo contiene', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Fotos'));
    const cardId = ok(await importImageCard(storage, storage, id, { bytes: PNG, fileName: 'Costa  norte.PNG' }));
    const workspace = ok(await storage.open(id));
    const created = workspace.cards.find((card) => card.id === cardId);
    expect(created).toMatchObject({ title: 'Costa  norte', typeId: 'imagen', assetRefs: ['assets/images/tarjeta-1.png'] });
    expect(ok(await storage.readAsset(id, 'assets/images/tarjeta-1.png' as AssetRef))).toEqual(PNG);
    expect(storage.unexportedIds()).toContain(id);
    const archive = readWorkspaceArchive(ok(storage.exportArchive(id)).bytes);
    expect(archive.ok && archive.value.assets['assets/images/tarjeta-1.png']).toEqual(PNG);
  });

  it('un formato inválido no escribe nada; si guardar la tarjeta falla, se borra el asset recién escrito', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Fotos'));
    const invalid = await importImageCard(storage, storage, id, { bytes: new TextEncoder().encode('hola'), fileName: 'nota.png' });
    expect(invalid.ok ? null : invalid.issues[0]?.code).toBe('invalid-asset');
    // Tablero inexistente: el asset llega a escribirse, la tarjeta no, y el asset se retira.
    const failed = await importImageCard(storage, storage, id, { bytes: PNG, fileName: 'a.png', boardId: 'no-existe' as BoardId });
    expect(failed.ok).toBe(false);
    const leftover = await storage.readAsset(id, 'assets/images/tarjeta-1.png' as AssetRef);
    expect(leftover.ok).toBe(false);
    expect(ok(await storage.open(id)).cards).toEqual([]);
  });

  it('carpeta: escribe bajo assets/images sin sobrescribir; eliminar definitivamente borra solo el asset liberado', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Fotos'));
    // Un archivo del usuario ocupa ya la ruta que tocaría: se usa otra y el suyo no cambia.
    tree.put('fotos/assets/images/tarjeta-1.jpg', Uint8Array.from([7, 7, 7]));
    const cardId = ok(await importImageCard(storage, storage, id, { bytes: JPEG, fileName: 'foto.jpg' }));
    const files = tree.snapshot();
    expect(files['fotos/assets/images/tarjeta-1.jpg']).toEqual(Uint8Array.from([7, 7, 7]));
    expect(files['fotos/assets/images/tarjeta-1-2.jpg']).toEqual(JPEG);
    // Reabrir en otra sesión muestra la misma tarjeta y el mismo binario.
    const reopened = new FolderStorage(new DocumentTreeFolderPort(tree));
    expect(ok(await reopened.open(id)).cards[0]?.assetRefs).toEqual(['assets/images/tarjeta-1-2.jpg']);
    ok(await moveCardToTrash(reopened, id, cardId as CardId));
    expect(tree.snapshot()['fotos/assets/images/tarjeta-1-2.jpg']).toEqual(JPEG);
    const purged = ok(await purgeCardFromTrash(reopened, reopened, id, cardId as CardId));
    expect(purged).toEqual({ releasedAssets: ['assets/images/tarjeta-1-2.jpg'], removedAssets: ['assets/images/tarjeta-1-2.jpg'], failedAssets: [] });
    expect(Object.keys(tree.snapshot())).not.toContain('fotos/assets/images/tarjeta-1-2.jpg');
    expect(tree.snapshot()['fotos/assets/images/tarjeta-1.jpg']).toEqual(Uint8Array.from([7, 7, 7]));
  });
});

