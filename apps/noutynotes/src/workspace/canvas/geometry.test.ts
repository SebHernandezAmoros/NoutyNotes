import type { BoardLayout, CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import {
  WIDE_METRICS, COMPACT_METRICS, canvasSize, cardBox, checkMove, checkResize, dragTarget, previewBox, resizeTarget,
} from './geometry';

const id = (value: string) => value as CardId;
const layout: BoardLayout = {
  boardId: 'principal' as BoardLayout['boardId'],
  placements: [
    { cardId: id('a'), rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' },
    { cardId: id('b'), rect: { x: 4, y: 0, w: 4, h: 3 }, display: 'expanded' },
    { cardId: id('c'), rect: { x: 0, y: 5, w: 2, h: 2 }, display: 'minimized' },
  ],
};

describe('geometría del lienzo (ADR 0013)', () => {
  it('convierte celdas en cajas de píxeles con separación, según la métrica', () => {
    expect(cardBox({ x: 1, y: 2, w: 4, h: 3 }, WIDE_METRICS)).toEqual({ left: 96 + 4, top: 128 + 4, width: 384 - 8, height: 192 - 8 });
    expect(cardBox({ x: 0, y: 0, w: 4, h: 3 }, COMPACT_METRICS)).toEqual({ left: 4, top: 4, width: 4 * 56 - 8, height: 3 * 56 - 8 });
  });

  it('el lienzo mide 12 columnas y deja filas libres debajo de la última tarjeta (mínimo 8)', () => {
    expect(canvasSize(undefined, WIDE_METRICS)).toEqual({ width: 1152, height: 8 * 64, rows: 8 });
    expect(canvasSize(layout, WIDE_METRICS)).toEqual({ width: 1152, height: 10 * 64, rows: 10 });
  });

  it('el arrastre se convierte en celdas dividiendo por el zoom y redondeando', () => {
    const rect = { x: 2, y: 1, w: 4, h: 3 };
    expect(dragTarget(rect, 96 * 2 + 40, 64 * 1 - 20, 1, WIDE_METRICS)).toEqual({ x: 4, y: 2 });
    // Al 50 %, 96 px de pantalla son dos columnas.
    expect(dragTarget(rect, 96, 0, 0.5, WIDE_METRICS)).toEqual({ x: 4, y: 1 });
    expect(dragTarget(rect, -500, -500, 1, WIDE_METRICS)).toEqual({ x: -3, y: -7 });
  });

  it('las asas cambian ancho, alto o ambos y nunca bajan de 1 × 1', () => {
    const rect = { x: 0, y: 0, w: 4, h: 3 };
    expect(resizeTarget(rect, 'e', 96, 999, 1, WIDE_METRICS)).toEqual({ w: 5, h: 3 });
    expect(resizeTarget(rect, 's', 999, 64, 1, WIDE_METRICS)).toEqual({ w: 4, h: 4 });
    expect(resizeTarget(rect, 'se', -96, 128, 2, WIDE_METRICS)).toEqual({ w: 4, h: 4 });
    expect(resizeTarget(rect, 'se', -2000, -2000, 1, WIDE_METRICS)).toEqual({ w: 1, h: 1 });
  });

  it('la vista previa salta de celda con imán y sigue al puntero sin él', () => {
    const rect = { x: 0, y: 0, w: 4, h: 3 };
    expect(previewBox(rect, { x: 1, y: 0 }, 130, 10, 1, true, WIDE_METRICS)).toEqual(cardBox({ x: 1, y: 0, w: 4, h: 3 }, WIDE_METRICS));
    expect(previewBox(rect, { x: 1, y: 0 }, 130, 10, 1, false, WIDE_METRICS)).toEqual({ left: 4 + 130, top: 4 + 10, width: 376, height: 184 });
    // Sin imán y con zoom, el desplazamiento en el lienzo es el de pantalla dividido por el zoom.
    expect(previewBox(rect, { x: 1, y: 0 }, 130, 10, 2, false, WIDE_METRICS).left).toBe(4 + 65);
  });
});

describe('validación previa al guardado con el motor de grilla', () => {
  it('acepta un destino libre y rechaza colisiones indicando con qué tarjetas', () => {
    expect(checkMove(layout, id('a'), { x: 8, y: 0 })).toEqual({ ok: true });
    expect(checkMove(layout, id('a'), { x: 2, y: 0 })).toEqual({ ok: false, code: 'grid-collision', colliding: ['b'] });
    // La huella minimizada de c es 1 × 1 en (0, 5): (0, 4) con alto 3 la pisa.
    expect(checkMove(layout, id('b'), { x: 0, y: 4 })).toEqual({ ok: false, code: 'grid-collision', colliding: ['c'] });
  });

  it('admite mover en ambos ejes y rechaza solo el límite seguro del mundo', () => {
    expect(checkMove(layout, id('b'), { x: 9, y: 0 })).toEqual({ ok: true });
    expect(checkMove(layout, id('a'), { x: 0, y: -1 })).toEqual({ ok: true });
    expect(checkMove(layout, id('a'), { x: 1_000_000, y: 0 })).toEqual({ ok: false, code: 'out-of-bounds', colliding: [] });
  });

  it('valida tamaños con las mismas reglas', () => {
    expect(checkResize(layout, id('a'), { w: 4, h: 5 })).toEqual({ ok: true });
    expect(checkResize(layout, id('a'), { w: 5, h: 3 })).toEqual({ ok: false, code: 'grid-collision', colliding: ['b'] });
    expect(checkResize(layout, id('b'), { w: 9, h: 3 })).toEqual({ ok: true });
  });
});

describe('toque frente a arrastre', () => {
  it('menos de 6 px en ambos ejes es un toque; desde 6 px, un arrastre', async () => {
    const { isDrag } = await import('./geometry');
    expect(isDrag(5, -5)).toBe(false);
    expect(isDrag(6, 0)).toBe(true);
    expect(isDrag(0, -7)).toBe(true);
  });
});
