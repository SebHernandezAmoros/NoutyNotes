import { expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { DESKTOP_GRID, restoreArchivedCard, restoreTrashedCard } from '../../packages/domain/src/index';
import { analyzeAssetReferences, prepareAssetDetachmentCandidate } from '../../packages/application/src/index';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { detachmentPng, detachmentRef, detachmentWorkspace } from '../fixtures/asset-detachment';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const bytes = new Uint8Array(Buffer.from(detachmentPng, 'base64'));

it.each(['memory', 'folder'] as const)('ensayo con %s: fuente y bytes intactos; codecs/restauración de copia aislada coherentes', async (kind) => {
  const sourceTree = new MemoryDocumentTree();
  const storage = kind === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(sourceTree));
  const source = detachmentWorkspace();
  value(await storage.create(source));
  value(await storage.writeAsset(source.id, detachmentRef, bytes));
  const snapshot = value(await storage.open(source.id));
  const before = sourceTree.snapshot();
  const calls = [vi.spyOn(storage, 'open'), vi.spyOn(storage, 'save'), vi.spyOn(storage, 'readAsset'), vi.spyOn(storage, 'writeAsset'), vi.spyOn(storage, 'removeAsset')];
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef,
    analysis: analyzeAssetReferences({ workspace: snapshot, ref: detachmentRef, unverified: ['Fuentes privadas no acreditadas'] }) });
  expect(result.status).toBe('prepared-copy');
  for (const call of calls) expect(call).not.toHaveBeenCalled();
  expect(sourceTree.snapshot()).toEqual(before);
  expect(value(await storage.open(source.id))).toEqual(snapshot);
  expect(value(await storage.readAsset(source.id, detachmentRef))).toEqual(bytes);
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));

  // Compatibility check in a DIFFERENT synthetic backend. Not an execution path on the source.
  const destination = new MemoryDocumentTree();
  const isolated = kind === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(destination));
  value(await isolated.create(result.snapshot));
  value(await isolated.writeAsset(source.id, detachmentRef, bytes)); // No purge; orphan bytes are retained.
  const reopened = kind === 'memory' ? isolated : new FolderStorage(new DocumentTreeFolderPort(destination));
  const decoded = value(await reopened.open(source.id));
  expect(decoded).toEqual(result.snapshot);
  const archiveId = decoded.archive![0]!.card.id;
  const trashId = decoded.trash![0]!.card.id;
  const options = { fallbackBoardId: decoded.boards[0]!.id, config: DESKTOP_GRID };
  const fromArchive = value(restoreArchivedCard(decoded, archiveId, options)).workspace;
  const restored = value(restoreTrashedCard(fromArchive, trashId, options)).workspace;
  expect(restored.cards.find((card) => card.id === archiveId)).toEqual(decoded.archive![0]!.card);
  expect(restored.cards.find((card) => card.id === trashId)).toEqual(decoded.trash![0]!.card);
  expect(analyzeAssetReferences({ workspace: restored, ref: detachmentRef, unverified: [] }).occurrenceCount).toBe(0);
  expect(value(await reopened.readAsset(source.id, detachmentRef))).toEqual(bytes);
  expect(sourceTree.snapshot()).toEqual(before);
});

it('ZIP de copia ensayada conserva estados y bytes; no implica recibo durable ni eliminación del ZIP original', async () => {
  const source = detachmentWorkspace();
  const result = prepareAssetDetachmentCandidate({ snapshot: source, assetRef: detachmentRef,
    analysis: analyzeAssetReferences({ workspace: source, ref: detachmentRef, unverified: [] }), noteImagePolicy: 'remove-block' });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  const archive = new ArchiveStorage();
  value(await archive.create(result.snapshot));
  value(await archive.writeAsset(source.id, detachmentRef, bytes));
  const exported = value(archive.exportArchive(source.id));
  const freshSession = new ArchiveStorage();
  value(await freshSession.importArchive(exported.bytes));
  expect(value(await freshSession.open(source.id))).toEqual(result.snapshot);
  expect(value(await freshSession.readAsset(source.id, detachmentRef))).toEqual(bytes);
  expect(result.executionAllowed).toBe(false);
});
