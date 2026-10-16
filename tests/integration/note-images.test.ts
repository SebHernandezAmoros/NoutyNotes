import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, addNoteImage, addNoteImageDocument, createEmptyWorkspaceNamed, editCardContent, insertExistingNoteImage, insertExistingNoteImageDocument, moveCardToTrash, noteImageRefs, purgeCardFromTrash, removeNoteBlock,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, CardId, RichTextDocument } from '../../packages/domain/src/index';
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

function paragraph(text: string): RichTextDocument['blocks'][number] {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
async function noteWithHtmlText() {
  const storage = new ArchiveStorage();
  const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Viaje HTML'));
  const card = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Diario' }));
  const contentDocument: RichTextDocument = { schemaVersion: 1, blocks: [paragraph('Llegada.'), paragraph('Templos y jardines.')] };
  ok(await editCardContent(storage, id, card, { contentDocument }));
  return { storage, id, card, contentDocument };
}

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

describe('reutilizar una imagen ya catalogada de Assets en una nota, sin copiar bytes (ASSET-04)', () => {
  it('inserta la misma referencia en otra nota; no se escribe ningún archivo nuevo', async () => {
    const { storage, id, card } = await noteWithText();
    const other = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Otra' }));
    ok(await editCardContent(storage, id, other, { content: 'Aparte.' }));
    const origin = ok(await addNoteImage(storage, storage, id, card, { bytes: PNG, fileName: 'Pagoda.png', content: 'Llegada.', place: { kind: 'insert' } }));
    const listedBefore = ok(await storage.listAssets(id));
    const reused = ok(await insertExistingNoteImage(storage, storage, id, other, { ref: origin.ref, content: 'Aparte.', place: { kind: 'insert' } }));
    expect(reused.ref).toBe(origin.ref);
    expect(noteImageRefs(reused.content)).toEqual([origin.ref]);
    const listedAfter = ok(await storage.listAssets(id));
    expect(listedAfter.length).toBe(listedBefore.length);
    expect((await cardOf(storage, id, other)).assetRefs).toEqual([origin.ref]);
    // La tarjeta original conserva su propia referencia: dos notas comparten el mismo archivo.
    expect((await cardOf(storage, id, card)).assetRefs).toEqual([origin.ref]);
    expect(ok(await storage.readAsset(id, origin.ref as AssetRef))).toEqual(PNG);
  });

  it('reemplazar con una referencia existente conserva la posición sin tocar el archivo anterior', async () => {
    const { storage, id, card } = await noteWithText();
    const other = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Otra' }));
    // El segundo archivo ya existe desde otra nota: reemplazar no debe copiarlo ni crear uno nuevo.
    const second = ok(await addNoteImage(storage, storage, id, other, { bytes: JPEG, fileName: 'b.jpg', content: '', place: { kind: 'insert' } }));
    const first = ok(await addNoteImage(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', content: 'Llegada.', place: { kind: 'insert' } }));
    const replaced = ok(await insertExistingNoteImage(storage, storage, id, card, { ref: second.ref, content: first.content, place: { kind: 'replace', index: 1 } }));
    expect(noteImageRefs(replaced.content)).toEqual([second.ref]);
    expect((await storage.readAsset(id, first.ref as AssetRef)).ok).toBe(true);
  });

  it('una referencia ausente del almacenamiento se rechaza sin modificar el documento', async () => {
    const { storage, id, card } = await noteWithText();
    const before = (await cardOf(storage, id, card)).content;
    const result = await insertExistingNoteImage(storage, storage, id, card, { ref: 'assets/images/no-existe.png' as AssetRef, content: 'Llegada.', place: { kind: 'insert' } });
    expect(result.ok ? null : result.issues[0]?.code).toBe('invalid-asset');
    expect((await cardOf(storage, id, card)).content).toBe(before);
  });

  it('una referencia de un formato no admitido para inserción enriquecida se rechaza aunque exista en disco', async () => {
    const { storage, id, card } = await noteWithText();
    ok(await storage.writeAsset(id, 'assets/images/plano.svg' as AssetRef, new TextEncoder().encode('<svg></svg>')));
    const result = await insertExistingNoteImage(storage, storage, id, card, { ref: 'assets/images/plano.svg' as AssetRef, content: 'Llegada.', place: { kind: 'insert' } });
    expect(result.ok ? null : result.issues[0]?.code).toBe('invalid-asset');
  });
});

describe('reutilizar una imagen ya catalogada en una nota con cuerpo HTML seguro (ADR 0066)', () => {
  it('inserta la misma referencia en el documento estructurado sin escribir otro archivo', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const origin = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: PNG, fileName: 'Pagoda.png', contentDocument, place: { kind: 'insert', afterBlock: 0 } }));
    const listedBefore = ok(await storage.listAssets(id));
    const reused = ok(await insertExistingNoteImageDocument(storage, storage, id, card, { ref: origin.ref, contentDocument: origin.contentDocument, place: { kind: 'insert' } }));
    expect(reused.contentDocument.blocks.filter((block) => block.type === 'image')).toHaveLength(2);
    expect(reused.ref).toBe(origin.ref);
    const listedAfter = ok(await storage.listAssets(id));
    expect(listedAfter.length).toBe(listedBefore.length);
  });

  it('una referencia ausente se rechaza sin modificar el documento', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const result = await insertExistingNoteImageDocument(storage, storage, id, card, { ref: 'assets/images/no-existe.png' as AssetRef, contentDocument, place: { kind: 'insert' } });
    expect(result.ok ? null : result.issues[0]?.code).toBe('invalid-asset');
    expect((await cardOf(storage, id, card)).contentDocument).toEqual(contentDocument);
  });
});

describe('imágenes dentro de una nota con cuerpo HTML seguro (ADR 0066)', () => {
  it('insertar tras un bloque escribe el asset en el documento, nunca en `content` (nunca convierte HTML nuevo a Markdown)', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const first = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: PNG, fileName: 'Pagoda.png', contentDocument, place: { kind: 'insert', afterBlock: 0 } }));
    expect(first.ref).toBe('assets/images/tarjeta-1-1.png');
    expect(first.contentDocument.blocks.map((block) => block.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(first.contentDocument.blocks[1]).toMatchObject({ type: 'image', assetRef: 'assets/images/tarjeta-1-1.png' });
    const saved = await cardOf(storage, id, card);
    expect(saved.contentDocument).toEqual(first.contentDocument);
    expect(saved.content).toBeUndefined();
    expect(saved.assetRefs).toEqual(['assets/images/tarjeta-1-1.png']);
    // Sin `afterBlock`, al final (como `addNoteImage` sin `caret`).
    const second = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: JPEG, fileName: 'río.jpg', contentDocument: first.contentDocument, place: { kind: 'insert' } }));
    expect(second.contentDocument.blocks.map((block) => block.type)).toEqual(['paragraph', 'image', 'paragraph', 'image']);
    expect((await cardOf(storage, id, card)).assetRefs).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
    const archive = readWorkspaceArchive(ok(storage.exportArchive(id)).bytes);
    if (!archive.ok) throw new Error('ZIP inválido');
    expect(archive.value.files[`cards/${card}.md`]).toContain('<img');
    expect(Object.keys(archive.value.assets).sort()).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
  });

  it('reemplazar conserva el texto alternativo y la leyenda de la imagen anterior; el archivo sustituido sigue en disco', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const inserted = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', contentDocument, place: { kind: 'insert', afterBlock: 0 } }));
    const withAlt: RichTextDocument = {
      ...inserted.contentDocument,
      blocks: inserted.contentDocument.blocks.map((block) => block.type === 'image' ? { ...block, alt: 'Pagoda dorada', caption: [{ type: 'text', text: 'Leyenda' }] } : block),
    };
    const replaced = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: JPEG, fileName: 'b.jpg', contentDocument: withAlt, place: { kind: 'replace', blockIndex: 1 } }));
    expect(replaced.contentDocument.blocks[1]).toMatchObject({ type: 'image', assetRef: 'assets/images/tarjeta-1-2.jpg', alt: 'Pagoda dorada', caption: [{ type: 'text', text: 'Leyenda' }] });
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-1.png' as AssetRef)).ok).toBe(true);
  });

  it('un formato inválido no escribe nada; si la nota no se guarda, se retira el asset recién escrito', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const invalid = await addNoteImageDocument(storage, storage, id, card, { bytes: new TextEncoder().encode('hola'), fileName: 'x.png', contentDocument, place: { kind: 'insert' } });
    expect(invalid.ok ? null : invalid.issues[0]?.code).toBe('invalid-asset');
    const missing = await addNoteImageDocument(storage, storage, id, 'no-existe' as CardId, { bytes: PNG, fileName: 'x.png', contentDocument, place: { kind: 'insert' } });
    expect(missing.ok).toBe(false);
    expect((await storage.readAsset(id, 'assets/images/no-existe-1.png' as AssetRef)).ok).toBe(false);
  });

  it('purgar la nota desde la Papelera libera y borra sus imágenes', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    ok(await addNoteImageDocument(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', contentDocument, place: { kind: 'insert' } }));
    ok(await moveCardToTrash(storage, id, card));
    const purged = ok(await purgeCardFromTrash(storage, storage, id, card));
    expect(purged.removedAssets).toEqual(['assets/images/tarjeta-1-1.png']);
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-1.png' as AssetRef)).ok).toBe(false);
  });

  it('quitar el bloque de imagen con `editCardContent` (Lexical, node.remove()) la saca de assetRefs igual que en Markdown', async () => {
    const { storage, id, card, contentDocument } = await noteWithHtmlText();
    const inserted = ok(await addNoteImageDocument(storage, storage, id, card, { bytes: PNG, fileName: 'a.png', contentDocument, place: { kind: 'insert' } }));
    expect((await cardOf(storage, id, card)).assetRefs).toEqual(['assets/images/tarjeta-1-1.png']);
    const withoutImage: RichTextDocument = { ...inserted.contentDocument, blocks: inserted.contentDocument.blocks.filter((block) => block.type !== 'image') };
    ok(await editCardContent(storage, id, card, { contentDocument: withoutImage }));
    // Antes de este arreglo, `editCardContent` solo seguía `assetRefs` para `content` (Markdown):
    // quitar la imagen del documento HTML seguro dejaba un `assetRefs` obsoleto, impidiendo que la
    // biblioteca de Assets («eliminar los sin usar») detectara el archivo como libre.
    expect((await cardOf(storage, id, card)).assetRefs).toBeUndefined();
    expect((await storage.readAsset(id, 'assets/images/tarjeta-1-1.png' as AssetRef)).ok).toBe(true);
  });
});
