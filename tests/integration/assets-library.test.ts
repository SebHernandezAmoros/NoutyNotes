import { describe, expect, it } from 'vitest';

import {
  addAssetToBoard, addNoteImage, addCardToBoard, buildAssetCatalog, createEmptyWorkspaceNamed, deleteUnusedAssets, editCardContent, importAssetImage,
  importImageCard, importLibraryFile, importLibraryFont, noteImageRefs, removeNoteBlock, replaceAsset,
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

  it('importar documento y audio a la biblioteca (ADR 0038): carpeta por tipo, nombre portable, sin sobrescribir; se rechaza lo que no es ninguno de los dos o supera el límite', async () => {
    const { storage } = make();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Galería'));
    const pdfBytes = Uint8Array.from([37, 80, 68, 70, 1, 2, 3]);
    const doc = ok(await importLibraryFile(storage, storage, id, { bytes: pdfBytes, fileName: 'Guion Final.pdf' }));
    expect(doc).toBe('assets/documents/guion-final.pdf');
    expect(ok(await storage.readAsset(id, doc as AssetRef))).toEqual(pdfBytes);
    // No sobrescribe: el mismo nombre base numera.
    expect(ok(await importLibraryFile(storage, storage, id, { bytes: pdfBytes, fileName: 'Guion Final.pdf' }))).toBe('assets/documents/guion-final-2.pdf');

    const audioBytes = Uint8Array.from([73, 68, 51, 1, 2]);
    const audio = ok(await importLibraryFile(storage, storage, id, { bytes: audioBytes, fileName: 'tema.mp3' }));
    expect(audio).toBe('assets/audio/tema.mp3');

    const rejected = await importLibraryFile(storage, storage, id, { bytes: pdfBytes, fileName: 'imagen.png' });
    expect(rejected.ok ? null : rejected.issues[0]?.code).toBe('invalid-asset');
    const tooBig = await importLibraryFile(storage, storage, id, { bytes: new Uint8Array(20 * 1024 * 1024 + 1), fileName: 'grande.pdf' });
    expect(tooBig.ok ? null : tooBig.issues[0]?.code).toBe('invalid-asset');

    const catalog = buildAssetCatalog(ok(await storage.open(id)), ok(await storage.listAssets(id)));
    expect(catalog.find((entry) => entry.ref === doc)).toMatchObject({ kind: 'document', unused: true });
    expect(catalog.find((entry) => entry.ref === audio)).toMatchObject({ kind: 'audio', unused: true });
  });

  it('importar una fuente a la biblioteca (ADR 0041): carpeta assets/fonts, nombre portable, nota de licencia opcional; se rechaza lo que no es TTF/OTF o supera el límite', async () => {
    const { storage } = make();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Galería'));
    const ttfBytes = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 1, 2, 3, 4]);
    const font = ok(await importLibraryFont(storage, storage, id, { bytes: ttfBytes, fileName: 'Mi Fuente.ttf', licenseNote: 'OFL 1.1' }));
    expect(font.ref).toBe('assets/fonts/mi-fuente.ttf');
    expect(font.licenseRef).toBe('assets/fonts/mi-fuente.ttf.license.txt');
    expect(ok(await storage.readAsset(id, font.ref as AssetRef))).toEqual(ttfBytes);
    expect(new TextDecoder().decode(ok(await storage.readAsset(id, font.licenseRef as AssetRef)))).toBe('OFL 1.1');
    // Sin nota de licencia, no se escribe ningún archivo auxiliar.
    const otfBytes = Uint8Array.from([0x4f, 0x54, 0x54, 0x4f, 9, 9]);
    const noNote = ok(await importLibraryFont(storage, storage, id, { bytes: otfBytes, fileName: 'Otra.otf' }));
    expect(noNote).toEqual({ ref: 'assets/fonts/otra.otf' });
    // No sobrescribe: el mismo nombre base numera.
    expect(ok(await importLibraryFont(storage, storage, id, { bytes: ttfBytes, fileName: 'Mi Fuente.ttf' }))).toMatchObject({ ref: 'assets/fonts/mi-fuente-2.ttf' });

    const rejected = await importLibraryFont(storage, storage, id, { bytes: Uint8Array.from([1, 2, 3, 4]), fileName: 'no-es-fuente.ttf' });
    expect(rejected.ok ? null : rejected.issues[0]?.code).toBe('invalid-asset');
    const tooBig = await importLibraryFont(storage, storage, id, { bytes: new Uint8Array(10 * 1024 * 1024 + 1), fileName: 'grande.ttf' });
    expect(tooBig.ok ? null : tooBig.issues[0]?.code).toBe('invalid-asset');

    const catalog = buildAssetCatalog(ok(await storage.open(id)), ok(await storage.listAssets(id)));
    expect(catalog.find((entry) => entry.ref === font.ref)).toMatchObject({ kind: 'font', unused: true });

    // WOFF2 (ADR 0042): mismo mecanismo, es el formato que sirve Google Fonts.
    const woff2Bytes = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 5, 6, 7, 8]);
    const google = ok(await importLibraryFont(storage, storage, id, { bytes: woff2Bytes, fileName: 'Roboto.woff2' }));
    expect(google).toEqual({ ref: 'assets/fonts/roboto.woff2' });
    expect(buildAssetCatalog(ok(await storage.open(id)), ok(await storage.listAssets(id))).find((entry) => entry.ref === google.ref)?.kind).toBe('font');
  });
});
