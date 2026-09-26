import type { Board, BoardLayout, CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { unplacedCardIds } from './boardCards';

const id = (value: string) => value as CardId;
const board = (cardIds: string[]): Board => ({ id: 'research' as Board['id'], title: 'Investigación', cardIds: cardIds.map(id) });
const layout = (placed: string[]): BoardLayout => ({
  boardId: 'research' as BoardLayout['boardId'],
  placements: placed.map((cardId, index) => ({ cardId: id(cardId), rect: { x: 0, y: index * 3, w: 4, h: 3 }, display: 'expanded' })),
});

describe('tarjetas del tablero sin posición (formato v1 válido)', () => {
  it('sin layout, todas las tarjetas del tablero están sin posición', () => {
    expect(unplacedCardIds(board(['idea-a']), undefined)).toEqual(['idea-a']);
  });

  it('solo cuenta las que faltan en el layout, en el orden del tablero', () => {
    expect(unplacedCardIds(board(['a', 'b', 'c']), layout(['b']))).toEqual(['a', 'c']);
    expect(unplacedCardIds(board(['a']), layout(['a']))).toEqual([]);
  });

  it('sin tablero no hay nada que colocar', () => {
    expect(unplacedCardIds(undefined, undefined)).toEqual([]);
  });
});
