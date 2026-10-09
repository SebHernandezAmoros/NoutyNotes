import { describe, expect, it } from 'vitest';

import { MemoryDraftPersistence, PersistentDraftStore, createDraftKey, draftRevision } from '../../packages/application/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage, readWorkspaceArchive } from '../../packages/storage/src/index';

const now = () => '2026-10-09T12:00:00.000Z';
const secret = '<script>privado-no-portable</script>';

const valueOf = <T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};

describe('borradores privados frente a formatos portables', () => {
  it('un HTML inválido recuperable no entra en ZIP ni en el árbol SAF', async () => {
    const drafts = new PersistentDraftStore(new MemoryDraftPersistence(), { now });
    valueOf(await drafts.save({
      key: createDraftKey('demo', 'idea-a', 'body'),
      source: { format: 'html', value: secret },
      baseRevision: draftRevision('<p>confirmado</p>'),
      validation: { status: 'invalid', error: { code: 'unknown-tag', message: 'Etiqueta no admitida.' } },
    }));

    const archive = new ArchiveStorage();
    valueOf(await archive.create(validWorkspace()));
    const zip = valueOf(archive.exportArchive(validWorkspace().id));
    const portable = valueOf(readWorkspaceArchive(zip.bytes));
    expect(JSON.stringify(portable.files)).not.toContain(secret);

    const tree = new MemoryDocumentTree();
    const saf = new FolderStorage(new DocumentTreeFolderPort(tree));
    valueOf(await saf.create(validWorkspace()));
    const decoded = new TextDecoder().decode(Uint8Array.from(Object.values(tree.snapshot()).flatMap((bytes) => [...bytes])));
    expect(decoded).not.toContain(secret);
    expect(valueOf(await drafts.list('demo'))).toHaveLength(1);
  });
});
