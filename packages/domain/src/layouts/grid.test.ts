import { describe, expect, it } from 'vitest';

import { layoutOf, place } from '../__fixtures__/grid';
import { problems, unsafe } from '../__fixtures__/workspace';
import {
  DESKTOP_GRID, MAX_GRID_COLUMNS, MOBILE_GRID, TABLET_GRID, WORLD_GRID,
  cellsOverlap, footprint, snapPoint, snapSize, snapUnit, validateGridConfig, validateGridLayout,
} from './grid';
import type { GridConfig } from './grid';

describe('configuración de grilla', () => {
  it('admite un mundo bidireccional sin perder las reglas de la grilla acotada', () => {
    expect(validateGridLayout(layoutOf(place('a', -3, -2, 4, 3), place('b', 20, 30, 1, 1)), WORLD_GRID).ok).toBe(true);
    expect(validateGridLayout(layoutOf(place('a', -3, -2, 4, 3)), DESKTOP_GRID).ok).toBe(false);
  });
  it('ofrece presets de escritorio, tablet y móvil válidos', () => {
    expect([DESKTOP_GRID.columns, TABLET_GRID.columns, MOBILE_GRID.columns]).toEqual([12, 6, 1]);
    for (const config of [DESKTOP_GRID, TABLET_GRID, MOBILE_GRID, { columns: 12, rows: 4 }]) {
      expect(validateGridConfig(config).ok).toBe(true);
    }
  });

  it.each([
    ['cero columnas', { columns: 0 }, 'invalid-grid-config@columns'],
    ['columnas fraccionarias', { columns: 2.5 }, 'invalid-grid-config@columns'],
    ['columnas no finitas', { columns: Number.POSITIVE_INFINITY }, 'invalid-grid-config@columns'],
    ['demasiadas columnas', { columns: MAX_GRID_COLUMNS + 1 }, 'invalid-grid-config@columns'],
    ['columnas como texto', { columns: '12' }, 'invalid-grid-config@columns'],
    ['filas cero', { columns: 12, rows: 0 }, 'invalid-grid-config@rows'],
    ['filas NaN', { columns: 12, rows: Number.NaN }, 'invalid-grid-config@rows'],
  ])('rechaza %s', (_case, config, expected) => {
    expect(problems(validateGridConfig(unsafe<GridConfig>(config)))).toEqual([expected]);
  });
});

describe('snap a unidades de grilla', () => {
  it.each([
    [2.4, 2], [2.5, 3], [2.6, 3], [3, 3], [0, 0],
    [-0.4, 0], [-0.5, 0], [-0.51, -1], [-1.5, -1], [-2.6, -3],
    [0.49999999999999994, 0], [1e6 + 0.5, 1e6 + 1],
  ])('%s → %s (empates hacia +∞)', (value, expected) => {
    const result = snapUnit(value);
    expect(result).toEqual({ ok: true, value: expected });
    expect(Object.is(result.ok && result.value, -0)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rechaza %s', (value) => {
    expect(problems(snapUnit(value))).toEqual(['invalid-layout@value']);
  });

  it('ajusta puntos y tamaños sin recortarlos a los límites', () => {
    expect(snapPoint({ x: 3.7, y: -0.2 })).toEqual({ ok: true, value: { x: 4, y: 0 } });
    expect(snapPoint({ x: -1.6, y: 0 })).toEqual({ ok: true, value: { x: -2, y: 0 } });
    expect(snapSize({ w: 2.5, h: 0.4 })).toEqual({ ok: true, value: { w: 3, h: 0 } });
    expect(problems(snapPoint({ x: Number.NaN, y: 1 }))).toEqual(['invalid-layout@x']);
  });
});

describe('huella y solapamiento', () => {
  it('la huella depende del modo de visualización y conserva la esquina', () => {
    expect(footprint(place('a', 2, 3, 4, 5))).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    expect(footprint(place('a', 2, 3, 4, 5, 'collapsed'))).toEqual({ x: 2, y: 3, w: 4, h: 1 });
    expect(footprint(place('a', 2, 3, 4, 5, 'minimized'))).toEqual({ x: 2, y: 3, w: 1, h: 1 });
  });

  it.each([
    ['borde vertical compartido', { x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }, false],
    ['borde horizontal compartido', { x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }, false],
    ['solo una esquina', { x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 2, w: 1, h: 1 }, false],
    ['separadas', { x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 }, false],
    ['solapamiento parcial', { x: 0, y: 0, w: 3, h: 3 }, { x: 2, y: 2, w: 3, h: 3 }, true],
    ['contención completa', { x: 0, y: 0, w: 6, h: 6 }, { x: 2, y: 2, w: 1, h: 1 }, true],
    ['misma celda', { x: 4, y: 4, w: 1, h: 1 }, { x: 4, y: 4, w: 1, h: 1 }, true],
    ['cruz', { x: 1, y: 0, w: 1, h: 3 }, { x: 0, y: 1, w: 3, h: 1 }, true],
  ])('%s', (_case, a, b, expected) => {
    expect(cellsOverlap(a, b)).toBe(expected);
    expect(cellsOverlap(b, a)).toBe(expected);
  });
});

describe('validación de un layout contra la grilla', () => {
  it('acepta un layout vacío y uno con bordes en contacto', () => {
    expect(validateGridLayout(layoutOf(), DESKTOP_GRID).ok).toBe(true);
    const touching = layoutOf(place('a', 0, 0, 6, 2), place('b', 6, 0, 6, 2), place('c', 0, 2, 12, 1));
    expect(validateGridLayout(touching, DESKTOP_GRID).ok).toBe(true);
  });

  it('no considera colisión una tarjeta consigo misma', () => {
    expect(validateGridLayout(layoutOf(place('a', 0, 0, 12, 3)), DESKTOP_GRID).ok).toBe(true);
  });

  it('evalúa colisiones sobre la huella: minimizadas y colapsadas dejan libre el resto de su rect', () => {
    const minimized = layoutOf(place('a', 0, 0, 4, 4, 'minimized'), place('b', 1, 0, 3, 1), place('c', 0, 1, 2, 2));
    expect(validateGridLayout(minimized, DESKTOP_GRID).ok).toBe(true);
    const collapsed = layoutOf(place('a', 0, 0, 4, 4, 'collapsed'), place('b', 0, 1, 4, 1));
    expect(validateGridLayout(collapsed, DESKTOP_GRID).ok).toBe(true);
  });

  it.each([
    ['sale por la derecha', layoutOf(place('a', 10, 0, 3, 1)), 'out-of-bounds@placements[0].rect'],
    ['sale por abajo con filas limitadas', layoutOf(place('a', 0, 3, 1, 2)), 'out-of-bounds@placements[0].rect'],
    ['tamaño expandido mayor que la grilla', layoutOf(place('a', 0, 0, 13, 1, 'minimized')), 'out-of-bounds@placements[0].rect.w'],
    ['solapamiento', layoutOf(place('a', 0, 0, 3, 3), place('b', 2, 2, 2, 2)), 'grid-collision@placements[1]'],
    ['fuera de la grilla acotada', layoutOf(place('a', -1, 0, 1, 1)), 'out-of-bounds@placements[0].rect'],
    ['coordenada no finita', layoutOf(place('a', Number.POSITIVE_INFINITY, 0, 1, 1)), 'invalid-layout@placements[0].rect.x'],
  ])('rechaza %s', (_case, layout, expected) => {
    expect(problems(validateGridLayout(layout, { columns: 12, rows: 4 }))).toContain(expected);
  });

  it('rechaza sumas que no son enteros seguros sin límite de filas', () => {
    const layout = layoutOf(place('a', 0, Number.MAX_SAFE_INTEGER, 1, 2));
    expect(problems(validateGridLayout(layout, DESKTOP_GRID))).toEqual(['out-of-bounds@placements[0].rect']);
  });

  it('no valida el layout con una configuración inválida', () => {
    expect(problems(validateGridLayout(layoutOf(), { columns: 0 }))).toEqual(['invalid-grid-config@columns']);
  });

  it('informa cada par en colisión una vez, en la colocación posterior', () => {
    const layout = layoutOf(place('a', 0, 0, 2, 2), place('b', 1, 1, 2, 2), place('c', 1, 0, 1, 1));
    expect(problems(validateGridLayout(layout, DESKTOP_GRID))).toEqual([
      // a-b y a-c se solapan; b (filas 1-2) y c (fila 0) solo se tocan.
      'grid-collision@placements[1]', 'grid-collision@placements[2]',
    ]);
  });
});

describe('regresiones de la revisión de fase 2 (G2, G4)', () => {
  const unsafeHeight = Number.MAX_SAFE_INTEGER + 1;

  it.each(['expanded', 'collapsed', 'minimized'] as const)('G2: rechaza un alto expandido no seguro en modo %s', (display) => {
    expect(problems(validateGridLayout(layoutOf(place('a', 0, 0, 1, unsafeHeight, display)), { columns: 1 })))
      .toEqual(['invalid-layout@placements[0].rect.h']);
  });

  it.each(['x', 'y', 'w'] as const)('G2: rechaza %s no seguro aunque la huella sea reducida', (key) => {
    const rect = { x: 0, y: 0, w: 1, h: 1, [key]: Number.MAX_SAFE_INTEGER + 2 };
    expect(problems(validateGridLayout(layoutOf(place('a', rect.x, rect.y, rect.w, rect.h, 'minimized')), { columns: 1 })))
      .toContain(`invalid-layout@placements[0].rect.${key}`);
  });

  it.each(['collapsed', 'minimized'] as const)('G2: exige que y + h del tamaño expandido sea representable en modo %s', (display) => {
    const layout = layoutOf(place('a', 0, Number.MAX_SAFE_INTEGER - 1, 1, 5, display));
    expect(problems(validateGridLayout(layout, { columns: 1 }))).toEqual(['out-of-bounds@placements[0].rect']);
  });

  it('G2: conserva que la huella reducida pueda caber donde la expandida no cabe', () => {
    expect(validateGridLayout(layoutOf(place('a', 11, 0, 4, 3, 'minimized')), DESKTOP_GRID).ok).toBe(true);
    expect(validateGridLayout(layoutOf(place('a', 0, 3, 1, 4, 'collapsed')), { columns: 12, rows: 4 }).ok).toBe(true);
    expect(validateGridLayout(layoutOf(place('a', 0, 0, 1, Number.MAX_SAFE_INTEGER, 'collapsed')), { columns: 1 }).ok).toBe(true);
  });

  it('G4: entradas raíz inválidas devuelven incidencias sin excepción', () => {
    expect(problems(validateGridLayout(unsafe(null), DESKTOP_GRID))).toEqual(['invalid-value@layout']);
    expect(problems(validateGridLayout(unsafe({ boardId: 'b' }), DESKTOP_GRID))).toEqual(['invalid-value@placements']);
    expect(problems(validateGridConfig(unsafe(null)))).toEqual(['invalid-grid-config@config']);
    expect(problems(validateGridLayout(layoutOf(), unsafe(null)))).toEqual(['invalid-grid-config@config']);
    expect(problems(snapPoint(unsafe(null)))).toEqual(['invalid-layout@point']);
    expect(problems(snapSize(unsafe(undefined)))).toEqual(['invalid-layout@size']);
  });
});
