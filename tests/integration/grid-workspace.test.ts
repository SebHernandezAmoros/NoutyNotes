import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../packages/domain/src/__fixtures__/grid';
import { ideaA, ideaB, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import {
  DESKTOP_GRID, MOBILE_GRID, compactLayout, moveCard, projectLayout, resizeCard, setDisplay,
  validateGridLayout, validateWorkspace,
} from '../../packages/domain/src/index';
import type { BoardId, BoardLayout, ValidationResult, Workspace } from '../../packages/domain/src/index';

const value = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result.issues)}`);
  return result.value;
};

/** Sustituye el layout de un board sin tocar el resto del workspace. */
function withLayout(workspace: Workspace, layout: BoardLayout): Workspace {
  return { ...workspace, layouts: workspace.layouts.map((current) => (current.boardId === layout.boardId ? layout : current)) };
}

// La misma tarjeta (idea-a) aparece en dos boards, cada uno con su propio layout.
function workspaceWithTwoLayouts(): Workspace {
  const base = validWorkspace();
  return deepFreeze({
    ...base,
    layouts: [...base.layouts, { boardId: 'research' as BoardId, placements: [{ cardId: ideaA.id, rect: { x: 6, y: 2, w: 3, h: 2 }, display: 'expanded' }] }],
  });
}

describe('motor de grilla sobre un workspace', () => {
  it('los layouts del fixture son válidos para la grilla de escritorio', () => {
    for (const layout of workspaceWithTwoLayouts().layouts) expect(validateGridLayout(layout, DESKTOP_GRID).ok).toBe(true);
  });

  it('mover, redimensionar, compactar y cambiar display conservan tarjetas, boards y relaciones', () => {
    const workspace = workspaceWithTwoLayouts();
    const snapshot = JSON.stringify(workspace);
    const [overview] = workspace.layouts as [BoardLayout];
    let layout = value(moveCard(overview, ideaA.id, { x: 0, y: 4 }, DESKTOP_GRID));
    layout = value(resizeCard(layout, ideaB.id, { w: 6, h: 3 }, DESKTOP_GRID));
    layout = value(setDisplay(layout, ideaA.id, 'minimized', DESKTOP_GRID));
    layout = value(compactLayout(layout, DESKTOP_GRID));
    const changed = withLayout(workspace, layout);

    expect(validateWorkspace(changed).ok).toBe(true);
    expect(changed.cards).toBe(workspace.cards);
    expect(changed.relations).toBe(workspace.relations);
    expect(changed.boards).toBe(workspace.boards);
    expect(changed.cardTypes).toBe(workspace.cardTypes);
    expect(layout.placements.map((p) => p.cardId).sort()).toEqual(overview.placements.map((p) => p.cardId).sort());
    expect(JSON.stringify(workspace)).toBe(snapshot);
  });

  it('cambiar el layout de un board no modifica la representación de la tarjeta en otro board', () => {
    const workspace = workspaceWithTwoLayouts();
    const [overview, research] = workspace.layouts as [BoardLayout, BoardLayout];
    const changed = withLayout(workspace, value(setDisplay(value(moveCard(overview, ideaA.id, { x: 8, y: 6 }, DESKTOP_GRID)), ideaA.id, 'collapsed', DESKTOP_GRID)));
    expect(changed.layouts[1]).toBe(research);
    expect(changed.layouts[1]?.placements[0]).toEqual({ cardId: ideaA.id, rect: { x: 6, y: 2, w: 3, h: 2 }, display: 'expanded' });
    expect(validateWorkspace(changed).ok).toBe(true);
  });

  it('expanded → collapsed → minimized → expanded conserva identidad, contenido y relaciones', () => {
    const workspace = workspaceWithTwoLayouts();
    const [overview] = workspace.layouts as [BoardLayout];
    const states = ['collapsed', 'minimized', 'expanded'] as const;
    let layout = overview;
    for (const display of states) {
      layout = value(setDisplay(layout, ideaA.id, display, DESKTOP_GRID));
      const changed = withLayout(workspace, layout);
      expect(validateWorkspace(changed).ok).toBe(true);
      expect(changed.cards.find((card) => card.id === ideaA.id)).toBe(ideaA);
      expect(changed.relations).toEqual([{ id: 'a-references-b', typeId: 'references', from: ideaA.id, to: ideaB.id }]);
    }
    expect(layout).toEqual(overview);
  });

  it('la vista móvil deriva del layout canónico sin cambiar el workspace', () => {
    const workspace = workspaceWithTwoLayouts();
    const snapshot = JSON.stringify(workspace);
    const [overview] = workspace.layouts as [BoardLayout];
    const mobile = value(projectLayout(overview, DESKTOP_GRID, MOBILE_GRID));
    expect(mobile.items.map((item) => item.cardId)).toEqual([ideaA.id, ideaB.id]);
    expect(JSON.stringify(workspace)).toBe(snapshot);
  });

  it('G1: sin espacio representable, relocate falla y el workspace queda intacto', () => {
    const base = workspaceWithTwoLayouts();
    const huge: BoardLayout = {
      boardId: 'overview' as BoardId,
      placements: [
        { cardId: ideaA.id, rect: { x: 1, y: 0, w: 2, h: Number.MAX_SAFE_INTEGER }, display: 'minimized' },
        { cardId: ideaB.id, rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded' },
      ],
    };
    const workspace = deepFreeze(withLayout(base, huge));
    const snapshot = JSON.stringify(workspace);
    expect(validateWorkspace(workspace).ok).toBe(true);
    const result = setDisplay(huge, ideaA.id, 'expanded', { columns: 2 }, { ifOccupied: 'relocate' });
    expect(result.ok ? [] : result.issues.map((found) => found.code)).toEqual(['no-free-space']);
    expect(JSON.stringify(workspace)).toBe(snapshot);
  });

  it('G3: alturas enormes se mueven y proyectan sin alterar tarjetas, relaciones ni el canónico', () => {
    const base = workspaceWithTwoLayouts();
    const tall: BoardLayout = {
      boardId: 'overview' as BoardId,
      placements: [
        { cardId: ideaA.id, rect: { x: 0, y: 0, w: 6, h: 1_000_000_000 }, display: 'expanded' },
        { cardId: ideaB.id, rect: { x: 6, y: 0, w: 6, h: 1 }, display: 'collapsed' },
      ],
    };
    const workspace = deepFreeze(withLayout(base, tall));
    const snapshot = JSON.stringify(workspace);
    const mobile = value(projectLayout(tall, DESKTOP_GRID, MOBILE_GRID));
    expect(mobile.items.map((item) => [item.cardId, item.cell.y])).toEqual([[ideaA.id, 0], [ideaB.id, 1_000_000_000]]);
    const moved = withLayout(workspace, value(moveCard(tall, ideaB.id, { x: 6, y: 999_999_999 }, DESKTOP_GRID)));
    expect(validateWorkspace(moved).ok).toBe(true);
    expect(moved.cards).toBe(workspace.cards);
    expect(moved.relations).toBe(workspace.relations);
    expect(JSON.stringify(workspace)).toBe(snapshot);
  });

  it('G4: entradas inválidas en el límite con el workspace devuelven incidencias sin excepción', () => {
    const [overview] = workspaceWithTwoLayouts().layouts as [BoardLayout];
    for (const result of [
      projectLayout(overview, DESKTOP_GRID, null as unknown as typeof MOBILE_GRID),
      moveCard(overview, ideaA.id, undefined as unknown as { x: number; y: number }, DESKTOP_GRID),
      compactLayout(null as unknown as BoardLayout, DESKTOP_GRID),
    ]) {
      expect(result.ok).toBe(false);
    }
  });

  it('el motor no acepta colocar tarjetas que no están en el layout, y el workspace sigue controlando la pertenencia', () => {
    const workspace = workspaceWithTwoLayouts();
    const [, research] = workspace.layouts as [BoardLayout, BoardLayout];
    expect(moveCard(research, ideaB.id, { x: 0, y: 0 }, DESKTOP_GRID).ok).toBe(false);
    // Una colocación añadida a mano para una tarjeta ajena al board la rechaza validateWorkspace, no la grilla.
    const foreign: BoardLayout = { ...research, placements: [...research.placements, { cardId: ideaB.id, rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded' }] };
    expect(validateGridLayout(foreign, DESKTOP_GRID).ok).toBe(true);
    expect(validateWorkspace(withLayout(workspace, foreign)).ok).toBe(false);
  });
});
