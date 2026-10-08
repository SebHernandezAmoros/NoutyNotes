import { describe, expect, it } from 'vitest';

import {
  addBoardShortcut, addBoardToWorkspace, addCardToBoard, connectCards, createEmptyWorkspaceNamed, disconnectCards, editCardAppearance, editCardContent, editConnectorPath, moveCardOnBoard, nudgeCardOnBoard, pasteSnapshot, resizeCardOnBoard, snapshotSelection,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, CardId, RelationId, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryStorage, readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/index';

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
  it('P15 crea un conector decorativo y el portapapeles remapea solo anclajes internos', async () => {
    const { storage, workspaceId } = await session();
    const start = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', title: 'Inicio' }));
    const end = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', title: 'Fin' }));
    const connector = ok(await addCardToBoard(storage, workspaceId, { kind: 'connector' }));
    ok(await editCardAppearance(storage, workspaceId, connector, {
      connectorStartCardId: start, connectorEndCardId: end, connectorColor: 'purple', connectorWidth: 'thick', connectorDash: 'dashed', connectorArrows: 'both', connectorDirection: 'up',
    }));
    const created = ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id === connector);
    expect(created).toMatchObject({ typeId: 'conector', frameOverride: 'hidden', connectorColor: 'purple', connectorWidth: 'thick', connectorDash: 'dashed', connectorArrows: 'both', connectorDirection: 'up', connectorStartCardId: start, connectorEndCardId: end });
    expect(ok(await storage.open(workspaceId)).relations).toEqual([]);

    const snapshot = snapshotSelection(ok(await storage.open(workspaceId)), board, [start, connector], 'copy');
    if (!snapshot) throw new Error('sin instantánea');
    ok(await pasteSnapshot(storage, workspaceId, board, snapshot));
    const pasted = ok(await storage.open(workspaceId)).cards.slice(-2);
    const pastedStart = pasted.find((candidate) => candidate.typeId === 'nota');
    const pastedConnector = pasted.find((candidate) => candidate.typeId === 'conector');
    expect(pastedConnector?.connectorStartCardId).toBe(pastedStart?.id);
    expect(pastedConnector && 'connectorEndCardId' in pastedConnector).toBe(false);
  });

  it('P18-D crea dos extremos persistentes, edita codos y copia la ruta por tablero', async () => {
    const { storage, workspaceId } = await session();
    const start = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', title: 'Inicio' }));
    const connectorPath = [{ x: 2, y: 1.5 }, { x: 8, y: 1.5 }, { x: 8, y: 6 }];
    const connector = ok(await addCardToBoard(storage, workspaceId, {
      kind: 'connector', boardId: board, connectorPath, connectorStartCardId: start,
    }));
    let opened = ok(await storage.open(workspaceId));
    expect(opened.cards.find((candidate) => candidate.id === connector)?.connectorStartCardId).toBe(start);
    expect(opened.layouts[0]?.placements.find((candidate) => candidate.cardId === connector)?.connectorPath).toEqual(connectorPath);
    expect(ok(storage.exportPackage(workspaceId))['.nouty/layout.yaml']).toContain('schemaVersion: 5');

    const edited = [{ x: 2, y: 1.5 }, { x: 5, y: 1.5 }, { x: 5, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 6 }];
    ok(await editConnectorPath(storage, workspaceId, { boardId: board, cardId: connector, connectorPath: edited }));
    opened = ok(await storage.open(workspaceId));
    expect(opened.layouts[0]?.placements.find((candidate) => candidate.cardId === connector)?.connectorPath).toEqual(edited);

    const snapshot = snapshotSelection(opened, board, [start, connector], 'copy');
    if (!snapshot) throw new Error('sin instantánea');
    ok(await pasteSnapshot(storage, workspaceId, board, snapshot));
    opened = ok(await storage.open(workspaceId));
    const copiedConnector = opened.cards.filter((candidate) => candidate.typeId === 'conector').at(-1);
    const copiedPlacement = opened.layouts[0]?.placements.find((candidate) => candidate.cardId === copiedConnector?.id);
    const offset = copiedPlacement?.connectorPath?.[0]
      ? { x: copiedPlacement.connectorPath[0].x - edited[0]!.x, y: copiedPlacement.connectorPath[0].y - edited[0]!.y }
      : null;
    expect(offset).not.toBeNull();
    expect(copiedPlacement?.connectorPath?.map((point, index) => ({ x: point.x - edited[index]!.x, y: point.y - edited[index]!.y })))
      .toEqual(edited.map(() => offset));
  });

  it('P14 crea una forma portable, permite cambiar tipo y estilo y el portapapeles los conserva', async () => {
    const { storage, workspaceId } = await session();
    const cardId = ok(await addCardToBoard(storage, workspaceId, { kind: 'shape' }));
    const created = ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id === cardId);
    expect(created).toMatchObject({ typeId: 'forma', fields: {}, frameOverride: 'hidden', shapeKind: 'rectangle', shapeFill: 'blue', shapeStroke: 'default', shapeStrokeWidth: 'medium' });
    ok(await editCardAppearance(storage, workspaceId, cardId, { shapeKind: 'ellipse', shapeFill: 'transparent', shapeStroke: 'red', shapeStrokeWidth: 'thick' }));
    const snapshot = snapshotSelection(ok(await storage.open(workspaceId)), board, [cardId], 'copy');
    if (!snapshot) throw new Error('sin instantánea');
    ok(await pasteSnapshot(storage, workspaceId, board, snapshot));
    const copied = ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id !== cardId);
    expect(copied).toMatchObject({ shapeKind: 'ellipse', shapeFill: 'transparent', shapeStroke: 'red', shapeStrokeWidth: 'thick' });
  });

  it('crea texto flotante como una nota unificada sin título ni marco, con estilo portable', async () => {
    const { storage, workspaceId } = await session();
    const cardId = ok(await addCardToBoard(storage, workspaceId, { kind: 'text', content: 'Primera\nSegunda' }));
    const created = ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id === cardId);
    expect(created).toMatchObject({ typeId: 'nota', content: 'Primera\nSegunda', fields: {}, frameOverride: 'hidden', titleVisibility: 'hidden', bodyVisibility: 'visible' });
    expect(created && 'title' in created).toBe(false);
    ok(await editCardAppearance(storage, workspaceId, cardId, { bodySize: 'large', textAlign: 'center', textColor: 'blue' }));
    const snapshot = snapshotSelection(ok(await storage.open(workspaceId)), board, [cardId], 'copy');
    if (!snapshot) throw new Error('sin instantánea');
    ok(await pasteSnapshot(storage, workspaceId, board, snapshot));
    const copied = ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id !== cardId);
    expect(copied).toMatchObject({ content: 'Primera\nSegunda', frameOverride: 'hidden', bodySize: 'large', textAlign: 'center', textColor: 'blue' });
  });
  it('P18-C: crea un título flotante como presentación de la nota unificada y con layout propio', async () => {
    const { storage, workspaceId } = await session();
    const titleId = ok(await addCardToBoard(storage, workspaceId, { kind: 'title', title: 'Proyecto Solace' }));
    const opened = ok(await storage.open(workspaceId));
    expect(opened.cardTypes).toContainEqual({ id: 'nota', label: 'Nota', base: 'note', fields: [] });
    expect(opened.cards[0]).toMatchObject({ id: titleId, typeId: 'nota', title: 'Proyecto Solace', titleVisibility: 'visible', bodyVisibility: 'hidden', frameOverride: 'hidden' });
    expect(opened.layouts[0]?.placements[0]?.rect).toEqual({ x: 0, y: 0, w: 6, h: 2 });
    const noteId = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    expect(ok(await storage.open(workspaceId)).layouts[0]?.placements.find((placement) => placement.cardId === noteId)?.rect)
      .toEqual({ x: 0, y: 2, w: 4, h: 3 });
    ok(await editCardContent(storage, workspaceId, titleId, { title: 'Ideas que perduran' }));
    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: titleId, to: { x: -3, y: 12 } }));
    expect(ok(storage.exportPackage(workspaceId))['cards/tarjeta-1.md']).toContain('title: Ideas que perduran');
    expect(ok(await storage.open(workspaceId)).layouts[0]?.placements[0]?.rect).toMatchObject({ x: -3, y: 12 });
    const archive = writeWorkspaceArchive(ok(storage.exportPackage(workspaceId)), {});
    if (!archive.ok) throw new Error(JSON.stringify(archive.issues));
    const restored = readWorkspaceArchive(archive.value);
    if (!restored.ok) throw new Error(JSON.stringify(restored.issues));
    expect(restored.value.workspace.cards[0]).toMatchObject({ typeId: 'nota', title: 'Ideas que perduran', bodyVisibility: 'hidden' });
    expect(restored.value.workspace.layouts[0]?.placements[0]?.rect).toMatchObject({ x: -3, y: 12 });
  });
  it('P2: una tarjeta nueva va al primer hueco de la zona visible que indica la interfaz, no fuera de la vista', async () => {
    const { storage, workspaceId } = await session();
    const near = { x: -8, y: 10, columns: 6 };
    const first = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', near }));
    const second = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', near }));
    const rects = ok(await storage.open(workspaceId)).layouts[0]?.placements.map((placement) => [placement.cardId, placement.rect]);
    // Dos tarjetas de 4 columnas no caben lado a lado en 6 columnas visibles: la segunda va debajo.
    expect(rects).toEqual([[first, { x: -8, y: 10, w: 4, h: 3 }], [second, { x: -8, y: 13, w: 4, h: 3 }]]);
    expect(failureOf(await addCardToBoard(storage, workspaceId, { kind: 'note', near: { x: 0, y: 0, columns: 0 } }))).toEqual(['invalid-workspace@input']);
  });
  it('la primera tarjeta crea el tipo, el board principal y su layout; las siguientes ocupan el siguiente hueco', async () => {
    const { storage, workspaceId } = await session();
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }))).toBe('tarjeta-1');
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'image' }))).toBe('tarjeta-2');
    const workspace = ok(await storage.open(workspaceId));
    expect(workspace.cardTypes.map(({ id: typeId, base }) => `${typeId}:${base}`)).toEqual(['nota:note']);
    expect(workspace.boards).toEqual([{ id: 'principal', title: 'Tablero principal', cardIds: ['tarjeta-1', 'tarjeta-2'] }]);
    expect(workspace.cards).toEqual([
      { id: 'tarjeta-1', typeId: 'nota', title: 'Nueva nota', content: '', fields: {} },
      { id: 'tarjeta-2', typeId: 'nota', title: 'Imagen', content: '', fields: {}, contentLayout: 'banner' },
    ]);
    expect(workspace.layouts[0]?.placements.map(({ rect }) => rect)).toEqual([{ x: 0, y: 0, w: 4, h: 3 }, { x: 4, y: 0, w: 6, h: 7 }]);
    expect(Object.keys(ok(storage.exportPackage(workspaceId)))).toContain('cards/tarjeta-1.md');
  });

  it('no reutiliza IDs de tarjetas existentes y acepta un título', async () => {
    const { storage, workspaceId } = await session();
    ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    expect(ok(await addCardToBoard(storage, workspaceId, { kind: 'note', title: 'Guion' }))).toBe('tarjeta-2');
    expect(ok(await storage.open(workspaceId)).cards[1]?.title).toBe('Guion');
  });

  it('crea una nota con contenido inicial sin permitir contenido en otros tipos', async () => {
    const { storage, workspaceId } = await session();
    const table = '| A | B | C |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |';
    const note = ok(await addCardToBoard(storage, workspaceId, { kind: 'note', content: table }));
    expect(ok(await storage.open(workspaceId)).cards.find((candidate) => candidate.id === note)?.content).toBe(table);
    expect(failureOf(await addCardToBoard(storage, workspaceId, { kind: 'title', content: table })))
      .toEqual(['invalid-workspace@input']);
  });

  it('un workspace inexistente devuelve workspace-not-found', async () => {
    const { storage } = await session();
    expect(failureOf(await addCardToBoard(storage, id('ghost'), { kind: 'note' }))).toEqual(['workspace-not-found@id']);
    expect(failureOf(await addCardToBoard(storage, id('mis-ideas'), { kind: 'video' as 'note' })))
      .toEqual(['invalid-workspace@input']);
  });
});

describe('editar, mover, redimensionar y relacionar a través del puerto (fase 7)', () => {
  it('persiste posiciones finas, iconos y atajos a tableros con formato selectivo', async () => {
    const { storage, workspaceId } = await session();
    const note = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    const secondBoard = ok(await addBoardToWorkspace(storage, workspaceId, { title: 'Referencias' }));
    ok(await editCardAppearance(storage, workspaceId, note, { icon: 'star' }));
    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: note, to: { x: 0.25, y: 0.5 } }));
    const shortcut = ok(await addBoardShortcut(storage, workspaceId, { boardId: board, targetBoardId: secondBoard }));
    const opened = ok(await storage.open(workspaceId));
    expect(opened.cards.find((candidate) => candidate.id === note)?.icon).toBe('star');
    expect(opened.cards.find((candidate) => candidate.id === shortcut)).toMatchObject({ icon: 'folder', boardTargetId: secondBoard });
    expect(opened.layouts[0]?.placements.find((placement) => placement.cardId === note)?.rect).toMatchObject({ x: 0.25, y: 0.5 });
    const files = ok(storage.exportPackage(workspaceId));
    expect(files['.nouty/layout.yaml']).toContain('schemaVersion: 4');
    expect(files[`cards/${shortcut}.md`]).toContain('schemaVersion: 4');
  });
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

    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: -2, y: -3 } }));
    expect((await rects())?.[0]).toMatchObject({ x: -2, y: -3 });
    expect(ok(storage.exportPackage(workspaceId))['.nouty/layout.yaml']).toContain('schemaVersion: 2');
    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: 20, y: 0 } }));
    ok(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: 0, y: 0 } }));
    // Sin posiciones negativas el layout vuelve a v1: una app que solo conoce v1 puede abrirlo otra vez
    // (x = 20 ya era válido en v1).
    expect(ok(storage.exportPackage(workspaceId))['.nouty/layout.yaml']).toContain('schemaVersion: 1');

    const before = ok(storage.exportPackage(workspaceId));
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: -1_000_001, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@to']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, to: { x: 1_000_000, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@to']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: board, cardId: second, to: { x: 4, y: 1 } })))
      .toEqual(['invalid-workspace@transform', 'grid-collision@placements[0]']);
    expect(failureOf(await resizeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, size: { w: 5, h: 4 } })))
      .toEqual(['invalid-workspace@transform', 'grid-collision@placements[1]']);
    expect(failureOf(await resizeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, size: { w: 1_000_001, h: 1 } })))
      .toEqual(['invalid-workspace@transform', 'out-of-bounds@size']);
    expect(failureOf(await moveCardOnBoard(storage, workspaceId, { boardId: 'otro' as BoardId, cardId: first, to: { x: 0, y: 0 } })))
      .toEqual(['invalid-workspace@transform', 'missing-reference@boardId']);
    expect(ok(storage.exportPackage(workspaceId))).toEqual(before);
  });

  it('acumula movimientos relativos aunque las acciones se hayan creado desde la misma vista', async () => {
    const { storage, workspaceId } = await session();
    const first = ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));

    // La interfaz encola estas acciones antes de recibir el workspace actualizado. Cada una debe
    // partir de lo que quedó guardado por la anterior, no de la geometría capturada al renderizar.
    ok(await nudgeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, delta: { x: 0, y: -1 } }));
    ok(await nudgeCardOnBoard(storage, workspaceId, { boardId: board, cardId: first, delta: { x: 0, y: -1 } }));

    expect(ok(await storage.open(workspaceId)).layouts[0]?.placements[0]?.rect)
      .toEqual({ x: 0, y: -2, w: 4, h: 3 });
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
    expect(ok(await storage.open(other)).cards.map(({ typeId }) => typeId)).toEqual(['nota']);
    expect(ok(await storage.list()).map(({ id: workspace }) => workspace)).toEqual(['mis-ideas', 'otro']);
  });
});
