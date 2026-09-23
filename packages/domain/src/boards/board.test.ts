import { describe, expect, it } from 'vitest';

import { problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { validateBoard } from './board';
import type { Board } from './board';

const board = validWorkspace().boards[0] as Board;

describe('boards', () => {
  it('acepta un board con tarjetas ordenadas y uno vacío', () => {
    expect(validateBoard(board).ok).toBe(true);
    expect(validateBoard({ ...board, cardIds: [] }).ok).toBe(true);
  });

  it.each([
    ['sin título', { title: '' }, 'invalid-value@board.title'],
    ['id inválido', { id: 'Mi Board' }, 'invalid-id@board.id'],
    ['tarjeta repetida', { cardIds: ['idea-a', 'idea-a'] }, 'duplicate-id@board.cardIds[1]'],
    ['referencia mal formada', { cardIds: ['Idea A'] }, 'invalid-id@board.cardIds[0]'],
    ['tarjetas incrustadas en lugar de referencias', { cardIds: [{ id: 'idea-a' }] }, 'invalid-id@board.cardIds[0]'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(validateBoard(unsafe<Board>({ ...board, ...change })))).toContain(expected);
  });
});
