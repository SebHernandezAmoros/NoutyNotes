import { describe, expect, it } from 'vitest';

import type { BoardId, BoardLayout, Card, CardId, RelationId, RelationTypeId } from '@noutynotes/domain';

import { BOARD_GAP, BOARD_ROW_HEIGHT, boardBoxes, connectorRoutes, connectorSegments, projectedCardBoxes, relationSegments } from './board-geometry';

const place = (cardId: string, x: number, y: number, w: number, h: number) =>
  ({ cardId: cardId as CardId, rect: { x, y, w, h }, display: 'expanded' as const });
const layout: BoardLayout = { boardId: 'b' as BoardId, placements: [place('b', 4, 0, 4, 3), place('a', 0, 0, 4, 3), place('c', 0, 3, 12, 2)] };

describe('geometría del tablero (fase 7)', () => {
  it('comparte la caja provisional exacta entre tarjetas, relaciones y conectores', () => {
    const placements = [
      { cardId: 'a' as CardId, rect: { x: 0, y: 0, w: 2, h: 2 }, display: 'expanded' as const },
      { cardId: 'b' as CardId, rect: { x: 4, y: 0, w: 2, h: 2 }, display: 'expanded' as const },
    ];
    const exact = new Map([[placements[0]!.cardId, { left: 100, top: 25, width: 92, height: 92 }]]);
    const boxes = projectedCardBoxes(placements, { cell: 50, row: 50, gap: 8 }, new Map(), exact);
    expect(boxes[0]).toMatchObject(exact.get(placements[0]!.cardId)!);
    const [line] = relationSegments([{ id: 'r' as RelationId, typeId: 't' as RelationTypeId, from: placements[0]!.cardId, to: placements[1]!.cardId }], boxes);
    expect(line?.startX).toBeGreaterThanOrEqual(100);
  });

  it('redimensiona una nota y mueve con ella la relación y el conector anclado', () => {
    const placements = [
      place('a', 0, 0, 2, 2),
      place('b', 6, 0, 2, 2),
      {
        ...place('connector', 2, 3, 2, 1),
        connectorPath: [{ x: 2, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 1 }],
      },
    ];
    const metrics = { cell: 50, row: 50, gap: 8 };
    const relation = { id: 'r' as RelationId, typeId: 't' as RelationTypeId, from: 'a' as CardId, to: 'b' as CardId };
    const connector = {
      id: 'connector', typeId: 'conector', fields: {},
      connectorStartCardId: 'a', connectorEndCardId: 'b',
    } as Card;
    const before = projectedCardBoxes(placements, metrics);
    const after = projectedCardBoxes(
      placements,
      metrics,
      new Map([['a' as CardId, { x: 0, y: 0, w: 4, h: 3 }]]),
    );

    expect(relationSegments([relation], after)[0]?.startX).toBeGreaterThan(relationSegments([relation], before)[0]?.startX ?? 0);
    const beforeRoute = connectorRoutes([connector], placements, before, metrics)[0];
    const afterRoute = connectorRoutes([connector], placements, after, metrics)[0];
    expect(afterRoute?.points[0]).not.toEqual(beforeRoute?.points[0]);
    expect(afterRoute?.segments.every(({ angle }) => angle === 0 || Math.abs(angle) === 90)).toBe(true);
  });

  it('proyecta una selección múltiple como una sola geometría y cancelar restaura la base', () => {
    const placements = [place('a', 0, 0, 2, 2), place('b', 5, 0, 2, 2)];
    const metrics = { cell: 50, row: 50, gap: 8 };
    const relation = { id: 'r' as RelationId, typeId: 't' as RelationTypeId, from: 'a' as CardId, to: 'b' as CardId };
    const baseBoxes = projectedCardBoxes(placements, metrics);
    const movedBoxes = projectedCardBoxes(placements, metrics, new Map([
      ['a' as CardId, { x: 2, y: 3, w: 2, h: 2 }],
      ['b' as CardId, { x: 7, y: 3, w: 2, h: 2 }],
    ]));
    const base = relationSegments([relation], baseBoxes)[0];
    const moved = relationSegments([relation], movedBoxes)[0];

    expect(moved?.startX).toBe((base?.startX ?? 0) + 100);
    expect(moved?.startY).toBe((base?.startY ?? 0) + 150);
    expect(relationSegments([relation], projectedCardBoxes(placements, metrics))[0]).toEqual(base);
  });
  it('en modo amplio dibuja el layout canónico de 12 columnas sin modificarlo', () => {
    const board = boardBoxes(layout, 'wide', 1200);
    expect(board?.columns).toBe(12);
    const a = board?.boxes.find((box) => box.cardId === 'a');
    const b = board?.boxes.find((box) => box.cardId === 'b');
    expect(a).toMatchObject({ left: BOARD_GAP / 2, top: BOARD_GAP / 2, width: 400 - BOARD_GAP, height: 3 * BOARD_ROW_HEIGHT - BOARD_GAP });
    expect(b?.left).toBe(400 + BOARD_GAP / 2);
    expect(board?.height).toBe(5 * BOARD_ROW_HEIGHT);
    // Orden de lectura canónico, útil para el orden de tabulación.
    expect(board?.boxes.map(({ cardId }) => cardId)).toEqual(['a', 'b', 'c']);
  });

  it('en modo compacto usa la proyección de una columna, en orden de lectura y a todo el ancho', () => {
    const board = boardBoxes(layout, 'compact', 350);
    expect(board?.columns).toBe(1);
    expect(board?.boxes.map(({ cardId, top, width }) => [cardId, top, width])).toEqual([
      ['a', BOARD_GAP / 2, 350 - BOARD_GAP],
      ['b', 3 * BOARD_ROW_HEIGHT + BOARD_GAP / 2, 350 - BOARD_GAP],
      ['c', 6 * BOARD_ROW_HEIGHT + BOARD_GAP / 2, 350 - BOARD_GAP],
    ]);
    expect(board?.height).toBe(8 * BOARD_ROW_HEIGHT);
  });

  it('un tablero vacío reserva altura y un ancho desconocido no produce cajas', () => {
    expect(boardBoxes({ boardId: 'b' as BoardId, placements: [] }, 'wide', 800)).toEqual({ columns: 12, boxes: [], height: 3 * BOARD_ROW_HEIGHT });
    expect(boardBoxes(layout, 'wide', 0)).toBeNull();
  });

  it('las líneas de relación van del borde de origen al borde de destino, fuera de las tarjetas', () => {
    const board = boardBoxes(layout, 'wide', 1200);
    const relations = [
      { id: 'r1' as RelationId, typeId: 't' as RelationTypeId, from: 'a' as CardId, to: 'b' as CardId },
      { id: 'r2' as RelationId, typeId: 't' as RelationTypeId, from: 'a' as CardId, to: 'ghost' as CardId },
      { id: 'r3' as RelationId, typeId: 't' as RelationTypeId, from: 'c' as CardId, to: 'a' as CardId },
    ];
    const [horizontal, vertical, ...rest] = relationSegments(relations, board?.boxes ?? []);
    expect(rest).toEqual([]);
    // a y b son contiguas: la línea ocupa solo el hueco entre ambas, sin rotación.
    expect(horizontal).toMatchObject({ relationId: 'r1', startX: 396, endX: 404 });
    expect(horizontal?.length).toBeCloseTo(BOARD_GAP);
    expect(horizontal?.angle).toBeCloseTo(0);
    expect(horizontal?.left).toBeCloseTo(396);
    // De c (abajo, a todo el ancho) hacia a: la dirección sale por el borde derecho de a.
    expect(vertical?.relationId).toBe('r3');
    expect(vertical?.endX).toBeCloseTo(400 - BOARD_GAP / 2);
    expect(vertical?.startY).toBeCloseTo(3 * BOARD_ROW_HEIGHT + BOARD_GAP / 2);
    expect(vertical?.angle).toBeLessThan(0);
  });

  it('no dibuja línea entre tarjetas que se tocan o se solapan en pantalla', () => {
    const boxes = [
      { cardId: 'a' as CardId, left: 0, top: 0, width: 100, height: 100 },
      { cardId: 'b' as CardId, left: 50, top: 0, width: 100, height: 100 },
    ];
    expect(relationSegments([{ id: 'r' as RelationId, typeId: 't' as RelationTypeId, from: 'a' as CardId, to: 'b' as CardId }], boxes)).toEqual([]);
  });

  it('proyecta extremos libres o anclados sin crear una relación semántica (P15)', () => {
    const boxes = [
      { cardId: 'connector' as CardId, left: 100, top: 100, width: 200, height: 100 },
      { cardId: 'a' as CardId, left: 0, top: 100, width: 80, height: 80 },
      { cardId: 'b' as CardId, left: 340, top: 40, width: 100, height: 100 },
    ];
    const connector = { id: 'connector', typeId: 'conector', fields: {}, connectorDirection: 'down', connectorStartCardId: 'a', connectorEndCardId: 'b' } as Card;
    const [anchored] = connectorSegments([connector], boxes);
    expect(anchored).toMatchObject({ cardId: 'connector' });
    expect(anchored?.startX).toBeGreaterThanOrEqual(76);
    expect(anchored?.endX).toBeGreaterThanOrEqual(340);
    const { connectorStartCardId: _start, connectorEndCardId: _end, ...withoutAnchors } = connector;
    const [free] = connectorSegments([withoutAnchors as Card], boxes);
    expect(free).toMatchObject({ startX: 100, startY: 100, endX: 300, endY: 200 });
  });

  it('proyecta una ruta P18-D como tramos ortogonales sin usar la caja portadora visible', () => {
    const connector = { id: 'connector', typeId: 'conector', fields: {} } as Card;
    const placement = {
      cardId: 'connector' as CardId,
      rect: { x: 1, y: 2, w: 1, h: 1 },
      display: 'expanded' as const,
      connectorPath: [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }],
    };
    const boxes = [{ cardId: 'connector' as CardId, left: 104, top: 116, width: 92, height: 48 }];
    const [route] = connectorRoutes([connector], [placement], boxes, { cell: 100, row: 56, gap: 8 });
    expect(route?.legacy).toBe(false);
    expect(route?.points).toEqual([{ x: 100, y: 112 }, { x: 400, y: 112 }, { x: 400, y: 280 }]);
    expect(route?.segments.map(({ angle, length }) => [angle, length])).toEqual([[0, 300], [90, 168]]);
  });

  it('mueve el extremo anclado al borde y conserva el primer tramo ortogonal', () => {
    const connector = { id: 'connector', typeId: 'conector', fields: {}, connectorStartCardId: 'a' } as Card;
    const placement = {
      cardId: 'connector' as CardId,
      rect: { x: 1, y: 2, w: 1, h: 1 },
      display: 'expanded' as const,
      connectorPath: [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }],
    };
    const boxes = [
      { cardId: 'connector' as CardId, left: 104, top: 116, width: 92, height: 48 },
      { cardId: 'a' as CardId, left: 10, top: 20, width: 80, height: 60 },
    ];
    const [route] = connectorRoutes([connector], [placement], boxes, { cell: 100, row: 56, gap: 8 });
    expect(route?.points[0]).toEqual({ x: 90, y: 50 });
    expect(route?.points[1]).toEqual({ x: 400, y: 50 });
    expect(route?.segments.every((item) => item.angle === 0 || Math.abs(item.angle) === 90)).toBe(true);
  });
});
