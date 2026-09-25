import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, connectCards, createEmptyWorkspaceNamed, disconnectCards, editCardContent, moveCardOnBoard, resizeCardOnBoard,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, CardId, RelationId, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryStorage } from '../../packages/storage/src/index';

const id = (value: string) => value as WorkspaceId;
const card = (value: string) => value as CardId;
const board = 'principal' as BoardId;

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** `código@ruta` del error del puerto y de su primera incidencia original. */
function failureOf(result: WorkspaceStorageResult<unknown>): string[] {
  if (result.ok) return [];
  const [first] = result.issues;
  return [`${first?.code}@${first?.path}`, ...(first?.details ?? []).map(({ code, path }) => `${code}@${path}`)];
}

async function session() {
  const storage = new MemoryStorage();
  const summary = ok(await createEmptyWorkspaceNamed(storage, 'Mis ideas'));
  return { storage, workspaceId: summary.id };
}

describe('crear espacios desde un nombre (fase 7)', () => {
  it('deriva el ID del nombre, evita repetidos y guarda un workspace vacío', async () => {
    const storage = new MemoryStorage();
    expect(ok(await createEmptyWorkspaceNamed(storage, 'Mis ideas'))).toEqual({ id: 'mis-ideas', name: 'Mis ideas' });
    expect(ok(await createEmptyWorkspaceNamed(storage, 'Mis ideas'))).toEqual({ id: 'mis-ideas-2', name: 'Mis ideas' });
    expect(ok(await storage.list())).toEqual([{ id: 'mis-ideas', name: 'Mis ideas' }, { id: 'mis-ideas-2', name: 'Mis ideas' }]);
    expect(ok(await storage.open(id('mis-ideas'))).cards).toEqual([]);
  });

  it('un nombre en blanco no crea nada', async () => {
    const storage = new MemoryStorage();
    expect(failureOf(await createEmptyWorkspaceNamed(storage, '  '))).toEqual(['invalid-workspace@workspace', 'invalid-value@metadata.name']);
    expect(ok(await storage.list())).toEqual([]);
  });
});

describe('añadir tarjetas (fase 7)', () => {
  it('la primera tarjeta crea el tipo, el board principal y su layout; las siguientes ocupan el siguiente hueco', async () => {
    const { storage, workspaceId } = await session();
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }))).toBe('tarjeta-1');
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'image' }))).toBe('tarjeta-2');
    const workspace = ok(await storage.open(workspaceId));
    expect(workspace.cardTypes.map(({ id: typeId, base }) => `${typeId}:${base}`)).toEqual(['nota:note', 'imagen:image']);
    expect(workspace.boards).toEqual([{ id: 'principal', title: 'Tablero principal', cardIds: ['tarjeta-1', 'tarjeta-2'] }]);
    expect(workspace.cards).toEqual([
      { id: 'tarjeta-1', typeId: 'nota', title: 'Nueva nota', content: '', fields: {} },
      { id: 'tarjeta-2', typeId: 'imagen', title: 'Imagen de ejemplo', fields: {} },
    ]);
    expect(workspace.layouts[0]?.placements.map(({ rect }) => rect)).toEqual([{ x: 0, y: 0, w: 4, h: 3 }, { x: 4, y: 0, w: 4, h: 3 }]);
    expect(Object.keys(ok(storage.exportPackage(workspaceId)))).toContain('cards/tarjeta-1.md');
  });

  it('no reutiliza IDs de tarjetas existentes y acepta un título', async () => {
    const { storage, workspaceId } = await session();
    ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'note', title: 'Guion' }))).toBe('tarjeta-2');
    expect(ok(await storage.open(workspaceId)).cards[1]?.title).toBe('Guion');
  });

  it('un workspace inexistente devuelve workspace-not-found', async () => {
    const { storage } = await session();
    expect(failureOf(await addCardToBoard(storage, id('ghost'), { kind: 'note' }))).toEqual(['workspace-not-found@id']);
    expect(failureOf(await addCardToBoard(storage, id('mis-ideas'), { kind: 'video' as 'note' })))
      .toEqual(['invalid-workspace@input']);
  });
});

describe('editar, mover, redimensionar y relacionar a través del puerto (fase 7)', () => {
  it('edita título y Markdown y lo conserva al reabrir', async () => {
    const { storage, workspaceId } = await session();
    const cardId = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    ok(await editCardContent(storage, workspaceId, cardId, { title: 'Escena 1', content: '# Plano\n\n- **abierto**' }));
    expect(ok(await storage.open(workspaceId)).cards[0]).toMatchObject({ title: 'Escena 1', content: '# Plano\n\n- **abierto**' });
    ok(await editCardContent(storage, workspaceId, cardId, { title: '' }));
    expect(ok(await storage.open(workspaceId)).cards[0]).not.toHaveProperty('title');
    expect(failureOf(await editCardContent(storage, workspaceId, card('ghost'), { title: 'x' })))
      .toEqual(['invalid-workspace@transform', 'missing-reference@cardId']);
  });

  it('mueve y redimensiona con el motor de grilla y devuelve sus errores sin guardar nada', async () => {
    const { storage, workspaceId } = await session();
    const first = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    const second = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: second, to: { x: 4, y: 3 } }));
    ok(await resizeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, size: { w: 5, h: 2 } }));
    const rects = async () => ok(await storage.open(workspaceId)).layouts[0]?.placements.map(({ rect }) => rect);
    expect(await rects()).toEqual([{ x: 0, y: 0, w: 5, h: 2 }, { x: 4, y: 3, w: 4, h: 3 }]);

    const before = ok(storage.exportPackage(workspaceId));
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: -1, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@to']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: 9, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@to']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: second, to: { x: 4, y: 1 } })))
      .toEqual(['invalid-workspace@transform', 'grid-collision@placements[0]']);
    expect(failureOf(await resizeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, size: { w: 5, h: 4 } })))
      .toEqual(['invalid-workspace@transform', 'grid-collision@placements[1]']);
    expect(failureOf(await resizeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, size: { w: 13, h: 1 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@size']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: 'otro' as BoardId, cardId: first, to: { x: 0, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'missing-reference@boardId']);
    expect(ok(storage.exportPackage(workspaceId))).toEqual(before);
  });

  it('conecta y desconecta tarjetas con un tipo de relación creado a demanda', async () => {
    const { storage, workspaceId } = await session();
    const a = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    const b = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    expect(ok(await connectCards(storage, workspaceId, { from: a, to: b }))).toBe('relacion-1');
    expect(ok(await connectCards(storage, workspaceId, { from: b, to: a }))).toBe('relacion-2');
    const workspace = ok(await storage.open(workspaceId));
    expect(workspace.relationTypes).toEqual([{ id: 'relacionada', label: 'Relacionada con' }]);
    expect(workspace.relations).toEqual([
      { id: 'relacion-1', typeId: 'relacionada', from: a, to: b },
      { id: 'relacion-2', typeId: 'relacionada', from: b, to: a },
    ]);
    expect(failureOf(await connectCards(storage, workspaceId, { from: a, to: b })))
      .toEqual(['invalid-workspace@transform', 'duplicate-relation@relations[2]']);
    expect(failureOf(await connectCards(storage, workspaceId, { from: a, to: a })))
      .toEqual(['invalid-workspace@transform', 'self-relation@relation.to']);

    ok(await disconnectCards(storage, workspaceId, 'relacion-1' as RelationId));
    expect(ok(await storage.open(workspaceId)).relations.map(({ id: relationId }) => relationId)).toEqual(['relacion-2']);
    expect(failureOf(await disconnectCards(storage, workspaceId, 'relacion-1' as RelationId)))
      .toEqual(['invalid-workspace@transform', 'missing-reference@relationId']);
    // Las tarjetas y su representación no cambian al desconectar.
    expect(ok(await storage.open(workspaceId)).cards.map(({ id: cardId }) => cardId)).toEqual([a, b]);
  });

  it('los espacios de la sesión conservan su estado entre operaciones y aperturas', async () => {
    const { storage, workspaceId } = await session();
    const other = ok(await createEmptyWorkspaceNamed(storage, 'Otro')).id;
    const a = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    ok(await addCardToBoard(storage, other, { kind: 'image' }));
    ok(await editCardContent(storage, workspaceId, a, { content: 'Persistente en memoria' }));
    expect(ok(await storage.open(workspaceId)).cards[0]?.content).toBe('Persistente en memoria');
    expect(ok(await storage.open(other)).cards.map(({ typeId }) => typeId)).toEqual(['imagen']);
    expect(ok(await storage.list()).map(({ id: workspace }) => workspace)).toEqual(['mis-ideas', 'otro']);
  });
});
