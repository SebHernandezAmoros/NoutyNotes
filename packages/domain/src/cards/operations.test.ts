import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../__fixtures__/grid';
import { id, ideaA, ideaB, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import type { CardId, RelationId } from '../ids';
import type { Relation } from '../relations/relation';
import { validateWorkspace } from '../workspace/workspace';
import { deleteCard, updateCardAppearance } from './operations';

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
  it('P15 libera solo el extremo anclado a una tarjeta borrada', () => {
    const base = validWorkspace();
    const connectorId = id<CardId>('connector');
    const workspace = {
      ...base,
      cardTypes: [...base.cardTypes, { id: 'conector', label: 'Conector', base: 'connector', fields: [] }],
      cards: [...base.cards, { id: connectorId, typeId: 'conector', fields: {}, connectorStartCardId: ideaA.id, connectorEndCardId: ideaB.id }],
    } as unknown as ReturnType<typeof validWorkspace>;
    const result = assertValid(deleteCard(workspace, ideaA.id, { relations: 'cascade' }));
    const connector = result.cards.find((card) => card.id === connectorId);
    expect(connector && 'connectorStartCardId' in connector).toBe(false);
    expect(connector?.connectorEndCardId).toBe(ideaB.id);
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

describe('excepción de marco por ficha (ADR 0049)', () => {
  it('ausente por defecto; se puede fijar a "hidden"/"visible" y volver a ausente con null', () => {
    const base = validWorkspace();
    expect(ideaA.frameOverride).toBeUndefined();
    const hidden = assertValid(updateCardAppearance(base, ideaA.id, { frameOverride: 'hidden' }));
    expect(hidden.cards.find(c => c.id === ideaA.id)?.frameOverride).toBe('hidden');
    const visible = assertValid(updateCardAppearance(hidden, ideaA.id, { frameOverride: 'visible' }));
    expect(visible.cards.find(c => c.id === ideaA.id)?.frameOverride).toBe('visible');
    const cleared = assertValid(updateCardAppearance(visible, ideaA.id, { frameOverride: null }));
    expect(cleared.cards.find(c => c.id === ideaA.id)?.frameOverride).toBeUndefined();
    // `undefined` (ausente de los cambios) no lo toca.
    const untouched = assertValid(updateCardAppearance(hidden, ideaA.id, { icon: 'star' }));
    expect(untouched.cards.find(c => c.id === ideaA.id)?.frameOverride).toBe('hidden');
    expect(base).toEqual(validWorkspace());
  });
  it('rechaza un valor que no sea "visible" u "hidden"', () => {
    expect(problems(updateCardAppearance(validWorkspace(), ideaA.id, unsafe({ frameOverride: 'invisible' })))).toEqual(['invalid-value@changes.frameOverride']);
    expect(problems(updateCardAppearance(validWorkspace(), ideaA.id, unsafe({ frameOverride: 3 })))).toEqual(['invalid-value@changes.frameOverride']);
  });
  it('no cambia icono ni destino de tablero al tocar solo el marco', () => {
    const withIcon = assertValid(updateCardAppearance(validWorkspace(), ideaA.id, { icon: 'star' }));
    const withFrame = assertValid(updateCardAppearance(withIcon, ideaA.id, { frameOverride: 'hidden' }));
    const card = withFrame.cards.find(c => c.id === ideaA.id);
    expect(card?.icon).toBe('star');
    expect(card?.frameOverride).toBe('hidden');
  });
});

describe('tamaños de título y cuerpo por ficha (ADR 0050)', () => {
  it('ausentes por defecto; se pueden fijar a "small"/"large"/"medium" y volver a ausente con null', () => {
    const base = validWorkspace();
    expect(ideaA.titleSize).toBeUndefined();
    expect(ideaA.bodySize).toBeUndefined();
    const sized = assertValid(updateCardAppearance(base, ideaA.id, { titleSize: 'large', bodySize: 'small' }));
    const card = sized.cards.find(c => c.id === ideaA.id);
    expect(card?.titleSize).toBe('large');
    expect(card?.bodySize).toBe('small');
    const medium = assertValid(updateCardAppearance(sized, ideaA.id, { titleSize: 'medium' }));
    expect(medium.cards.find(c => c.id === ideaA.id)?.titleSize).toBe('medium');
    const cleared = assertValid(updateCardAppearance(medium, ideaA.id, { titleSize: null, bodySize: null }));
    const clearedCard = cleared.cards.find(c => c.id === ideaA.id);
    expect(clearedCard?.titleSize).toBeUndefined();
    expect(clearedCard?.bodySize).toBeUndefined();
    expect(base).toEqual(validWorkspace());
  });
  it('rechaza un valor que no sea "small", "medium" o "large"', () => {
    expect(problems(updateCardAppearance(validWorkspace(), ideaA.id, unsafe({ titleSize: 'enorme' })))).toEqual(['invalid-value@changes.titleSize']);
    expect(problems(updateCardAppearance(validWorkspace(), ideaA.id, unsafe({ bodySize: 3 })))).toEqual(['invalid-value@changes.bodySize']);
  });
  it('no cambia el marco ni el icono al tocar solo los tamaños de texto', () => {
    const withFrame = assertValid(updateCardAppearance(validWorkspace(), ideaA.id, { frameOverride: 'hidden' }));
    const withSizes = assertValid(updateCardAppearance(withFrame, ideaA.id, { titleSize: 'small', bodySize: 'large' }));
    const card = withSizes.cards.find(c => c.id === ideaA.id);
    expect(card?.frameOverride).toBe('hidden');
    expect(card?.titleSize).toBe('small');
    expect(card?.bodySize).toBe('large');
  });
});

describe('posición de leyenda por ficha (ADR 0051)', () => {
  it('ausente por defecto; se puede fijar a cada posición y volver a ausente con null', () => {
    const base = validWorkspace();
    expect(ideaA.captionPosition).toBeUndefined();
    for (const captionPosition of ['top', 'left', 'right', 'bottom'] as const) {
      const moved = assertValid(updateCardAppearance(base, ideaA.id, { captionPosition }));
      expect(moved.cards.find(c => c.id === ideaA.id)?.captionPosition).toBe(captionPosition);
    }
    const set = assertValid(updateCardAppearance(base, ideaA.id, { captionPosition: 'left' }));
    const cleared = assertValid(updateCardAppearance(set, ideaA.id, { captionPosition: null }));
    expect(cleared.cards.find(c => c.id === ideaA.id)?.captionPosition).toBeUndefined();
    expect(base).toEqual(validWorkspace());
  });
  it('rechaza un valor que no sea "bottom", "top", "left" o "right"', () => {
    expect(problems(updateCardAppearance(validWorkspace(), ideaA.id, unsafe({ captionPosition: 'center' })))).toEqual(['invalid-value@changes.captionPosition']);
  });
  it('no cambia los tamaños de texto ni el marco al tocar solo la posición de leyenda', () => {
    const withSizes = assertValid(updateCardAppearance(validWorkspace(), ideaA.id, { titleSize: 'small', frameOverride: 'hidden' }));
    const withCaption = assertValid(updateCardAppearance(withSizes, ideaA.id, { captionPosition: 'right' }));
    const card = withCaption.cards.find(c => c.id === ideaA.id);
    expect(card?.titleSize).toBe('small');
    expect(card?.frameOverride).toBe('hidden');
    expect(card?.captionPosition).toBe('right');
  });
});
