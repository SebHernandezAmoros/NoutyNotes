import { expect, it, vi } from 'vitest';
import { editCardContent } from '../../packages/application/src/index';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { removedCardsWorkspace } from '../fixtures/removed-cards';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it.each(['memory', 'folder'] as const)('guarda/reabre y cambia metadata en %s sin leer/escribir/eliminar bytes', async (backend) => {
  const storage = backend === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(new MemoryDocumentTree()));
  const reads = vi.spyOn(storage, 'readAsset');
  const writes = vi.spyOn(storage, 'writeAsset');
  const deletes = vi.spyOn(storage, 'removeAsset');
  const source = removedCardsWorkspace();
  value(await storage.create(source));
  expect(value(await storage.open(source.id))).toEqual(source);
  const changed = { ...source, cards: source.cards.map((card, index) => index === 0 ? { ...card, title: 'Título compatible editado' } : card) };
  value(await editCardContent(storage, source.id, source.cards[0]!.id, { title: 'Título compatible editado' }));
  expect(value(await storage.open(source.id))).toEqual(changed);
  for (const spy of [reads, writes, deletes]) expect(spy).not.toHaveBeenCalled();
});
