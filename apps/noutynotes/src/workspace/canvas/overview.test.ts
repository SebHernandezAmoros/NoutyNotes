import type { BoardId, BoardLayout, CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { cardsInArea, contentBounds, fitView, minimap, panToCenter, visibleWorld } from './overview';

const metrics = { cell: 100, row: 50, gap: 0 };
const place = (cardId: string, x: number, y: number, w: number, h: number, display: 'expanded' | 'minimized' = 'expanded') =>
  ({ cardId: cardId as CardId, rect: { x, y, w, h }, display });
const layout: BoardLayout = {
  boardId: 'b' as BoardId,
  placements: [place('a', 0, 0, 2, 2), place('lejos', 20, 40, 2, 2, 'minimized')],
  frames: [{ id: 'marco-1', title: 'M', rect: { x: -2, y: -1, w: 4, h: 3 } }],
};

describe('vista general del lienzo (ADR 0028)', () => {
  it('los límites incluyen tarjetas (con su huella: minimizada, 1 × 1) y marcos; sin nada, no hay límites', () => {
    expect(contentBounds(layout, metrics)).toEqual({ left: -200, top: -50, width: 2300, height: 2100 });
    expect(contentBounds({ boardId: 'b' as BoardId, placements: [] }, metrics)).toBeNull();
    expect(contentBounds({ boardId: 'b' as BoardId, placements: [{
      ...place('ruta', 0, 0, 1, 1), connectorPath: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }],
    }] }, metrics)).toEqual({ left: 0, top: 0, width: 400, height: 300 });
  });

  it('«Ver todo» elige el mayor paso de zoom que cabe (sin pasar de 100 %) y centra el contenido', () => {
    const small = fitView({ left: 0, top: 0, width: 200, height: 100 }, { width: 800, height: 600 });
    expect(small.zoom).toBe(1);
    expect(small.pan).toEqual({ x: 300, y: 250 });
    // 1000 px en 800 de ancho (menos márgenes): 75 %.
    expect(fitView({ left: 0, top: 0, width: 1000, height: 100 }, { width: 800, height: 600 }).zoom).toBe(0.75);
    // Enorme: el mínimo, centrado de todos modos.
    const huge = fitView({ left: 1000, top: 0, width: 100_000, height: 100 }, { width: 800, height: 600 });
    expect(huge.zoom).toBe(0.5);
    expect(huge.pan.x).toBe(400 - (1000 + 50_000) * 0.5);
    // Con los controles inferiores (64 px) reservados, el contenido se centra en el alto que queda.
    expect(fitView({ left: 0, top: 0, width: 200, height: 100 }, { width: 800, height: 600 }, 64).pan).toEqual({ x: 300, y: 218 });
  });

  it('el minimapa abarca el contenido y la zona visible, y un punto del minimapa centra la vista ahí', () => {
    const view = visibleWorld({ x: 0, y: 0 }, 1, { width: 400, height: 300 });
    expect(view).toEqual({ left: 0, top: 0, width: 400, height: 300 });
    const map = minimap({ left: 0, top: 0, width: 1000, height: 500 }, view, { width: 110, height: 60 }, 5);
    expect(map.scale).toBeCloseTo(0.1);
    expect(map.toMap({ left: 0, top: 0, width: 400, height: 300 })).toEqual({ left: 5, top: 5, width: 40, height: 30 });
    expect(map.toWorld({ x: 55, y: 30 })).toEqual({ x: 500, y: 250 });
    expect(panToCenter({ x: 500, y: 250 }, 1, { width: 400, height: 300 })).toEqual({ x: -300, y: -100 });
  });

  it('el rectángulo de selección toma las tarjetas que toca, en cualquier sentido del arrastre', () => {
    expect(cardsInArea(layout, metrics, { left: 150, top: 80, width: -100, height: -60 })).toEqual(['a']);
    expect(cardsInArea(layout, metrics, { left: 500, top: 500, width: 10, height: 10 })).toEqual([]);
  });
});
