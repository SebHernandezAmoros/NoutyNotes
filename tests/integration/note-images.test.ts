import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, addNoteImage, createEmptyWorkspaceNamed, editCardContent, moveCardToTrash, noteImageRefs, purgeCardFromTrash, removeNoteBlock,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, CardId } from '../../packages/domain/src/index';
import { ArchiveStorage, readWorkspaceArchive } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

async function noteWithText() {
  const storage = new ArchiveStorage();
  const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Viaje'));
  const card = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Diario' }));
  ok(await editCardContent(storage, id, card, { content: 'Llegada.\n\nTemplos y <script>alert(1)</script> jardines.' }));
  return { storage, id, card };
}
const cardOf = async (storage: ArchiveStorage, id: Parameters<ArchiveStorage['open']>[0], card: CardId) =>
  ok(await storage.open(id)).cards.find((candidate) => candidate.id === card)!;

describe('imágenes ordenadas dentro de una nota (ADR 0021)', () => {
  it('insertar escribe el asset, pone la línea tras el párrafo del cursor y la añade a assetRefs; el borrador se respeta', async () => {
    const { storage, id, card } = await noteWithText();
    // El borrador (aún sin guardar) ya tiene un cambio: se conserva al insertar.
    const draft = 'Llegada al templo.\n\nTemplos y <script>alert(1)</script> jardines.';
    const first = ok(await addNoteImage(storage, storage, id, card, { bytes: PNG, fileName: 'Pagoda.png', content: draft, place: { kind: 'insert', caret: 3 } }));
    expect(first.ref).toBe('assets/images/tarjeta-1-1.png');
    expect(first.content).toBe('Llegada al templo.\n\n![Pagoda](assets/images/tarjeta-1-1.png)\n\nTemplos y <script>alert(1)</script> jardines.');
    const second = ok(await addNoteImage(storage, storage, id, card, { bytes: JPEG, fileName: 'río.jpg', content: first.content, place: { kind: 'insert' } }));
    expect(noteImageRefs(second.content)).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
    const saved = await cardOf(storage, id, card);
    expect(saved.content).toBe(second.content);
    expect(saved.assetRefs).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
    expect(ok(await storage.readAsset(id, 'assets/images/tarjeta-1-2.jpg' as AssetRef))).toEqual(JPEG);
    // El ZIP lleva el texto con las imágenes en su sitio y los dos binarios.
    const archive = readWorkspaceArchive(ok(storage.exportArchive(id)).bytes);
    if (!archive.ok) throw new Error('ZIP inválido');
    expect(archive.value.files[`cards/${card}.md`]).toContain('![Pagoda](assets/images/tarjeta-1-1.png)\n\nTemplos');
    expect(Object.keys(archive.value.assets).sort()).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
  });

  it('reemplazar escribe otro asset en la misma posición; quitar la línea la saca de assetRefs sin borrar el archivo', async () => {
    const { storage, id, card } = await noteWithText();
    const inserted = ok(await addNoteImage(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', content: 'Llegada.', place: { kind: 'insert' } }));
    const replaced = ok(await addNoteImage(storage, storage, id, card, { bytes: JPEG, fileName: 'b.jpg', content: inserted.content, place: { kind: 'replace', index: 1 } }));
    expect(noteImageRefs(replaced.content)).toEqual(['assets/images/tarjeta-1-2.jpg']);
    expect((await cardOf(storage, id, card)).assetRefs).toEqual(['assets/images/tarjeta-1-2.jpg']);
    // El archivo reemplazado sigue en disco (ADR 0021, decisión 4).
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-1.png' as AssetRef)).ok).toBe(true);
    ok(await editCardContent(storage, id, card, { content: removeNoteBlock(replaced.content, 1) }));
    expect((await cardOf(storage, id, card)).assetRefs).toBeUndefined();
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-2.jpg' as AssetRef)).ok).toBe(true);
  });

  it('un formato inválido no escribe nada; si la nota no se guarda, se retira el asset recién escrito', async () => {
    const { storage, id, card } = await noteWithText();
    const invalid = await addNoteImage(storage, storage, id, card, { bytes: new TextEncoder().encode('hola'), fileName: 'x.png', content: '', place: { kind: 'insert' } });
    expect(invalid.ok ? null : invalid.issues[0]?.code).toBe('invalid-asset');
    const missing = await addNoteImage(storage, storage, id, 'no-existe' as CardId, { bytes: PNG, fileName: 'x.png', content: '', place: { kind: 'insert' } });
    expect(missing.ok).toBe(false);
    expect((await storage.readAsset(id, 'assets/images/no-existe-1.png' as AssetRef)).ok).toBe(false);
  });

  it('purgar la nota desde la Papelera libera y borra sus imágenes', async () => {
    const { storage, id, card } = await noteWithText();
    ok(await addNoteImage(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', content: 'Llegada.', place: { kind: 'insert' } }));
    ok(await moveCardToTrash(storage, id, card));
    const purged = ok(await purgeCardFromTrash(storage, storage, id, card));
    expect(purged.removedAssets).toEqual(['assets/images/tarjeta-1-1.png']);
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-1.png' as AssetRef)).ok).toBe(false);
  });
});
