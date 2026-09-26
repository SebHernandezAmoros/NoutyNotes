import type { Board, BoardLayout, CardId } from '@noutynotes/domain';

/**
 * Tarjetas que el tablero declara pero su layout no coloca (válido en v1: el layout es opcional).
 * El lienzo no puede dibujarlas y lo dice, en lugar de presentar el tablero como vacío.
 */
export function unplacedCardIds(board: Board | undefined, layout: BoardLayout | undefined): CardId[] {
  if (!board) return [];
  const placed = new Set(layout?.placements.map((placement) => placement.cardId) ?? []);
  return board.cardIds.filter((cardId) => !placed.has(cardId));
}
