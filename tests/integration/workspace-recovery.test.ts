import { describe, expect, it } from 'vitest';

import { addCardToBoard, annotateDocumentInDiary, createEmptyWorkspaceNamed } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { DocumentTreeFolderPort, FolderStorage, planWorkspaceRecovery, writeWorkspaceArchive } from '../../packages/storage/src/index';
import type { TextFiles } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Vuelca la subcarpeta de un proyecto a `TextFiles`, igual que vería una recuperación desde una
 * carpeta real: nunca decodifica assets/ como texto (son binarios, ajenos a esta reconstrucción). */
function dumpAsTextFiles(tree: MemoryDocumentTree, projectKey: string): TextFiles {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const prefix = `${projectKey}/`;
  const files: Record<string, string> = {};
  for (const [fullPath, bytes] of Object.entries(tree.snapshot())) {
    if (!fullPath.startsWith(prefix)) continue;
    const path = fullPath.slice(prefix.length);
    if (path.startsWith('assets/') || path === '.nouty-transaction.json' || path === '.nouty-deleted') continue;
    try { files[path] = decoder.decode(bytes); } catch { /* no es texto: se deja fuera, como cualquier archivo ilegible */ }
  }
  return files;
}

describe('planWorkspaceRecovery sobre un paquete real (ADR 0010, Bloque 16 Paquete 2)', () => {
  it('una anotación de Diario que referencia un documento ausente sobrevive intacta a la recuperación de otra tarjeta rota', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Con Diario y un documento ausente'));
    const normalCard = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Nota ordinaria' }));
    const annotationId = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-04', createdAt: '2026-11-04T09:00:00.000Z',
      documentRef: 'assets/documents/no-existe.pdf', documentName: 'no-existe.pdf', reflection: 'Reflexión conservada.', page: 3,
    }));

    // Se rompe deliberadamente la tarjeta ordinaria (nunca la del Diario) para forzar la recuperación.
    const brokenPath = `cards/${normalCard}.md`;
    const fullBrokenPath = `${id}/${brokenPath}`;
    const broken = new TextDecoder().decode(tree.snapshot()[fullBrokenPath]).replace('schemaVersion: 1', 'schemaVersion: 1\nassetRefs: "no-es-una-lista"');
    tree.put(fullBrokenPath, new TextEncoder().encode(broken));

    const files = dumpAsTextFiles(tree, id);
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toMatchObject([{ path: brokenPath, kind: 'card' }]);

    const diaryEntry = plan.value.workspace.cards.find((card) => card.id === annotationId);
    // La entrada del Diario sigue existiendo, con su reflexión y su referencia al documento intactas —
    // nunca se elimina ni se altera una anotación solo porque el documento referenciado no esté.
    expect(diaryEntry).toMatchObject({ content: 'Reflexión conservada.', fields: { 'documento-ref': 'assets/documents/no-existe.pdf', 'documento-pagina': 3 } });
    expect(plan.value.workspace.cards.some((card) => card.id === normalCard)).toBe(false);

    // La copia es exportable como ZIP sin los bytes del documento (nunca existieron) ni problema alguno.
    const zipped = writeWorkspaceArchive(plan.value.files, {});
    expect(zipped.ok).toBe(true);
  });
});
