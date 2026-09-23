import { describe, expect, it } from 'vitest';

import { deepFreeze, layoutOf, place, seeded } from '../__fixtures__/grid';
import { problems, unsafe } from '../__fixtures__/workspace';
import { DESKTOP_GRID, MOBILE_GRID, TABLET_GRID, cellsOverlap, footprint, validateGridLayout } from './grid';
import type { GridConfig } from './grid';
import type { BoardLayout, CardPlacement } from './layout';
import { projectLayout } from './projection';
import type { ProjectedLayout } from './projection';

const value = <T>(result: { ok: boolean; value?: T }): T => {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result)}`);
  return result.value as T;
};

// Canónico de escritorio: dos filas de piezas con alturas distintas y modos variados.
const canonical = deepFreeze(layoutOf(
  place('c', 8, 0, 4, 2),
  place('a', 0, 0, 4, 3),
  place('b', 4, 0, 4, 1, 'collapsed'),
  place('d', 4, 1, 3, 3, 'minimized'),
  place('e', 0, 3, 12, 1),
));

function readingKey(item: { cell: { x: number; y: number } }): number {
  return item.cell.y * 1000 + item.cell.x;
}

function expectWellFormed(projected: ProjectedLayout, source: BoardLayout, to: GridConfig): void {
  expect(projected.columns).toBe(to.columns);
  expect(projected.items.map((item) => item.cardId).sort()).toEqual(source.placements.map((p) => p.cardId).sort());
  expect(projected.items.map((item) => item.order)).toEqual(projected.items.map((_, i) => i));
  projected.items.forEach((item, i) => {
    expect(item.cell.x).toBeGreaterThanOrEqual(0);
    expect(item.cell.x + item.cell.w).toBeLessThanOrEqual(to.columns);
    expect(item.cell.w).toBeGreaterThanOrEqual(1);
    const previous = projected.items[i - 1];
    if (previous) expect(readingKey(item)).toBeGreaterThan(readingKey(previous));
    for (const other of projected.items.slice(0, i)) expect(cellsOverlap(item.cell, other.cell)).toBe(false);
  });
}

describe('proyección responsive', () => {
  it('móvil (1 columna): lista en orden de lectura canónico, apilada por alturas de la huella', () => {
    const mobile = value(projectLayout(canonical, DESKTOP_GRID, MOBILE_GRID));
    expect(mobile.items.map((item) => [item.cardId, item.cell.y, item.cell.h, item.display])).toEqual([
      ['a', 0, 3, 'expanded'],
      ['b', 3, 1, 'collapsed'],
      ['c', 4, 2, 'expanded'],
      ['d', 6, 1, 'minimized'],
      ['e', 7, 1, 'expanded'],
    ]);
    expect(mobile.items.every((item) => item.cell.x === 0 && item.cell.w === 1)).toBe(true);
    expectWellFormed(mobile, canonical, MOBILE_GRID);
  });

  it('tablet (6 columnas): escala anchos con redondeo hacia arriba y conserva el orden', () => {
    const tablet = value(projectLayout(canonical, DESKTOP_GRID, TABLET_GRID));
    expect(tablet.items.map((item) => [item.cardId, item.cell])).toEqual([
      ['a', { x: 0, y: 0, w: 2, h: 3 }],
      ['b', { x: 2, y: 0, w: 2, h: 1 }],
      ['c', { x: 4, y: 0, w: 2, h: 2 }],
      ['d', { x: 2, y: 1, w: 1, h: 1 }],
      ['e', { x: 0, y: 3, w: 6, h: 1 }],
    ]);
    expectWellFormed(tablet, canonical, TABLET_GRID);
  });

  it('con la misma cantidad de columnas conserva los anchos de la huella', () => {
    const same = value(projectLayout(canonical, DESKTOP_GRID, DESKTOP_GRID));
    expect(same.items.map((item) => item.cell.w)).toEqual([4, 4, 4, 1, 12]);
  });

  it('no modifica el layout canónico y es determinista', () => {
    const before = JSON.stringify(canonical);
    const first = projectLayout(canonical, DESKTOP_GRID, MOBILE_GRID);
    expect(projectLayout(canonical, DESKTOP_GRID, MOBILE_GRID)).toEqual(first);
    expect(JSON.stringify(canonical)).toBe(before);
    expect(validateGridLayout(canonical, DESKTOP_GRID).ok).toBe(true);
  });

  it('el orden depende de la posición canónica, no del orden del array', () => {
    const tie = layoutOf(place('z', 0, 0, 6, 1), place('y', 6, 0, 6, 1));
    const mobile = value(projectLayout(tie, DESKTOP_GRID, MOBILE_GRID));
    expect(mobile.items.map((item) => item.cardId)).toEqual(['z', 'y']);
    const reordered = value(projectLayout(layoutOf(place('y', 6, 0, 6, 1), place('z', 0, 0, 6, 1)), DESKTOP_GRID, MOBILE_GRID));
    expect(reordered.items.map((item) => item.cardId)).toEqual(['z', 'y']);
  });

  it('un layout vacío produce una proyección vacía', () => {
    expect(value(projectLayout(layoutOf(), DESKTOP_GRID, MOBILE_GRID)).items).toEqual([]);
  });

  it('rechaza origen inválido, configuraciones inválidas y destinos con filas limitadas', () => {
    const overlapping = layoutOf(place('a', 0, 0, 2, 2), place('b', 1, 1, 2, 2));
    expect(problems(projectLayout(overlapping, DESKTOP_GRID, MOBILE_GRID))).toEqual(['grid-collision@from.placements[1]']);
    expect(problems(projectLayout(canonical, { columns: 0 }, MOBILE_GRID))).toEqual(['invalid-grid-config@from.columns']);
    expect(problems(projectLayout(canonical, DESKTOP_GRID, { columns: 2.5 }))).toEqual(['invalid-grid-config@to.columns']);
    expect(problems(projectLayout(canonical, DESKTOP_GRID, { columns: 1, rows: 3 }))).toEqual(['invalid-grid-config@to.rows']);
  });

  it.each([21, 22, 23, 24, 25, 26])('invariantes con layouts generados y 1, 2 y 6 columnas (semilla %i)', (seed) => {
    const random = seeded(seed);
    const placements: CardPlacement[] = [];
    for (let i = 0; i < 25; i += 1) {
      const w = 1 + Math.floor(random() * 6);
      const candidate = place(`p${i}`, Math.floor(random() * (13 - w)), Math.floor(random() * 10), w, 1 + Math.floor(random() * 3),
        (['expanded', 'collapsed', 'minimized'] as const)[Math.floor(random() * 3)]);
      if (placements.every((other) => !cellsOverlap(footprint(other), footprint(candidate)))) placements.push(candidate);
    }
    const source = deepFreeze(layoutOf(...placements));
    const snapshot = JSON.stringify(source);
    for (const columns of [1, 2, 6]) {
      const projected = value(projectLayout(source, DESKTOP_GRID, { columns }));
      expectWellFormed(projected, source, { columns });
      projected.items.forEach((item) => {
        const original = source.placements.find((p) => p.cardId === item.cardId) as CardPlacement;
        expect(item.display).toBe(original.display);
        expect(item.cell.h).toBe(footprint(original).h);
      });
    }
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

/** Oráculo: la proyección anterior, fila a fila; válida solo con alturas pequeñas. */
function bruteForceProjection(layout: BoardLayout, from: GridConfig, to: GridConfig): string[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: string[] = [];
  let cursor = { x: -1, y: 0 };
  for (const placement of [...layout.placements].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
    const own = footprint(placement);
    const w = Math.max(1, Math.min(to.columns, Math.ceil((own.w * to.columns) / from.columns)));
    for (let y = cursor.y, done = false; !done; y += 1) {
      for (let x = y === cursor.y ? cursor.x + 1 : 0; x + w <= to.columns; x += 1) {
        if (placed.every((cell) => !cellsOverlap({ x, y, w, h: own.h }, cell))) {
          placed.push({ x, y, w, h: own.h });
          out.push(`${placement.cardId}@${x},${y}`);
          cursor = { x, y };
          done = true;
          break;
        }
      }
    }
  }
  return out;
}

describe('regresiones de la revisión de fase 2 (G3, G4)', () => {
  it('G4: entradas raíz inválidas devuelven incidencias sin excepción', () => {
    expect(() => projectLayout(unsafe(null), DESKTOP_GRID, MOBILE_GRID)).not.toThrow();
    expect(problems(projectLayout(unsafe(null), DESKTOP_GRID, MOBILE_GRID))).toEqual(['invalid-value@from.layout']);
    expect(problems(projectLayout(canonical, unsafe(null), MOBILE_GRID))).toEqual(['invalid-grid-config@from.config']);
    expect(problems(projectLayout(canonical, DESKTOP_GRID, unsafe(null)))).toEqual(['invalid-grid-config@to.config']);
    expect(problems(projectLayout(canonical, DESKTOP_GRID, unsafe({ columns: '1' })))).toEqual(['invalid-grid-config@to.columns']);
  });

  it('G3: proyecta alturas enormes sin recorrer filas vacías', () => {
    const tall = 1_000_000_000;
    const layout = layoutOf(place('a', 0, 0, 1, tall), place('b', 1, 0, 1, 1));
    const mobile = value(projectLayout(layout, { columns: 2 }, MOBILE_GRID));
    expect(mobile.items.map((item) => [item.cardId, item.cell])).toEqual([
      ['a', { x: 0, y: 0, w: 1, h: tall }],
      ['b', { x: 0, y: tall, w: 1, h: 1 }],
    ]);
  });

  it('G3: informa si la posición derivada deja de ser representable', () => {
    const half = 2 ** 52;
    const layout = layoutOf(place('a', 0, 0, 1, half), place('b', 1, 0, 1, half));
    expect(validateGridLayout(layout, { columns: 2 }).ok).toBe(true);
    expect(problems(projectLayout(layout, { columns: 2 }, MOBILE_GRID))).toEqual(['out-of-bounds@items[1]']);
    expect(value(projectLayout(layout, { columns: 2 }, { columns: 2 })).items.map((item) => item.cell.y)).toEqual([0, 0]);
  });

  it('G3: la fila siguiente al cursor es candidata aunque ninguna pieza termine en ella', () => {
    // Tras colocar P en (2,1) queda un hueco en (0,1), prohibido por el orden de lectura. La primera
    // posición válida para E es (0,2), y ninguna pieza termina en la fila 2.
    const four = { columns: 4 };
    const layout = layoutOf(
      place('a', 0, 0, 1, 1), place('b', 1, 0, 1, 10), place('c', 2, 0, 1, 1), place('d', 3, 0, 1, 1),
      place('p', 2, 1, 2, 5), place('e', 0, 2, 1, 1),
    );
    const projected = value(projectLayout(layout, four, four));
    expect(projected.items.map((item) => `${item.cardId}@${item.cell.x},${item.cell.y}`)).toEqual(bruteForceProjection(layout, four, four));
    expect(projected.items.find((item) => item.cardId === 'e')?.cell).toEqual({ x: 0, y: 2, w: 1, h: 1 });
  });

  it.each([41, 42, 43, 44, 45, 46])('G3: coincide con la proyección fila a fila (semilla %i)', (seed) => {
    const random = seeded(seed);
    const placements: CardPlacement[] = [];
    for (let i = 0; i < 25; i += 1) {
      const w = 1 + Math.floor(random() * 6);
      const candidate = place(`p${i}`, Math.floor(random() * (13 - w)), Math.floor(random() * 10), w, 1 + Math.floor(random() * 3),
        (['expanded', 'collapsed', 'minimized'] as const)[Math.floor(random() * 3)]);
      if (placements.every((other) => !cellsOverlap(footprint(other), footprint(candidate)))) placements.push(candidate);
    }
    const layout = layoutOf(...placements);
    for (const columns of [1, 2, 3, 6, 12]) {
      const projected = value(projectLayout(layout, DESKTOP_GRID, { columns }));
      expect(projected.items.map((item) => `${item.cardId}@${item.cell.x},${item.cell.y}`)).toEqual(bruteForceProjection(layout, DESKTOP_GRID, { columns }));
    }
  });
});
