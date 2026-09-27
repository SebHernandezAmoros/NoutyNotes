import { describe, expect, it } from 'vitest';

import {
  addAssetToBoard, addNoteImage, addCardToBoard, buildAssetCatalog, createEmptyWorkspaceNamed, deleteUnusedAssets, editCardContent, importAssetImage,
  importImageCard, noteImageRefs, removeNoteBlock, replaceAsset,
} from '../../packages/application/src/index';
import type { WorkspaceAssets, WorkspaceStorage, WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

type Both = WorkspaceStorage & WorkspaceAssets;
const stores: readonly [string, () => { storage: Both; put?: (path: string, bytes: Uint8Array) => void }][] = [
  ['ZIP/memoria', () => ({ storage: new ArchiveStorage() })],
  ['carpeta (SAF)', () => {
    const tree = new MemoryDocumentTree();
    return { storage: new FolderStorage(new DocumentTreeFolderPort(tree)), put: (path, bytes) => tree.put(path, bytes) };
  }],
];

describe.each(stores)('biblioteca de assets en %s (ADR 0022)', (_name, make) => {
  it('lista lo que hay bajo assets/ (también lo que nada usa) y el catálogo lo cruza con las tarjetas', async () => {
    const { storage, put } = make();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Galería'));
    ok(await importImageCard(storage, storage, id, { bytes: PNG, fileName: 'portada.png' }));
    const imported = ok(await importAssetImage(storage, storage, id, { bytes: JPEG, fileName: 'Plano del Río.jpg' }));
    expect(imported).toBe('assets/images/plano-del-rio.jpg');
    // Un archivo de otra herramienta dentro de la carpeta (solo en carpeta: el ZIP se importa entero).
    put?.('galeria/assets/files/guion.pdf', Uint8Array.from([37, 80, 68, 70]));
    const listed = ok(await storage.listAssets(id));
    expect([...listed].sort()).toEqual([...(put ? ['assets/files/guion.pdf'] : []), 'assets/images/plano-del-rio.jpg', 'assets/images/tarjeta-1.png']);
    const catalog = buildAssetCatalog(ok(await storage.open(id)), listed);
    expect(catalog.filter((entry) => entry.unused).map((entry) => entry.ref)).toEqual([...(put ? ['assets/files/guion.pdf'] : []), 'assets/images/plano-del-rio.jpg']);
    // Un nombre ya usado no se sobrescribe.
    expect(ok(await importAssetImage(storage, storage, id, { bytes: PNG, fileName: 'plano del rio.png' }))).toBe('assets/images/plano-del-rio.png');
    expect(ok(await importAssetImage(storage, storage, id, { bytes: JPEG, fileName: 'Plano del Río.jpg' }))).toBe('assets/images/plano-del-rio-2.jpg');
  });

  it('añadir al tablero reutiliza el archivo; reemplazar cambia todas las referencias en una transacción; eliminar solo lo sin usar', async () => {
    const { storage } = make();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Galería'));
    const ref = ok(await importAssetImage(storage, storage, id, { bytes: PNG, fileName: 'mapa.png' }));
    const cardId = ok(await addAssetToBoard(storage, id, { ref }));
    const note = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Ruta' }));
    ok(await editCardContent(storage, id, note, { content: `Ida.\n\n![mapa](${ref})` }));
    const opened = ok(await storage.open(id));
    expect(opened.cards.find((card) => card.id === cardId)).toMatchObject({ assetRefs: [ref], title: 'mapa' });
    expect(ok(await storage.listAssets(id))).toEqual([ref]);

    const replaced = ok(await replaceAsset(storage, storage, id, { from: ref, bytes: JPEG, fileName: 'mapa nuevo.jpg' }));
    expect(replaced).toBe('assets/images/mapa-nuevo.jpg');
    const after = ok(await storage.open(id));
    expect(after.cards.find((card) => card.id === cardId)?.assetRefs).toEqual([replaced]);
    expect(noteImageRefs(after.cards.find((card) => card.id === note)?.content ?? '')).toEqual([replaced]);
    expect(ok(await storage.readAsset(id, replaced as AssetRef))).toEqual(JPEG);
    // El anterior queda sin usar, intacto; eliminar lo en uso no se permite.
    expect(ok(await storage.readAsset(id, ref as AssetRef))).toEqual(PNG);
    const refused = ok(await deleteUnusedAssets(storage, storage, id, [ref, replaced]));
    expect(refused).toEqual({ removed: [ref], inUse: [replaced], failed: [] });
    expect((await storage.readAsset(id, ref as AssetRef)).ok).toBe(false);
    expect((await storage.readAsset(id, replaced as AssetRef)).ok).toBe(true);
  });

  it('reemplazar con un archivo que no es imagen no escribe nada; si no se guarda, se retira el nuevo', async () => {
    const { storage } = make();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Galería'));
    const note = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Ruta' }));
    const { ref } = ok(await addNoteImage(storage, storage, id, note, { bytes: PNG, fileName: 'a.png', content: 'Ida.', place: { kind: 'insert' } }));
    const invalid = await replaceAsset(storage, storage, id, { from: ref, bytes: new TextEncoder().encode('hola'), fileName: 'x.png' });
    expect(invalid.ok ? null : invalid.issues[0]?.code).toBe('invalid-asset');
    const missing = await replaceAsset(storage, storage, 'no-existe' as WorkspaceId, { from: ref, bytes: JPEG, fileName: 'b.jpg' });
    expect(missing.ok).toBe(false);
    expect([...ok(await storage.listAssets(id))]).toEqual([ref]);
    // Quitar la imagen de la nota la deja sin usar; «eliminar los sin usar» la borra.
    const content = ok(await storage.open(id)).cards[0]?.content ?? '';
    ok(await editCardContent(storage, id, note, { content: removeNoteBlock(content, 1) }));
    expect(ok(await deleteUnusedAssets(storage, storage, id, [ref])).removed).toEqual([ref]);
  });
});
