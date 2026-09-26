import { describe, expect, it } from 'vitest';

import { DESKTOP_GRID } from '../layouts/grid';
import { asset, id, ideaA, ideaB, problems, validWorkspace } from '../__fixtures__/workspace';
import type { BoardId, CardId } from '../ids';
import type { Workspace } from '../workspace/workspace';
import { validateWorkspace } from '../workspace/workspace';
import { purgeTrashedCard, restoreTrashedCard, trashCard } from './trash';

const overview = id<BoardId>('overview');
const research = id<BoardId>('research');

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

// El orden de los arrays no es posición: la tarjeta vuelve al final de las listas de tarjetas y colocaciones.
const sortCards = (workspace: Omit<Workspace, 'trash'>) => ({
  ...workspace,
  cards: [...workspace.cards].sort((a, b) => a.id.localeCompare(b.id)),
  layouts: workspace.layouts.map((layout) => ({ ...layout, placements: [...layout.placements].sort((a, b) => a.cardId.localeCompare(b.cardId)) })),
});

describe('Papelera de tarjetas (ADR 0015)', () => {
  it('enviar a la Papelera retira la tarjeta con sus relaciones y restaurar la devuelve tal cual', () => {
    const source = validWorkspace();
    const trashed = ok(trashCard(source, ideaA.id));
    expect(trashed.cards.map((card) => card.id)).toEqual(['idea-b']);
    expect(trashed.relations).toEqual([]);
    expect(trashed.boards.map((board) => board.cardIds)).toEqual([['idea-b'], []]);
    expect(trashed.trash).toEqual([{
      card: ideaA,
      boards: [{ boardId: overview, index: 0 }, { boardId: research, index: 0 }],
      placements: [{ boardId: overview, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }],
      relations: source.relations,
    }]);
    expect(problems(validateWorkspace(trashed))).toEqual([]);

    const restored = ok(restoreTrashedCard(trashed, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    const { trash: _restoredTrash, ...restoredRest } = restored.workspace;
    expect(sortCards(restoredRest)).toEqual(sortCards(source));
    expect(restored.workspace.trash).toEqual([]);
  });

  it('un ID de la Papelera no puede coincidir con una tarjeta activa', () => {
    const trashed = ok(trashCard(validWorkspace(), ideaA.id));
    const clash: Workspace = { ...trashed, cards: [...trashed.cards, { ...ideaA, content: 'otra' }] };
    expect(problems(validateWorkspace(clash))).toContain('duplicate-id@trash[0].card.id');
  });

  it('al restaurar con el sitio ocupado se reubica; sin tablero, va al tablero indicado; omite relaciones rotas', () => {
    const trashed = ok(trashCard(ok(trashCard(validWorkspace(), ideaA.id)), ideaB.id));
    // Algo ocupa ahora el sitio de idea-a y ya no existe el tablero research.
    const occupied: Workspace = {
      ...trashed,
      cards: [{ id: id<CardId>('nueva'), typeId: ideaA.typeId, fields: { summary: 'x' } }],
      boards: [{ id: overview, title: 'Resumen', cardIds: [id<CardId>('nueva')] }],
      layouts: [{ boardId: overview, placements: [{ cardId: id<CardId>('nueva'), rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }] }],
    };
    const restored = ok(restoreTrashedCard(occupied, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: ['overview'], addedToFallback: false, skippedRelations: 1 });
    const placement = restored.workspace.layouts[0]?.placements.find((candidate) => candidate.cardId === ideaA.id);
    expect(placement?.rect).toEqual({ x: 4, y: 0, w: 4, h: 3 });
    expect(restored.workspace.relations).toEqual([]);
    expect(problems(validateWorkspace(restored.workspace))).toEqual([]);

    // idea-b solo estaba en overview; con otro tablero visible y overview borrado, va al indicado
    // conservando sus coordenadas si están libres.
    const other = id<BoardId>('otro');
    const withoutOverview: Workspace = { ...trashed, boards: [{ id: other, title: 'Otro', cardIds: [] }], layouts: [] };
    const fallback = ok(restoreTrashedCard(withoutOverview, ideaB.id, { fallbackBoardId: other, config: DESKTOP_GRID }));
    expect(fallback.report.addedToFallback).toBe(true);
    expect(fallback.workspace.boards[0]?.cardIds).toEqual(['idea-b']);
    expect(fallback.workspace.layouts[0]?.placements[0]).toEqual({ cardId: 'idea-b', rect: { x: 4, y: 0, w: 4, h: 2 }, display: 'minimized' });
  });

  it('eliminar definitivamente libera solo los assets que nadie más usa', () => {
    const shared = { ...ideaB, assetRefs: [asset('assets/images/a.png')] };
    const source: Workspace = { ...validWorkspace(), cards: [ideaA, shared] };
    const trashed = ok(trashCard(source, ideaA.id));
    const kept = ok(purgeTrashedCard(trashed, ideaA.id));
    expect(kept.workspace.trash).toEqual([]);
    expect(kept.releasedAssets).toEqual([]);

    const alone = ok(trashCard(validWorkspace(), ideaA.id));
    const purged = ok(purgeTrashedCard(alone, ideaA.id));
    expect(purged.releasedAssets).toEqual(['assets/images/a.png']);
    expect(problems(purgeTrashedCard(alone, id<CardId>('no-existe')))).toEqual(['missing-reference@cardId']);
  });
});
