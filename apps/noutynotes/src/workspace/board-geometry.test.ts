import { describe, expect, it } from 'vitest';

import type { BoardId, BoardLayout, CardId, RelationId, RelationTypeId } from '@noutynotes/domain';

import { BOARD_GAP, BOARD_ROW_HEIGHT, boardBoxes, relationSegments } from './board-geometry';

const place = (cardId: string, x: number, y: number, w: number, h: number) =>
  ({ cardId: cardId as CardId, rect: { x, y, w, h }, display: 'expanded' as const });
const layout: BoardLayout = { boardId: 'b' as BoardId, placements: [place('b', 4, 0, 4, 3), place('a', 0, 0, 4, 3), place('c', 0, 3, 12, 2)] };

describe('geometría del tablero (fase 7)', () => {
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
});
