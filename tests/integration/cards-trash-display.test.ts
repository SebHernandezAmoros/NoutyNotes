import { afterEach, describe, expect, it } from 'vitest';

import {
  addCardToBoard, connectCards, createEmptyWorkspaceNamed, moveCardToTrash, purgeCardFromTrash, restoreCardFromTrash, setCardDisplay,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, CardId } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { DocumentTreeFolderPort, FolderStorage, MemoryStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const card = (value: string) => value as CardId;
const principal = 'principal' as BoardId;

afterEach(() => MemoryDocumentTree.failWrites.clear());

async function twoCards(storage: MemoryStorage | FolderStorage) {
  const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Ideas'));
  ok(await addCardToBoard(storage, id, { kind: 'note' }));
  ok(await addCardToBoard(storage, id, { kind: 'note' }));
  ok(await connectCards(storage, id, { from: card('tarjeta-1'), to: card('tarjeta-2') }));
  return id;
}

describe('Papelera y representación desde application (ADR 0014, ADR 0015)', () => {
  it('enviar a la Papelera, restaurar y reservar el ID mientras está en la Papelera', async () => {
    const storage = new MemoryStorage();
    const id = await twoCards(storage);
    ok(await moveCardToTrash(storage, id, card('tarjeta-1')));
    // Una tarjeta nueva no reutiliza el ID reservado por la Papelera.
    expect(ok(await addCardToBoard(storage, id, { kind: 'note' }))).toBe('tarjeta-3');
    const report = ok(await restoreCardFromTrash(storage, id, { cardId: card('tarjeta-1'), fallbackBoardId: principal }));
    expect(report).toEqual({ relocated: ['principal'], addedToFallback: false, skippedRelations: 0 });
    const workspace = ok(await storage.open(id));
    expect(workspace.trash ?? []).toEqual([]);
    expect(workspace.relations.map((relation) => `${relation.from}→${relation.to}`)).toEqual(['tarjeta-1→tarjeta-2']);
  });

  it('un fallo al escribir en la carpeta no deja un borrado parcial: se recupera el estado anterior', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const id = await twoCards(storage);
    const before = tree.snapshot();
    MemoryDocumentTree.failWrites.add('ideas/.nouty/trash.yaml');
    const failed = await moveCardToTrash(storage, id, card('tarjeta-1'));
    expect(failed.ok).toBe(false);
    MemoryDocumentTree.failWrites.clear();
    const reopened = ok(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id));
    expect(reopened.cards.map((entry) => entry.id)).toEqual(['tarjeta-1', 'tarjeta-2']);
    expect(reopened.trash).toBeUndefined();
    expect(tree.snapshot()).toEqual(before);
  });

  it('en carpeta la Papelera sobrevive a reabrir y eliminar definitivamente la quita', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const id = await twoCards(storage);
    ok(await moveCardToTrash(storage, id, card('tarjeta-2')));
    const reopened = new FolderStorage(new DocumentTreeFolderPort(tree));
    expect(ok(await reopened.open(id)).trash?.map((entry) => entry.card.id)).toEqual(['tarjeta-2']);
    expect(ok(await purgeCardFromTrash(reopened, null, id, card('tarjeta-2')))).toEqual({ releasedAssets: [], removedAssets: [], failedAssets: [] });
    expect(Object.keys(tree.snapshot())).not.toContain('ideas/.nouty/trash.yaml');
  });

  it('minimizar conserva el tamaño; expandir con colisión falla salvo que se pida un hueco libre', async () => {
    const storage = new MemoryStorage();
    const id = await twoCards(storage);
    ok(await setCardDisplay(storage, id, { boardId: principal, cardId: card('tarjeta-1'), display: 'minimized' }));
    // Con tarjeta-1 minimizada (1 × 1), tarjeta-2 se mueve encima de su tamaño expandido.
    const { moveCardOnBoard } = await import('../../packages/application/src/index');
    ok(await moveCardOnBoard(storage, id, { boardId: principal, cardId: card('tarjeta-2'), to: { x: 1, y: 0 } }));
    const blocked = await setCardDisplay(storage, id, { boardId: principal, cardId: card('tarjeta-1'), display: 'expanded' });
    expect(blocked.ok).toBe(false);
    expect(blocked.ok ? [] : blocked.issues[0]?.details?.map((detail) => detail.code)).toEqual(['grid-collision']);
    ok(await setCardDisplay(storage, id, { boardId: principal, cardId: card('tarjeta-1'), display: 'expanded', relocate: true }));
    const placement = ok(await storage.open(id)).layouts[0]?.placements.find((entry) => entry.cardId === 'tarjeta-1');
    expect(placement).toEqual({ cardId: 'tarjeta-1', display: 'expanded', rect: { x: 5, y: 0, w: 4, h: 3 } });
  });
});
