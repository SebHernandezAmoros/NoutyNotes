import { expect, it } from 'vitest';
import type { BoardLayout } from './layout';
import type { BoardId, CardId } from '../ids';
import { WORLD_GRID } from './grid';
import { moveCard, resizeCardRect } from './operations';

it('cambia posición y tamaño en una sola candidata con el lado opuesto fijo', () => {
  const cardId = 'a' as CardId;
  const layout: BoardLayout = { boardId: 'board' as BoardId, placements: [{ cardId, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }] };
  const result = resizeCardRect(layout, cardId, { x: 1, y: 1, w: 3, h: 2 }, WORLD_GRID);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.placements[0]?.rect).toEqual({ x: 1, y: 1, w: 3, h: 2 });
});

it('valida el rect final sin pasar por un movimiento intermedio que colisionaría', () => {
  const cardId = 'a' as CardId;
  const layout: BoardLayout = { boardId: 'board' as BoardId, placements: [
    { cardId, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' },
    { cardId: 'b' as CardId, rect: { x: 4, y: 0, w: 2, h: 3 }, display: 'expanded' },
  ] };
  const source = structuredClone(layout);
  expect(moveCard(layout, cardId, { x: 1, y: 1 }, WORLD_GRID).ok).toBe(false);
  const final = resizeCardRect(layout, cardId, { x: 1, y: 1, w: 3, h: 2 }, WORLD_GRID);
  expect(final.ok).toBe(true);
  expect(layout).toEqual(source);
  expect(resizeCardRect(layout, cardId, { x: 1, y: 1, w: 5, h: 2 }, WORLD_GRID).ok).toBe(false);
  expect(layout).toEqual(source);
});
