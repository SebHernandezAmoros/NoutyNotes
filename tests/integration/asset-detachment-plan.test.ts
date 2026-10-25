import { expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { analyzeAssetReferences, planAssetDetachment } from '../../packages/application/src/index';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { detachmentPng, detachmentRef, detachmentWorkspace } from '../fixtures/asset-detachment';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it.each(['memory', 'folder'] as const)('calcula propuestas con datos reales %s sin consultar ni escribir el backend', async (kind) => {
  const storage = kind === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(new MemoryDocumentTree()));
  const source = detachmentWorkspace();
  const bytes = new Uint8Array(Buffer.from(detachmentPng, 'base64'));
  value(await storage.create(source));
  value(await storage.writeAsset(source.id, detachmentRef, bytes));
  const snapshot = value(await storage.open(source.id));
  const calls = [vi.spyOn(storage, 'open'), vi.spyOn(storage, 'save'), vi.spyOn(storage, 'readAsset'), vi.spyOn(storage, 'writeAsset'), vi.spyOn(storage, 'removeAsset')];
  const analysis = analyzeAssetReferences({ workspace: snapshot, ref: detachmentRef, unverified: ['Otras sesiones'] });
  const plan = planAssetDetachment({ snapshot, assetRef: detachmentRef, analysis, noteImagePolicy: 'remove-block' });
  expect(plan.summary).toMatchObject({ owners: 4, occurrences: 5, retainedCards: 1, removedBlocks: 4, filesDeleted: 0 });
  expect(plan.status).toBe('reviewable-partial');
  for (const call of calls) expect(call).not.toHaveBeenCalled();
  expect(value(await storage.open(source.id))).toEqual(snapshot);
  expect(value(await storage.readAsset(source.id, detachmentRef))).toEqual(bytes);
});
