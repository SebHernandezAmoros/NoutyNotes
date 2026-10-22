import { describe, expect, it } from 'vitest';

import { addCardToBoard, addNoteImageDocument, createEmptyWorkspaceNamed, duplicateSelection, editCardContent, insertExistingNoteImageDocument } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, RichTextDocument } from '../../packages/domain/src/index';
import { ArchiveStorage, parseRichTextMarkdown } from '../../packages/storage/src/index';
import { unsafe } from '../../packages/domain/src/__fixtures__/workspace';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const ref = 'assets/images/id-interno-739.png' as AssetRef;
const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'Antes' }] } as const;
const legacy: RichTextDocument = { schemaVersion: 1, blocks: [paragraph, { type: 'image', assetRef: ref, alt: 'Descripción anterior', caption: [{ type: 'text', text: 'Leyenda conservada', marks: ['italic'] }], size: 'medium', alignment: 'right' }] };
function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
async function fixture(document: RichTextDocument = { schemaVersion: 1, blocks: [paragraph] }) {
  const storage = new ArchiveStorage();
  const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Políticas por imagen'));
  const card = ok(await addCardToBoard(storage, id, { kind: 'note' }));
  ok(await editCardContent(storage, id, card, { contentDocument: document }));
  ok(await storage.writeAsset(id, ref, PNG));
  return { storage, id, card, document };
}

describe('N2: operaciones de imágenes enriquecidas', () => {
  it.each(['upload', 'existing'] as const)('rechaza entrada futura en %s antes de reinterpretar la versión o escribir Assets', async (source) => {
    const { storage, id, card, document } = await fixture();
    const invalid = unsafe<RichTextDocument>({ ...document, schemaVersion: 3 });
    const before = ok(await storage.open(id));
    const assets = ok(await storage.listAssets(id));
    const result = await (source === 'upload'
      ? addNoteImageDocument(storage, storage, id, card, { contentDocument: invalid, bytes: PNG, fileName: 'nuevo.png', place: { kind: 'insert' } })
      : insertExistingNoteImageDocument(storage, storage, id, card, { contentDocument: invalid, ref, place: { kind: 'insert' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.details?.[0]?.code).toBe('unsupported-schema-version');
    expect(ok(await storage.open(id))).toEqual(before);
    expect(ok(await storage.listAssets(id))).toEqual(assets);
  });

  it('solo convierte Markdown representable al insertar explícitamente y conserva los bloques previos', async () => {
    const { storage, id, card } = await fixture();
    const content = '## Antes\n\nTexto **histórico**.';
    ok(await editCardContent(storage, id, card, { content }));
    const parsed = parseRichTextMarkdown(content);
    if (!parsed.ok) throw new Error('Fixture inválido');
    expect(ok(await storage.open(id)).cards[0]?.content).toBe(content);
    const inserted = ok(await insertExistingNoteImageDocument(storage, storage, id, card, { contentDocument: parsed.value, ref, place: { kind: 'insert' } }));
    expect(inserted.contentDocument.blocks.slice(0, -1)).toEqual(parsed.value.blocks);
    expect(ok(await storage.open(id)).cards[0]?.content).toBeUndefined();
  });

  it('no convierte Markdown opaco con pérdida ni deja un Asset nuevo', async () => {
    const { storage, id, card } = await fixture();
    const content = '<div>Fragmento histórico opaco</div>';
    ok(await editCardContent(storage, id, card, { content }));
    const parsed = parseRichTextMarkdown(content);
    if (!parsed.ok) throw new Error('Fixture inválido');
    const assets = ok(await storage.listAssets(id));
    expect((await addNoteImageDocument(storage, storage, id, card, { contentDocument: parsed.value, bytes: PNG, fileName: 'nuevo.png', place: { kind: 'insert' } })).ok).toBe(false);
    expect(ok(await storage.open(id)).cards[0]?.content).toBe(content);
    expect(ok(await storage.listAssets(id))).toEqual(assets);
  });

  it.each(['upload', 'existing'] as const)('I01–I03/I07 %s crea explicit/pending sin nombres artificiales y persiste', async (source) => {
    const { storage, id, card, document } = await fixture();
    const inserted = ok(await (source === 'upload'
      ? addNoteImageDocument(storage, storage, id, card, { contentDocument: document, bytes: PNG, fileName: 'supuesta-descripcion.png', place: { kind: 'insert' } })
      : insertExistingNoteImageDocument(storage, storage, id, card, { contentDocument: document, ref, place: { kind: 'insert' } })));
    expect(inserted.contentDocument.schemaVersion).toBe(2);
    expect(inserted.contentDocument.blocks[1]).toEqual({ type: 'image', assetRef: inserted.ref, alt: '', captionPolicy: 'explicit', accessibilityIntent: 'pending' });
    const reopened = new ArchiveStorage();
    ok(await reopened.importArchive(ok(storage.exportArchive(id)).bytes));
    expect(ok(await reopened.open(id)).cards[0]?.contentDocument).toEqual(inserted.contentDocument);
    expect(ok(await storage.readAsset(id, ref))).toEqual(PNG);
  });

  it.each(['upload', 'existing'] as const)('R01–R04/R08–R10 %s conserva textos/política y marca pending solo en la Nota editada', async (source) => {
    const original: RichTextDocument = { ...legacy, schemaVersion: 2, blocks: legacy.blocks.map((block) => block.type === 'image' ? { ...block, captionPolicy: 'explicit', accessibilityIntent: 'decorative' } : block) };
    const { storage, id, card } = await fixture(original);
    const other = ok(await addCardToBoard(storage, id, { kind: 'note' }));
    ok(await editCardContent(storage, id, other, { contentDocument: original }));
    const replacement = 'assets/images/recurso-b.png' as AssetRef;
    ok(await storage.writeAsset(id, replacement, PNG));
    const result = ok(await (source === 'upload'
      ? addNoteImageDocument(storage, storage, id, card, { contentDocument: original, bytes: PNG, fileName: 'b.png', place: { kind: 'replace', blockIndex: 1 } })
      : insertExistingNoteImageDocument(storage, storage, id, card, { contentDocument: original, ref: replacement, place: { kind: 'replace', blockIndex: 1 } })));
    expect(result.contentDocument.blocks[1]).toEqual({ ...original.blocks[1], assetRef: result.ref, accessibilityIntent: 'pending' });
    expect(result.ref).not.toBe(ref);
    expect(ok(await storage.open(id)).cards.find((item) => item.id === other)?.contentDocument).toEqual(original);
    const reopened = new ArchiveStorage();
    ok(await reopened.importArchive(ok(storage.exportArchive(id)).bytes));
    expect(ok(await reopened.open(id)).cards.find((item) => item.id === card)?.contentDocument).toEqual(result.contentDocument);
    expect(ok(await reopened.readAsset(id, ref))).toEqual(PNG);
  });

  it('R03 reemplazar una histórica no introduce captionPolicy', async () => {
    const { storage, id, card } = await fixture(legacy);
    const replaced = ok(await addNoteImageDocument(storage, storage, id, card, { contentDocument: legacy, bytes: PNG, fileName: 'nuevo.png', place: { kind: 'replace', blockIndex: 1 } }));
    expect(replaced.contentDocument.blocks[1]).toEqual({ ...legacy.blocks[1], assetRef: replaced.ref, accessibilityIntent: 'pending' });
    expect(replaced.contentDocument.schemaVersion).toBe(2);
  });

  it('I04/I05 duplicar conserva históricos y nuevos sin alterar su generación', async () => {
    for (const document of [legacy, { ...legacy, schemaVersion: 2 as const, blocks: legacy.blocks.map((block) => block.type === 'image' ? { ...block, captionPolicy: 'explicit' as const, accessibilityIntent: 'pending' as const } : block) }]) {
      const { storage, id, card } = await fixture(document);
      const workspace = ok(await storage.open(id));
      ok(await duplicateSelection(storage, id, workspace.boards[0]!.id, [card]));
      expect(ok(await storage.open(id)).cards.map((item) => item.contentDocument)).toEqual([document, document]);
      expect(ok(await storage.listAssets(id))).toEqual([ref]);
    }
  });
});
