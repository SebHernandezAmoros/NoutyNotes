import { expect, it, vi } from 'vitest';
import { editCardContent } from '../../packages/application/src/index';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { removedImageDocument, removedImageWorkspace } from '../fixtures/removed-image-blocks';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it.each(['memory', 'folder'] as const)('edita vecinos, guarda y reabre por %s sin tocar bytes ni alterar el marcador', async (backend) => {
  const tree = new MemoryDocumentTree();
  const storage = backend === 'memory' ? new ArchiveStorage() : new FolderStorage(new DocumentTreeFolderPort(tree));
  const reads = vi.spyOn(storage, 'readAsset');
  const writes = vi.spyOn(storage, 'writeAsset');
  const deletes = vi.spyOn(storage, 'removeAsset');
  const source = removedImageWorkspace();
  value(await storage.create(source));
  const edited = { ...removedImageDocument, blocks: [
    { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Anterior editado' }] },
    removedImageDocument.blocks[1]!,
    { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Posterior editado' }] },
  ] };
  value(await editCardContent(storage, source.id, source.cards[0]!.id, { contentDocument: edited }));
  const reopened = backend === 'memory' ? storage : new FolderStorage(new DocumentTreeFolderPort(tree));
  const actual = value(await reopened.open(source.id));
  expect(actual.cards[0]?.contentDocument).toEqual(edited);
  expect(actual.layouts).toEqual(source.layouts);
  expect(actual.relations).toEqual(source.relations);
  for (const spy of [reads, writes, deletes]) expect(spy).not.toHaveBeenCalled();
});
