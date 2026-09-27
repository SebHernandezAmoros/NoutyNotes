import { describe, expect, it } from 'vitest';

import { deepFreeze, layoutOf, place } from '../__fixtures__/grid';
import type { CardId } from '../ids';
import { frameAround, frameMembers, moveFrame, removeFrame, renameFrame, resizeFrame } from './frames';
import { WORLD_GRID } from './grid';
import type { BoardLayout, Frame } from './layout';
import { validateLayout } from './layout';

const card = (value: string) => value as CardId;
const codes = (result: { ok: boolean; issues?: readonly { code: string }[] }) => (result.ok ? [] : (result.issues ?? []).map((found) => found.code));
const value = <T>(result: { ok: boolean; value?: T }): T => {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result)}`);
  return result.value as T;
};
const frame = (id: string, x: number, y: number, w: number, h: number, title = 'Viaje'): Frame => ({ id, title, rect: { x, y, w, h } });

// a y b dentro del marco (fila 0 para el título); c fuera, a la derecha.
const base: BoardLayout = deepFreeze({
  ...layoutOf(place('a', 0, 1, 2, 2), place('b', 2, 1, 2, 2), place('c', 6, 0, 2, 2)),
  frames: [frame('marco-1', 0, 0, 4, 3)],
});

describe('Marcos (ADR 0027)', () => {
  it('la pertenencia es geométrica: solo las tarjetas enteras dentro del marco', () => {
    expect(frameMembers(base, 'marco-1')).toEqual([card('a'), card('b')]);
    // c asoma fuera del marco: no es suya.
    const partial = { ...base, placements: [...base.placements.slice(0, 2), place('c', 3, 2, 2, 1)] };
    expect(frameMembers(partial, 'marco-1')).toEqual([card('a'), card('b')]);
  });

  it('agrupar rodea la selección con una fila para el título y no puede pisar tarjetas de fuera ni otros marcos', () => {
    const layout = layoutOf(place('a', 0, 1, 2, 2), place('b', 2, 1, 2, 2), place('c', 6, 0, 2, 2));
    expect(value(frameAround(layout, [card('a'), card('b')], { id: 'marco-1', title: 'Viaje' }, WORLD_GRID)).frames).toEqual([frame('marco-1', 0, 0, 4, 3)]);
    // Rodear a y c abarcaría b, que no está seleccionada.
    expect(codes(frameAround(layout, [card('a'), card('c')], { id: 'marco-1', title: 'Viaje' }, WORLD_GRID))).toContain('grid-collision');
    expect(codes(frameAround(base, [card('c')], { id: 'marco-2', title: 'Otro' }, WORLD_GRID))).toEqual([]);
    expect(codes(frameAround(base, [card('b')], { id: 'marco-2', title: 'Otro' }, WORLD_GRID))).toContain('grid-collision');
    expect(codes(frameAround(layout, [card('a')], { id: 'marco-1', title: '  ' }, WORLD_GRID))).toContain('invalid-value');
  });

  it('mover el marco lleva sus tarjetas; no pisa tarjetas de fuera; si falla no cambia nada', () => {
    const moved = value(moveFrame(base, 'marco-1', { x: 0, y: 5 }, WORLD_GRID));
    expect(moved.frames?.[0]?.rect).toEqual({ x: 0, y: 5, w: 4, h: 3 });
    expect(moved.placements.map((placement) => [placement.cardId, placement.rect.y])).toEqual([['a', 6], ['b', 6], ['c', 0]]);
    expect(codes(moveFrame(base, 'marco-1', { x: 4, y: 0 }, WORLD_GRID))).toContain('grid-collision');
    expect(codes(moveFrame(base, 'nada', { x: 1, y: 0 }, WORLD_GRID))).toContain('missing-reference');
  });

  it('el tamaño no corta tarjetas; agrandar sobre una tarjeta entera la incluye; renombrar y quitar conservan las tarjetas', () => {
    expect(codes(resizeFrame(base, 'marco-1', { w: 3, h: 3 }, WORLD_GRID))).toContain('grid-collision');
    const grown = value(resizeFrame(base, 'marco-1', { w: 8, h: 3 }, WORLD_GRID));
    expect(frameMembers(grown, 'marco-1')).toEqual([card('a'), card('b'), card('c')]);
    expect(value(renameFrame(base, 'marco-1', ' Japón ')).frames?.[0]?.title).toBe('Japón');
    const removed = value(removeFrame(base, 'marco-1'));
    expect(removed.frames).toBeUndefined();
    expect(removed.placements).toEqual(base.placements);
  });

  it('un layout con marcos solapados, IDs repetidos o título vacío no es válido', () => {
    expect(validateLayout(base).ok).toBe(true);
    expect(codes(validateLayout({ ...base, frames: [frame('m', 0, 0, 4, 3), frame('n', 3, 2, 4, 3)] }))).toContain('grid-collision');
    expect(codes(validateLayout({ ...base, frames: [frame('m', 0, 0, 4, 3), frame('m', 10, 0, 4, 3)] }))).toContain('duplicate-id');
    expect(codes(validateLayout({ ...base, frames: [frame('m', 0, 0, 4, 3, '')] }))).toContain('invalid-value');
  });
});
