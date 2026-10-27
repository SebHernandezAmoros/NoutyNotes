import { expect, it, vi } from 'vitest';
import { archiveCard, restoreArchivedCard, restoreTrashedCard, trashCard } from '../../packages/domain/src/index';
import { WORLD_GRID } from '../../packages/domain/src/layouts/grid';
import { buildAssetCatalog, analyzeAssetReferences, archiveSelectionForExport, MemoryDraftPersistence, PersistentDraftStore, createDraftKey, draftRevision, importLibraryFile, inspectNotePdf } from '../../packages/application/src/index';
import { editCardAppearance, editCardContent } from '../../packages/application/src/workspace-editing';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage, readWorkspaceArchive, serializeWorkspace, writeWorkspaceArchive } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { block8PdfBytes, block8Workspace, fontRef, pdfRef } from '../fixtures/block8-content';
import type { AssetRef } from '../../packages/domain/src/index';

function value<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; }
it.each(['memory', 'folder'] as const)('conserva PDF compartido/fuente, edita vecinos y restaura snapshots por %s sin eliminar recursos', async (backend) => {
  const tree = new MemoryDocumentTree();
  const storage = backend === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(tree));
  const source = block8Workspace();
  value(await storage.create(source));
  const pdf = block8PdfBytes();
  const font = new Uint8Array([0, 1, 0, 0, 1, 2, 3]); // Stored bytes, intentionally not a renderable font.
  value(await storage.writeAsset(source.id, pdfRef, pdf)); value(await storage.writeAsset(source.id, fontRef, font));
  const remove = vi.spyOn(storage, 'removeAsset');
  const first = source.cards[0]!;
  const body = first.contentDocument!;
  const document = { ...body, blocks: [...body.blocks, { type: 'pdf' as const, assetRef: pdfRef, label: 'Segunda aparición' }] };
  value(await editCardContent(storage, source.id, first.id, { contentDocument: document }));
  value(await editCardAppearance(storage, source.id, first.id, { noteFont: { kind: 'builtin', family: 'serif' } }));
  value(await editCardAppearance(storage, source.id, first.id, { noteFont: { kind: 'asset', assetRef: fontRef } }));
  const reopened = backend === 'memory' ? storage : new FolderStorage(new DocumentTreeFolderPort(tree));
  const saved = value(await reopened.open(source.id));
  expect(saved.cards[0]?.contentDocument).toEqual(document);
  expect(saved.cards[0]?.noteFont).toEqual(first.noteFont);
  const options = { fallbackBoardId: source.boards[0]!.id, config: WORLD_GRID };
  const archived = value(archiveCard(saved, first.id, '2026-10-26T12:00:00.000Z'));
  value(await reopened.save(archived));
  const selection = archiveSelectionForExport(archived, [first.id]);
  if (!selection.ok) throw new Error(selection.reason);
  expect(selection.value.assetRefs).toEqual(expect.arrayContaining([pdfRef, fontRef]));
  expect(selection.value.workspace.cards[0]?.contentDocument).toEqual(document);
  const restored = value(restoreArchivedCard(value(await reopened.open(source.id)), first.id, options)).workspace;
  const trashed = value(trashCard(restored, first.id));
  value(await reopened.save(trashed));
  for (const [snapshot, collection] of [[archived, 'archive'], [trashed, 'trash']] as const) {
    for (const ref of [pdfRef, fontRef]) {
      const analysis = analyzeAssetReferences({ workspace: snapshot, ref, unverified: ['other sessions'] });
      expect(analysis.owners.map((owner) => owner.collection)).toEqual([collection]);
      expect(analysis.occurrenceCount).toBe(ref === pdfRef ? 2 : 1);
      expect(buildAssetCatalog(snapshot, [ref]).find((entry) => entry.ref === ref)?.unused).toBe(false);
    }
  }
  const returned = value(restoreTrashedCard(value(await reopened.open(source.id)), first.id, options)).workspace;
  expect(returned.cards.find((card) => card.id === first.id)?.contentDocument).toEqual(document);
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(returned)), { [pdfRef]: pdf, [fontRef]: font }));
  const imported = value(readWorkspaceArchive(zip));
  expect(imported.assets[pdfRef]).toEqual(pdf); expect(imported.assets[fontRef]).toEqual(font);
  expect(imported.workspace.cards).toEqual(returned.cards);
  expect(remove).not.toHaveBeenCalled();
});

it('promover Markdown a PDF conserva referencias auxiliares y libera solo el espejo del cuerpo anterior', async () => {
  const storage = new ArchiveStorage();
  const source = block8Workspace();
  const oldRef = 'assets/images/old.png' as AssetRef;
  const auxiliary = 'assets/images/auxiliary.png' as AssetRef;
  const workspace = { ...source, cards: source.cards.map((card, i) => {
    if (i !== 0) return card;
    const { contentDocument: _document, ...rest } = card;
    return { ...rest, content: `![Old](${oldRef})`, assetRefs: [oldRef, auxiliary] };
  }) };
  value(await storage.create(workspace));
  value(await editCardContent(storage, workspace.id, workspace.cards[0]!.id, { contentDocument: source.cards[0]!.contentDocument! }));
  const saved = value(await storage.open(workspace.id)).cards[0]!;
  expect(saved.assetRefs).toEqual([auxiliary, pdfRef]);
  expect(saved.noteFont).toEqual(source.cards[0]!.noteFont);
});

it('draft4 se conserva privado y recuperable sin introducirlo en ZIP', async () => {
  const persistence = new MemoryDraftPersistence();
  const store = new PersistentDraftStore(persistence, { now: () => '2026-10-26T12:00:00.000Z' });
  const source = block8Workspace();
  const body = { ...source.cards[0]!.contentDocument!, blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Solo en borrador B8' }] }, ...source.cards[0]!.contentDocument!.blocks] };
  value(await store.save({ key: createDraftKey(source.id, source.cards[0]!.id, 'body'), source: { format: 'rich-text', value: body }, baseRevision: draftRevision('base'), validation: { status: 'valid' } }));
  const restored = value(await new PersistentDraftStore(persistence, { now: () => '2026-10-26T12:00:00.000Z' }).list(source.id));
  expect(restored[0]?.source).toEqual({ format: 'rich-text', value: body });
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(source)), { [pdfRef]: block8PdfBytes() }));
  expect(JSON.stringify(value(readWorkspaceArchive(zip)).files)).not.toContain('Solo en borrador B8');
});

it('biblioteca20MiB conserva PDF grande pero inserción/ZIP16MiB bloquean sin truncar ni borrar', async () => {
  const storage = new ArchiveStorage();
  const source = block8Workspace();
  value(await storage.create(source));
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
  bytes.set(block8PdfBytes()); bytes[bytes.length - 1] = 99;
  const ref = value(await importLibraryFile(storage, storage, source.id, { bytes, fileName: 'large.pdf' })) as AssetRef;
  expect(inspectNotePdf(bytes).ok).toBe(false);
  const result = storage.exportArchive(source.id);
  expect(result.ok).toBe(false);
  const read = value(await storage.readAsset(source.id, ref));
  expect(read.length).toBe(bytes.length);
  expect(Buffer.compare(Buffer.from(read), Buffer.from(bytes))).toBe(0);
  expect(value(await storage.open(source.id)).cards).toEqual(source.cards);
});
