import { describe, expect, it } from 'vitest';

import { deepFreeze, layoutOf, place, seeded } from '../__fixtures__/grid';
import { problems, unsafe } from '../__fixtures__/workspace';
import type { CardId } from '../ids';
import { DESKTOP_GRID, cellsOverlap, footprint, validateGridLayout } from './grid';
import type { GridConfig, GridPoint } from './grid';
import type { BoardLayout, CardPlacement } from './layout';
import { compactLayout, findFreeSpace, moveCard, resizeCard, setDisplay } from './operations';

const card = (value: string) => value as CardId;
const at = (layout: BoardLayout, cardId: string): CardPlacement | undefined =>
  layout.placements.find((placement) => placement.cardId === cardId);
const value = <T>(result: { ok: boolean; value?: T }): T => {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result)}`);
  return result.value as T;
};

/** Layout válido y reproducible: rectángulos aleatorios que no solapan y modos variados. */
function randomLayout(seed: number, config: GridConfig = DESKTOP_GRID, attempts = 30): BoardLayout {
  const random = seeded(seed);
  const placements: CardPlacement[] = [];
  const modes = ['expanded', 'expanded', 'collapsed', 'minimized'] as const;
  for (let i = 0; i < attempts; i += 1) {
    const w = 1 + Math.floor(random() * 4);
    const candidate = place(`c${i}`, Math.floor(random() * (config.columns - w + 1)), Math.floor(random() * 12), w,
      1 + Math.floor(random() * 3), modes[Math.floor(random() * modes.length)]);
    if (placements.every((other) => !cellsOverlap(footprint(other), footprint(candidate)))) placements.push(candidate);
  }
  return layoutOf(...placements);
}

describe('mover', () => {
  const base = deepFreeze(layoutOf(place('a', 0, 0, 2, 2), place('b', 4, 0, 2, 2)));

  it('mueve a una celda libre sin cambiar tamaño, modo ni el resto de tarjetas', () => {
    const moved = value(moveCard(base, card('a'), { x: 0, y: 5 }, DESKTOP_GRID));
    expect(at(moved, 'a')).toEqual(place('a', 0, 5, 2, 2));
    expect(at(moved, 'b')).toBe(at(base, 'b'));
    expect(moved.placements.map((p) => p.cardId)).toEqual(['a', 'b']);
    expect(moved.boardId).toBe(base.boardId);
  });

  it('permite tocar el borde de otra tarjeta y moverse sobre su propia posición', () => {
    expect(moveCard(base, card('a'), { x: 2, y: 0 }, DESKTOP_GRID).ok).toBe(true);
    expect(moveCard(base, card('a'), { x: 1, y: 1 }, DESKTOP_GRID).ok).toBe(true);
    expect(moveCard(base, card('a'), { x: 10, y: 0 }, DESKTOP_GRID).ok).toBe(true);
  });

  it.each([
    ['fuera por la izquierda', { x: -1, y: 0 }, 'out-of-bounds@to'],
    ['fuera por la derecha', { x: 11, y: 0 }, 'out-of-bounds@to'],
    ['fuera por arriba', { x: 0, y: -2 }, 'out-of-bounds@to'],
    ['contra otra tarjeta', { x: 3, y: 1 }, 'grid-collision@placements[1]'],
    ['posición fraccionaria', { x: 1.5, y: 0 }, 'invalid-layout@to.x'],
    ['posición no finita', { x: 0, y: Number.NaN }, 'invalid-layout@to.y'],
  ])('rechaza mover %s sin cambios parciales', (_case, to, expected) => {
    const result = moveCard(base, card('a'), to, DESKTOP_GRID);
    expect(problems(result)).toEqual([expected]);
    expect(base.placements[0]).toEqual(place('a', 0, 0, 2, 2));
  });

  it('respeta el límite de filas y rechaza IDs inexistentes', () => {
    expect(problems(moveCard(base, card('a'), { x: 0, y: 3 }, { columns: 12, rows: 4 }))).toEqual(['out-of-bounds@to']);
    expect(problems(moveCard(base, card('ghost'), { x: 0, y: 0 }, DESKTOP_GRID))).toEqual(['missing-reference@cardId']);
  });

  it('no opera sobre layouts o configuraciones ya inválidos', () => {
    const overlapping = layoutOf(place('a', 0, 0, 2, 2), place('b', 1, 1, 2, 2));
    expect(problems(moveCard(overlapping, card('a'), { x: 8, y: 8 }, DESKTOP_GRID))).toEqual(['grid-collision@placements[1]']);
    expect(problems(moveCard(base, card('a'), { x: 0, y: 0 }, { columns: 0 }))).toEqual(['invalid-grid-config@columns']);
  });

  it('mueve una tarjeta minimizada según su huella y conserva su tamaño expandido', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 1, 0, 2, 2));
    const moved = value(moveCard(layout, card('a'), { x: 11, y: 0 }, DESKTOP_GRID));
    expect(at(moved, 'a')).toEqual(place('a', 11, 0, 4, 3, 'minimized'));
  });
});

describe('redimensionar', () => {
  const base = deepFreeze(layoutOf(place('a', 0, 0, 2, 2), place('b', 4, 0, 2, 2)));

  it('cambia el tamaño expandido cuando cabe', () => {
    expect(at(value(resizeCard(base, card('a'), { w: 4, h: 3 }, DESKTOP_GRID)), 'a')).toEqual(place('a', 0, 0, 4, 3));
    expect(at(value(resizeCard(base, card('a'), { w: 1, h: 1 }, DESKTOP_GRID)), 'a')).toEqual(place('a', 0, 0, 1, 1));
  });

  it.each([
    ['ancho cero', { w: 0, h: 1 }, 'invalid-layout@size.w'],
    ['alto negativo', { w: 1, h: -1 }, 'invalid-layout@size.h'],
    ['fraccionario', { w: 1.5, h: 1 }, 'invalid-layout@size.w'],
    ['no finito', { w: Number.POSITIVE_INFINITY, h: 1 }, 'invalid-layout@size.w'],
    ['sale de la grilla', { w: 13, h: 1 }, 'out-of-bounds@size'],
    ['colisión', { w: 5, h: 1 }, 'grid-collision@placements[1]'],
  ])('rechaza %s', (_case, size, expected) => {
    expect(problems(resizeCard(base, card('a'), size, DESKTOP_GRID))).toEqual([expected]);
    expect(base.placements[0]).toEqual(place('a', 0, 0, 2, 2));
  });

  it('en una tarjeta minimizada cambia el tamaño a restaurar sin ocupar más', () => {
    const layout = layoutOf(place('a', 0, 0, 1, 1, 'minimized'), place('b', 1, 0, 2, 2));
    expect(at(value(resizeCard(layout, card('a'), { w: 6, h: 2 }, DESKTOP_GRID)), 'a')).toEqual(place('a', 0, 0, 6, 2, 'minimized'));
  });
});

describe('búsqueda de espacio libre', () => {
  it('en un layout vacío devuelve el origen', () => {
    expect(findFreeSpace(layoutOf(), { w: 3, h: 2 }, DESKTOP_GRID)).toEqual({ ok: true, value: { x: 0, y: 0 } });
  });

  it('recorre filas y luego columnas: primera posición libre en orden de lectura', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 1), place('b', 6, 0, 6, 2));
    expect(value(findFreeSpace(layout, { w: 2, h: 1 }, DESKTOP_GRID))).toEqual({ x: 4, y: 0 });
    expect(value(findFreeSpace(layout, { w: 3, h: 1 }, DESKTOP_GRID))).toEqual({ x: 0, y: 1 });
    expect(value(findFreeSpace(layout, { w: 12, h: 1 }, DESKTOP_GRID))).toEqual({ x: 0, y: 2 });
  });

  it('sin límite de filas siempre encuentra sitio si el ancho cabe', () => {
    const full = layoutOf(...Array.from({ length: 5 }, (_, row) => place(`r${row}`, 0, row, 12, 1)));
    expect(value(findFreeSpace(full, { w: 12, h: 3 }, DESKTOP_GRID))).toEqual({ x: 0, y: 5 });
  });

  it('con límite de filas informa si no hay solución', () => {
    const full = layoutOf(place('a', 0, 0, 12, 2), place('b', 0, 2, 11, 1));
    expect(value(findFreeSpace(full, { w: 1, h: 1 }, { columns: 12, rows: 3 }))).toEqual({ x: 11, y: 2 });
    expect(problems(findFreeSpace(full, { w: 2, h: 1 }, { columns: 12, rows: 3 }))).toEqual(['no-free-space@size']);
  });

  it('puede ignorar una tarjeta y rechaza tamaños imposibles', () => {
    const layout = layoutOf(place('a', 0, 0, 12, 1));
    expect(value(findFreeSpace(layout, { w: 12, h: 1 }, DESKTOP_GRID, { ignore: card('a') }))).toEqual({ x: 0, y: 0 });
    expect(problems(findFreeSpace(layout, { w: 13, h: 1 }, DESKTOP_GRID))).toEqual(['out-of-bounds@size']);
    expect(problems(findFreeSpace(layout, { w: 0, h: 1 }, DESKTOP_GRID))).toEqual(['invalid-layout@size.w']);
  });
});

describe('compactación', () => {
  it('sube cada tarjeta sin cambiar columna, en orden de lectura', () => {
    const layout = layoutOf(place('b', 0, 5, 2, 1), place('a', 0, 2, 3, 2), place('c', 6, 9, 2, 2, 'minimized'));
    const compacted = value(compactLayout(layout, DESKTOP_GRID));
    expect(compacted.placements).toEqual([place('b', 0, 2, 2, 1), place('a', 0, 0, 3, 2), place('c', 6, 0, 2, 2, 'minimized')]);
  });

  it('un layout vacío sigue vacío y uno inválido se rechaza', () => {
    expect(value(compactLayout(layoutOf(), DESKTOP_GRID)).placements).toEqual([]);
    expect(compactLayout(layoutOf(place('a', 0, 0, 2, 2), place('b', 0, 1, 2, 2)), DESKTOP_GRID).ok).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('invariantes con layout generado (semilla %i)', (seed) => {
    const layout = deepFreeze(randomLayout(seed));
    expect(validateGridLayout(layout, DESKTOP_GRID).ok).toBe(true);
    const compacted = value(compactLayout(layout, DESKTOP_GRID));
    expect(validateGridLayout(compacted, DESKTOP_GRID).ok).toBe(true);
    // Mismas tarjetas, mismo orden, misma columna y tamaño; nunca bajan.
    expect(compacted.placements.map((p) => p.cardId)).toEqual(layout.placements.map((p) => p.cardId));
    compacted.placements.forEach((placement, i) => {
      const original = layout.placements[i] as CardPlacement;
      expect(placement.rect.x).toBe(original.rect.x);
      expect([placement.rect.w, placement.rect.h, placement.display]).toEqual([original.rect.w, original.rect.h, original.display]);
      expect(placement.rect.y).toBeLessThanOrEqual(original.rect.y);
    });
    // Ninguna tarjeta puede subir más: idempotente y determinista.
    expect(value(compactLayout(compacted, DESKTOP_GRID))).toEqual(compacted);
    expect(value(compactLayout(layout, DESKTOP_GRID))).toEqual(compacted);
    for (const placement of compacted.placements) {
      if (placement.rect.y === 0) continue;
      expect(moveCard(compacted, placement.cardId, { x: placement.rect.x, y: placement.rect.y - 1 }, DESKTOP_GRID).ok).toBe(false);
    }
  });
});

describe('modos de visualización', () => {
  it('expanded → collapsed → minimized conserva identidad y tamaño expandido', () => {
    const layout = deepFreeze(layoutOf(place('a', 2, 1, 4, 3)));
    const collapsed = value(setDisplay(layout, card('a'), 'collapsed', DESKTOP_GRID));
    expect(at(collapsed, 'a')).toEqual(place('a', 2, 1, 4, 3, 'collapsed'));
    const minimized = value(setDisplay(collapsed, card('a'), 'minimized', DESKTOP_GRID));
    expect(at(minimized, 'a')).toEqual(place('a', 2, 1, 4, 3, 'minimized'));
    expect(footprint(at(minimized, 'a') as CardPlacement)).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it('la tarjeta minimizada sigue ocupando su celda', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 3, 'minimized'));
    expect(findFreeSpace(layout, { w: 1, h: 1 }, DESKTOP_GRID)).toEqual({ ok: true, value: { x: 1, y: 0 } });
    expect(problems(moveCard(layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 5, 5, 1, 1)), card('b'), { x: 0, y: 0 }, DESKTOP_GRID)))
      .toEqual(['grid-collision@placements[0]']);
  });

  it('restaura el tamaño al expandir cuando el espacio está libre', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 6, 0, 2, 2));
    expect(at(value(setDisplay(layout, card('a'), 'expanded', DESKTOP_GRID)), 'a')).toEqual(place('a', 0, 0, 4, 3));
  });

  it('si el espacio está ocupado falla por defecto sin cambios parciales', () => {
    const layout = deepFreeze(layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 1, 1, 2, 2)));
    expect(problems(setDisplay(layout, card('a'), 'expanded', DESKTOP_GRID))).toEqual(['grid-collision@placements[1]']);
    // Colapsada ocupa solo la fila 0 y toca a `b` sin solaparse; esa transición sí es válida.
    expect(at(value(setDisplay(layout, card('a'), 'collapsed', DESKTOP_GRID)), 'a')).toEqual(place('a', 0, 0, 4, 3, 'collapsed'));
    expect(at(layout, 'a')).toEqual(place('a', 0, 0, 4, 3, 'minimized'));
  });

  it('con relocate mueve la tarjeta al primer hueco que admite el tamaño restaurado', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 1, 1, 2, 2));
    const restored = value(setDisplay(layout, card('a'), 'expanded', DESKTOP_GRID, { ifOccupied: 'relocate' }));
    expect(at(restored, 'a')).toEqual(place('a', 3, 0, 4, 3));
    expect(at(restored, 'b')).toEqual(place('b', 1, 1, 2, 2));
    expect(validateGridLayout(restored, DESKTOP_GRID).ok).toBe(true);
  });

  it('con relocate informa si no queda sitio, y al expandir fuera de límites también', () => {
    const bounded: GridConfig = { columns: 4, rows: 3 };
    const layout = layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 1, 1, 2, 2));
    expect(problems(setDisplay(layout, card('a'), 'expanded', bounded, { ifOccupied: 'relocate' }))).toEqual(['no-free-space@size']);
    const edge = layoutOf(place('a', 11, 0, 4, 1, 'minimized'));
    expect(problems(setDisplay(edge, card('a'), 'expanded', DESKTOP_GRID))).toEqual(['out-of-bounds@rect']);
    expect(at(value(setDisplay(edge, card('a'), 'expanded', DESKTOP_GRID, { ifOccupied: 'relocate' })), 'a')).toEqual(place('a', 0, 0, 4, 1));
  });

  it('reducir la huella nunca colisiona y el mismo modo no cambia nada', () => {
    const layout = layoutOf(place('a', 0, 0, 4, 3), place('b', 4, 0, 1, 1));
    expect(value(setDisplay(layout, card('a'), 'minimized', DESKTOP_GRID))).toEqual(layoutOf(place('a', 0, 0, 4, 3, 'minimized'), place('b', 4, 0, 1, 1)));
    expect(value(setDisplay(layout, card('a'), 'expanded', DESKTOP_GRID))).toEqual(layout);
  });

  it('rechaza modos desconocidos, IDs inexistentes y opciones inválidas', () => {
    const layout = layoutOf(place('a', 0, 0, 1, 1));
    expect(problems(setDisplay(layout, card('a'), unsafe('hidden'), DESKTOP_GRID))).toEqual(['invalid-layout@display']);
    expect(problems(setDisplay(layout, card('x'), 'minimized', DESKTOP_GRID))).toEqual(['missing-reference@cardId']);
    expect(problems(setDisplay(layout, card('a'), 'minimized', DESKTOP_GRID, unsafe({ ifOccupied: 'push' })))).toEqual(['invalid-value@options.ifOccupied']);
  });
});

describe('invariantes de las operaciones', () => {
  it.each([11, 12, 13, 14, 15])('toda operación devuelve un layout válido o un error sin mutar la entrada (semilla %i)', (seed) => {
    const layout = deepFreeze(randomLayout(seed));
    const snapshot = JSON.stringify(layout);
    const random = seeded(seed * 7);
    for (let i = 0; i < 60; i += 1) {
      const target = layout.placements[Math.floor(random() * layout.placements.length)] as CardPlacement;
      const to: GridPoint = { x: Math.floor(random() * 14) - 1, y: Math.floor(random() * 14) - 1 };
      const results = [
        moveCard(layout, target.cardId, to, DESKTOP_GRID),
        resizeCard(layout, target.cardId, { w: 1 + Math.floor(random() * 5), h: 1 + Math.floor(random() * 4) }, DESKTOP_GRID),
        setDisplay(layout, target.cardId, (['expanded', 'collapsed', 'minimized'] as const)[i % 3] ?? 'expanded', DESKTOP_GRID, { ifOccupied: i % 2 ? 'relocate' : 'fail' }),
      ];
      for (const result of results) {
        if (!result.ok) continue;
        expect(validateGridLayout(result.value, DESKTOP_GRID).ok).toBe(true);
        expect(result.value.placements.map((p) => p.cardId)).toEqual(layout.placements.map((p) => p.cardId));
      }
    }
    expect(JSON.stringify(layout)).toBe(snapshot);
  });
});

/** Oráculo de fuerza bruta: recorre filas y columnas una a una; solo para alturas pequeñas. */
function bruteForceFreeSpace(layout: BoardLayout, w: number, h: number, config: GridConfig): GridPoint | null {
  const cells = layout.placements.map(footprint);
  const limit = config.rows !== undefined ? config.rows - h : cells.reduce((bottom, cell) => Math.max(bottom, cell.y + cell.h), 0);
  for (let y = 0; y <= limit; y += 1) {
    for (let x = 0; x + w <= config.columns; x += 1) {
      if (cells.every((cell) => !cellsOverlap({ x, y, w, h }, cell))) return { x, y };
    }
  }
  return null;
}

describe('regresiones de la revisión de fase 2 (G1, G3, G4)', () => {
  const max = Number.MAX_SAFE_INTEGER;

  it('G1: findFreeSpace no devuelve posiciones cuyo y + h no es representable', () => {
    const layout = layoutOf(place('a', 0, 0, 1, 1));
    expect(problems(findFreeSpace(layout, { w: 1, h: max }, { columns: 1 }))).toEqual(['no-free-space@size']);
    expect(findFreeSpace(layoutOf(), { w: 1, h: max }, { columns: 1 })).toEqual({ ok: true, value: { x: 0, y: 0 } });
  });

  it('G1: relocate al expandir informa de falta de espacio representable sin cambios parciales', () => {
    const layout = deepFreeze(layoutOf(place('a', 1, 0, 2, max, 'minimized'), place('b', 0, 0, 1, 1)));
    expect(validateGridLayout(layout, { columns: 2 }).ok).toBe(true);
    expect(problems(setDisplay(layout, card('a'), 'expanded', { columns: 2 }, { ifOccupied: 'relocate' }))).toEqual(['no-free-space@size']);
    expect(at(layout, 'a')).toEqual(place('a', 1, 0, 2, max, 'minimized'));
  });

  it('G1: relocate al colapsar exige que el tamaño expandido siga siendo representable', () => {
    const layout = layoutOf(place('a', 1, 0, 2, max, 'minimized'), place('b', 0, 0, 1, 1));
    expect(problems(setDisplay(layout, card('a'), 'collapsed', { columns: 2 }, { ifOccupied: 'relocate' }))).toEqual(['no-free-space@size']);
  });

  it('G1: mover o redimensionar no produce un tamaño expandido no representable', () => {
    const layout = layoutOf(place('a', 0, 0, 1, max - 10, 'minimized'));
    expect(problems(moveCard(layout, card('a'), { x: 0, y: 11 }, { columns: 1 }))).toEqual(['out-of-bounds@to']);
    expect(moveCard(layout, card('a'), { x: 0, y: 10 }, { columns: 1 }).ok).toBe(true);
    expect(problems(resizeCard(layoutOf(place('a', 0, 5, 1, 1, 'minimized')), card('a'), { w: 1, h: max - 4 }, { columns: 1 }))).toEqual(['out-of-bounds@size']);
  });

  it('G3: busca por eventos de ocupación con alturas enormes y devuelve la primera posición', () => {
    const tall = 1_000_000_000;
    expect(value(findFreeSpace(layoutOf(place('a', 0, 0, 1, tall)), { w: 1, h: 1 }, { columns: 1 }))).toEqual({ x: 0, y: tall });
    const layout = layoutOf(place('a', 0, 0, 1, tall), place('b', 1, 0, 1, 5));
    expect(value(findFreeSpace(layout, { w: 1, h: 1 }, { columns: 2 }))).toEqual({ x: 1, y: 5 });
    expect(value(findFreeSpace(layout, { w: 2, h: 1 }, { columns: 2 }))).toEqual({ x: 0, y: tall });
    expect(problems(findFreeSpace(layout, { w: 2, h: 2 }, { columns: 2, rows: tall + 1 }))).toEqual(['no-free-space@size']);
    expect(value(findFreeSpace(layout, { w: 1, h: tall }, { columns: 2, rows: tall + 5 }))).toEqual({ x: 1, y: 5 });
  });

  it('G3: relocate con alturas enormes termina y deja un layout válido', () => {
    const tall = 1_000_000_000;
    const layout = layoutOf(place('a', 0, 0, 1, tall), place('b', 1, 0, 2, 3, 'minimized'), place('c', 2, 0, 1, 1));
    const restored = value(setDisplay(layout, card('b'), 'expanded', { columns: 3 }, { ifOccupied: 'relocate' }));
    expect(at(restored, 'b')).toEqual(place('b', 1, 1, 2, 3));
    expect(validateGridLayout(restored, { columns: 3 }).ok).toBe(true);
  });

  it.each([31, 32, 33, 34, 35, 36, 37, 38])('G3: coincide con el recorrido fila a fila (semilla %i)', (seed) => {
    const random = seeded(seed);
    for (const config of [DESKTOP_GRID, { columns: 5 }, { columns: 12, rows: 14 }] as GridConfig[]) {
      const layout = randomLayout(seed, config, 20);
      if (!validateGridLayout(layout, config).ok) continue;
      for (let i = 0; i < 12; i += 1) {
        const w = 1 + Math.floor(random() * config.columns);
        const h = 1 + Math.floor(random() * 4);
        const expected = bruteForceFreeSpace(layout, w, h, config);
        const found = findFreeSpace(layout, { w, h }, config);
        if (expected) expect(found).toEqual({ ok: true, value: expected });
        else expect(problems(found)).toEqual(['no-free-space@size']);
      }
    }
  });

  it('G4: entradas raíz y opciones inválidas devuelven incidencias sin excepción', () => {
    const layout = layoutOf(place('a', 0, 0, 1, 1));
    expect(problems(moveCard(unsafe(null), card('a'), { x: 0, y: 0 }, DESKTOP_GRID))).toEqual(['invalid-value@layout']);
    expect(problems(moveCard(layout, card('a'), unsafe(null), DESKTOP_GRID))).toEqual(['invalid-layout@to']);
    expect(problems(moveCard(layout, card('a'), { x: 0, y: 0 }, unsafe(null)))).toEqual(['invalid-grid-config@config']);
    expect(problems(resizeCard(layout, card('a'), unsafe(null), DESKTOP_GRID))).toEqual(['invalid-layout@size']);
    expect(problems(findFreeSpace(layout, unsafe(null), DESKTOP_GRID))).toEqual(['invalid-layout@size']);
    expect(problems(findFreeSpace(layout, { w: 1, h: 1 }, DESKTOP_GRID, unsafe(null)))).toEqual(['invalid-value@options']);
    expect(problems(setDisplay(layout, card('a'), 'minimized', DESKTOP_GRID, unsafe(null)))).toEqual(['invalid-value@options']);
    expect(problems(compactLayout(unsafe(undefined), DESKTOP_GRID))).toEqual(['invalid-value@layout']);
  });
});

describe('findFreeSpace dentro de una zona (P2: colocar donde se está mirando)', () => {
  const world = { columns: 12, world: true } as const;

  it('empieza en la esquina de la zona, también con coordenadas negativas', () => {
    expect(value(findFreeSpace(layoutOf(place('a', 0, 0, 4, 3)), { w: 4, h: 3 }, world, { from: { x: -10, y: 5 }, columns: 6 }))).toEqual({ x: -10, y: 5 });
  });

  it('recorre la zona en orden de lectura y baja de fila cuando la banda no admite otra tarjeta', () => {
    const layout = layoutOf(place('a', -10, 5, 4, 3));
    expect(value(findFreeSpace(layout, { w: 4, h: 3 }, world, { from: { x: -10, y: 5 }, columns: 6 }))).toEqual({ x: -10, y: 8 });
    // Una banda más estrecha que la tarjeta se ensancha hasta su ancho.
    expect(value(findFreeSpace(layout, { w: 4, h: 3 }, world, { from: { x: -10, y: 5 }, columns: 2 }))).toEqual({ x: -10, y: 8 });
  });

  it('rechaza una zona mal formada sin buscar', () => {
    expect(problems(findFreeSpace(layoutOf(), { w: 1, h: 1 }, world, { columns: 0 }))).toEqual(['invalid-value@options.columns']);
    expect(problems(findFreeSpace(layoutOf(), { w: 1, h: 1 }, world, { from: { x: 0.5, y: 0 } }))).toEqual(['invalid-value@options.from']);
  });
});
