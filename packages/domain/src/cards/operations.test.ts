import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../__fixtures__/grid';
import { id, ideaA, ideaB, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import type { CardId, RelationId } from '../ids';
import type { Relation } from '../relations/relation';
import { validateWorkspace } from '../workspace/workspace';
import { deleteCard } from './operations';

describe('borrado de tarjeta con relaciones', () => {
  it('restringe el borrado con conexiones por defecto y explícitamente', () => {
    const base = deepFreeze(validWorkspace());
    for (const options of [{}, { relations: 'restrict' as const }]) {
      expect(problems(deleteCard(base, ideaA.id, options))).toEqual(['card-has-relations@cardId']);
      expect(problems(deleteCard(base, ideaB.id, options))).toEqual(['card-has-relations@cardId']);
    }
    expect(base).toEqual(validWorkspace());
  });
  it('cascade limpia entradas/salidas y todas las apariciones, conservando el resto', () => {
    const workspace = validWorkspace();
    const original = workspace.relations[0] as Relation;
    const cardC = { ...ideaB, id: id<CardId>('idea-c') };
    const incoming = { ...original, id: id<RelationId>('incoming'), from: cardC.id, to: ideaA.id };
    const survivor = { ...original, id: id<RelationId>('survivor'), from: ideaB.id, to: cardC.id };
    const secondBoard = workspace.boards[1]!;
    const base = deepFreeze({ ...workspace, cards: [...workspace.cards, cardC], relations: [incoming, survivor, original],
      layouts: [...workspace.layouts, { boardId: secondBoard.id, placements: [workspace.layouts[0]!.placements[0]!] }],
    });
    const result = assertValid(deleteCard(base, ideaA.id, { relations: 'cascade' }));
    expect(result.cards).toEqual([ideaB, cardC]);
    expect(result.relations).toEqual([survivor]);
    expect(result.boards.map(b => b.cardIds)).toEqual([[ideaB.id], []]);
    expect(result.layouts.map(l => l.placements.map(p => p.cardId))).toEqual([[ideaB.id], []]);
    expect(result.metadata).toBe(base.metadata);
    expect(result.cardTypes).toBe(base.cardTypes);
    expect(result.relationTypes).toBe(base.relationTypes);
    expect(validateWorkspace(result).ok).toBe(true);
    expect(base.cards).toHaveLength(3);
    expect(base.relations).toHaveLength(3);
    expect(deleteCard(base, ideaA.id, { relations: 'cascade' })).toEqual(deleteCard(base, ideaA.id, { relations: 'cascade' }));
  });
  it('borra una tarjeta aislada y conserva las otras relaciones', () => {
    const cardC = { ...ideaB, id: id<CardId>('isolated') };
    const base = deepFreeze({ ...validWorkspace(), cards: [...validWorkspace().cards, cardC] });
    const result = assertValid(deleteCard(base, cardC.id));
    expect(result).toEqual(validWorkspace());
  });
  it('puede borrar la última tarjeta sin eliminar boards ni layouts', () => {
    const first = assertValid(deleteCard(validWorkspace(), ideaA.id, { relations: 'cascade' }));
    const last = assertValid(deleteCard(first, ideaB.id));
    expect(last.cards).toEqual([]);
    expect(last.relations).toEqual([]);
    expect(last.boards).toHaveLength(2);
    expect(last.layouts).toHaveLength(1);
    expect(validateWorkspace(last).ok).toBe(true);
  });
  it.each([null, [], 'cascade', { relations: null }, { relations: 'unknown' }].map(options => ({ options })))('rechaza opciones inválidas ($options)', ({ options }) => {
    expect(deleteCard(validWorkspace(), ideaA.id, unsafe(options)).ok).toBe(false);
  });
  it('rechaza tarjeta inexistente, ID inválido y workspace inválido antes de operar', () => {
    expect(problems(deleteCard(validWorkspace(), id<CardId>('absent')))).toEqual(['missing-reference@cardId']);
    expect(problems(deleteCard(validWorkspace(), unsafe(null)))).toEqual(['invalid-id@cardId']);
    expect(deleteCard(unsafe(null), ideaA.id).ok).toBe(false);
    expect(deleteCard(unsafe({ ...validWorkspace(), layouts: null }), ideaA.id, { relations: 'cascade' }).ok).toBe(false);
  });
});
