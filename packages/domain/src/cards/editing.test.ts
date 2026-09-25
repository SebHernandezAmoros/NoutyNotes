import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../__fixtures__/grid';
import { id, ideaA, ideaB, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import type { BoardId, CardId, CardTypeId } from '../ids';
import { DESKTOP_GRID, validateGridLayout } from '../layouts/grid';
import { validateWorkspace } from '../workspace/workspace';
import type { Card } from './card';
import { addCard, updateCard } from './operations';

const overview = id<BoardId>('overview');
const research = id<BoardId>('research');
const cardC: Card = { id: id<CardId>('idea-c'), typeId: id<CardTypeId>('note'), title: 'Idea C', content: 'Texto', fields: { summary: 'C' } };
const size = { w: 4, h: 3 };

describe('añadir una tarjeta a un board (fase 7)', () => {
  it('la agrega al workspace, al final del board y en el primer hueco libre del layout', () => {
    const base = deepFreeze(validWorkspace());
    const result = assertValid(addCard(base, cardC, { boardId: overview, size, config: DESKTOP_GRID }));
    expect(result.cards).toEqual([...validWorkspace().cards, cardC]);
    expect(result.boards[0]?.cardIds).toEqual([ideaA.id, ideaB.id, cardC.id]);
    expect(result.boards[1]).toEqual(validWorkspace().boards[1]);
    // A ocupa 0..3 y la huella minimizada de B ocupa la columna 4: el primer hueco es x = 5.
    expect(result.layouts[0]?.placements.at(-1)).toEqual({ cardId: cardC.id, rect: { x: 5, y: 0, w: 4, h: 3 }, display: 'expanded' });
    expect(result.relations).toEqual(validWorkspace().relations);
    expect(validateWorkspace(result).ok).toBe(true);
    expect(validateGridLayout(result.layouts[0]!, DESKTOP_GRID).ok).toBe(true);
    expect(base).toEqual(validWorkspace());
  });

  it('crea el layout del board si todavía no tenía uno', () => {
    const result = assertValid(addCard(validWorkspace(), cardC, { boardId: research, size, config: DESKTOP_GRID }));
    expect(result.boards[1]?.cardIds).toEqual([ideaA.id, cardC.id]);
    expect(result.layouts).toEqual([
      ...validWorkspace().layouts,
      { boardId: research, placements: [{ cardId: cardC.id, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }] },
    ]);
  });

  it('no inventa datos: rechaza IDs repetidos, tipos o boards inexistentes y tarjetas inválidas', () => {
    const add = (card: unknown, boardId: unknown = overview) =>
      problems(addCard(validWorkspace(), unsafe(card), { boardId: unsafe(boardId), size, config: DESKTOP_GRID }));
    expect(add({ ...cardC, id: ideaA.id })).toEqual(['duplicate-id@card.id']);
    expect(add({ ...cardC, typeId: 'ghost' })).toEqual(['missing-reference@card.typeId']);
    expect(add(cardC, 'ghost')).toEqual(['missing-reference@options.boardId']);
    expect(add(cardC, 'Mal ID')).toEqual(['invalid-id@options.boardId']);
    expect(add({ ...cardC, title: '  ' })).toEqual(['invalid-value@card.title']);
    expect(add({ ...cardC, fields: {} })).toEqual(['missing-required-field@card.fields.summary']);
    expect(add(null)).toEqual(['invalid-value@card']);
  });

  it('devuelve los errores del motor de grilla sin colocar la tarjeta', () => {
    expect(problems(addCard(validWorkspace(), cardC, { boardId: overview, size: { w: 13, h: 1 }, config: DESKTOP_GRID })))
      .toEqual(['out-of-bounds@size']);
    // Con 5 columnas y 3 filas no queda ningún hueco de 1×3.
    expect(problems(addCard(validWorkspace(), cardC, { boardId: overview, size: { w: 1, h: 3 }, config: { columns: 5, rows: 3 } })))
      .toEqual(['no-free-space@size']);
    expect(problems(addCard(validWorkspace(), cardC, { boardId: overview, size: { w: 0, h: 1 }, config: DESKTOP_GRID })))
      .toEqual(['invalid-layout@size.w']);
  });

  it('rechaza opciones y workspaces inválidos antes de operar', () => {
    expect(problems(addCard(validWorkspace(), cardC, unsafe(null)))).toEqual(['invalid-value@options']);
    expect(addCard(unsafe(null), cardC, { boardId: overview, size, config: DESKTOP_GRID }).ok).toBe(false);
  });
});

describe('editar título y Markdown de una tarjeta (fase 7)', () => {
  it('cambia solo título y contenido; campos, assets, boards, layouts y relaciones se conservan', () => {
    const base = deepFreeze(validWorkspace());
    const result = assertValid(updateCard(base, ideaA.id, { title: 'Nuevo', content: '## Otro\n\n- punto' }));
    expect(result.cards[0]).toEqual({ ...ideaA, title: 'Nuevo', content: '## Otro\n\n- punto' });
    expect(result.cards[1]).toBe(base.cards[1]);
    expect({ ...result, cards: [] }).toEqual({ ...validWorkspace(), cards: [] });
    expect(base).toEqual(validWorkspace());
  });

  it('un título en blanco elimina el título; el Markdown se guarda literal, incluso vacío', () => {
    const cleared = assertValid(updateCard(validWorkspace(), ideaA.id, { title: '   ', content: '' }));
    expect(cleared.cards[0]).not.toHaveProperty('title');
    expect(cleared.cards[0]?.content).toBe('');
    const named = assertValid(updateCard(validWorkspace(), ideaB.id, { title: ' Con espacios ' }));
    expect(named.cards[1]).toEqual({ ...ideaB, title: ' Con espacios ' });
  });

  it('los cambios omitidos no se tocan', () => {
    expect(assertValid(updateCard(validWorkspace(), ideaA.id, { title: 'T' })).cards[0]?.content).toBe(ideaA.content);
    expect(assertValid(updateCard(validWorkspace(), ideaA.id, { content: 'C' })).cards[0]?.title).toBe(ideaA.title);
    expect(assertValid(updateCard(validWorkspace(), ideaA.id, {}))).toEqual(validWorkspace());
  });

  it('rechaza tarjetas inexistentes, cambios mal formados o propiedades no editables', () => {
    const update = (cardId: unknown, changes: unknown) => problems(updateCard(validWorkspace(), unsafe(cardId), unsafe(changes)));
    expect(update('absent', { title: 'x' })).toEqual(['missing-reference@cardId']);
    expect(update('Mal ID', { title: 'x' })).toEqual(['invalid-id@cardId']);
    expect(update(ideaA.id, null)).toEqual(['invalid-value@changes']);
    expect(update(ideaA.id, { title: 3 })).toEqual(['invalid-value@changes.title']);
    expect(update(ideaA.id, { content: null })).toEqual(['invalid-value@changes.content']);
    expect(update(ideaA.id, { fields: {} })).toEqual(['unknown-property@changes.fields']);
    expect(updateCard(unsafe(null), ideaA.id, {}).ok).toBe(false);
  });
});
