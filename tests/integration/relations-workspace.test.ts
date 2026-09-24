import { describe, expect, it } from 'vitest';
import {
  assertValid, compactLayout, createRelation, deleteCard, deleteRelation, DESKTOP_GRID,
  getIncomingRelations, getOutgoingRelations, getRelatedCards, MOBILE_GRID, moveCard,
  projectLayout, resizeCard, setDisplay, validateGridLayout, validateWorkspace,
} from '../../packages/domain/src/index';
import type { CardId, RelationId, RelationTypeId, Workspace } from '../../packages/domain/src/index';
import { deepFreeze } from '../../packages/domain/src/__fixtures__/grid';
import { id, ideaA, ideaB, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';

describe('relaciones y workspace: flujo funcional del dominio', () => {
  it('crear → consultar → cambiar representación → desconectar conserva el contenido', () => {
    const base = deepFreeze({ ...validWorkspace(), relations: [] });
    const relation = { id: id<RelationId>('new-link'), typeId: id<RelationTypeId>('references'), from: ideaA.id, to: ideaB.id };
    const connected = deepFreeze(assertValid(createRelation(base, relation)));
    expect(assertValid(getOutgoingRelations(connected, ideaA.id))).toEqual([relation]);
    expect(assertValid(getIncomingRelations(connected, ideaB.id))).toEqual([relation]);
    let layout = connected.layouts[0]!;
    layout = assertValid(moveCard(layout, ideaA.id, { x: 0, y: 4 }, DESKTOP_GRID));
    layout = assertValid(resizeCard(layout, ideaA.id, { w: 3, h: 2 }, DESKTOP_GRID));
    for (const mode of ['collapsed', 'minimized', 'expanded'] as const) {
      layout = assertValid(setDisplay(layout, ideaA.id, mode, DESKTOP_GRID));
    }
    layout = assertValid(compactLayout(layout, DESKTOP_GRID));
    const changed = { ...connected, layouts: [layout] };
    expect(validateWorkspace(changed).ok).toBe(true);
    expect(validateGridLayout(layout, DESKTOP_GRID).ok).toBe(true);
    expect(assertValid(projectLayout(layout, DESKTOP_GRID, MOBILE_GRID)).items).toHaveLength(2);
    expect(changed.relations).toBe(connected.relations);
    expect(changed.cards).toBe(base.cards);
    expect(assertValid(getRelatedCards(changed, ideaA.id))).toEqual([ideaB]);
    const disconnected = assertValid(deleteRelation(changed, relation.id));
    expect(disconnected.relations).toEqual([]);
    expect(disconnected.cards).toBe(base.cards);
    expect(disconnected.layouts).toBe(changed.layouts);
    expect(connected.relations).toEqual([relation]);
  });

  it('permite conexiones entre boards separados y mantiene un vecino para varios tipos', () => {
    const base = validWorkspace();
    const type = id<RelationTypeId>('extends');
    const source: Workspace = { ...base,
      boards: base.boards.map((board, index) => ({ ...board, cardIds: [index === 0 ? ideaA.id : ideaB.id] })),
      layouts: [], relationTypes: [...base.relationTypes, { id: type, label: 'Amplía' }],
    };
    const linked = assertValid(createRelation(deepFreeze(source), {
      id: id<RelationId>('extends'), typeId: type, from: ideaA.id, to: ideaB.id,
    }));
    expect(assertValid(getOutgoingRelations(linked, ideaA.id))).toHaveLength(2);
    expect(assertValid(getRelatedCards(linked, ideaA.id))).toEqual([ideaB]);
    const withoutViews = { ...linked, boards: [], layouts: [] };
    expect(validateWorkspace(withoutViews).ok).toBe(true);
    expect(getRelatedCards(withoutViews, ideaA.id)).toEqual(getRelatedCards(linked, ideaA.id));
  });

  it('permite ciclos y borra un extremo sin referencias colgantes', () => {
    const base = validWorkspace();
    const cardC = { ...ideaB, id: id<CardId>('idea-c') };
    let workspace: Workspace = { ...base, cards: [...base.cards, cardC] };
    const links = [
      { id: id<RelationId>('bc'), typeId: id<RelationTypeId>('references'), from: ideaB.id, to: cardC.id },
      { id: id<RelationId>('ca'), typeId: id<RelationTypeId>('references'), from: cardC.id, to: ideaA.id },
    ];
    for (const relation of links) workspace = assertValid(createRelation(deepFreeze(workspace), relation));
    expect(workspace.relations).toHaveLength(3);
    expect(deleteCard(workspace, ideaA.id).ok).toBe(false);
    const result = assertValid(deleteCard(workspace, ideaA.id, { relations: 'cascade' }));
    expect(result.relations).toEqual([links[0]]);
    expect(validateWorkspace(result).ok).toBe(true);
    expect(assertValid(getRelatedCards(result, ideaB.id))).toEqual([cardC]);
    expect(workspace.relations).toHaveLength(3);
  });

  it('secuencia determinista de conexiones y borrados mantiene todas las invariantes', () => {
    const base = validWorkspace();
    let workspace: Workspace = { ...base, boards: [], layouts: [], relations: [],
      cards: Array.from({ length: 8 }, (_, i) => ({ ...ideaB, id: id<CardId>(`card-${i}`) })),
    };
    for (let i = 0; i < workspace.cards.length; i += 1) {
      workspace = assertValid(createRelation(deepFreeze(workspace), {
        id: id<RelationId>(`link-${i}`), typeId: id<RelationTypeId>('references'),
        from: workspace.cards[i]!.id, to: workspace.cards[(i + 1) % workspace.cards.length]!.id,
      }));
      expect(validateWorkspace(workspace).ok).toBe(true);
    }
    const ids = workspace.cards.map(card => card.id);
    for (const cardId of ids) {
      const snapshot = JSON.stringify(workspace);
      const next = assertValid(deleteCard(deepFreeze(workspace), cardId, { relations: 'cascade' }));
      expect(JSON.stringify(workspace)).toBe(snapshot);
      expect(validateWorkspace(next).ok).toBe(true);
      for (const card of next.cards) {
        const expected = next.relations.filter(relation => relation.from === card.id);
        expect(assertValid(getOutgoingRelations(next, card.id))).toEqual(expected);
      }
      workspace = next;
    }
    expect(workspace.cards).toEqual([]);
    expect(workspace.relations).toEqual([]);
  });
});
