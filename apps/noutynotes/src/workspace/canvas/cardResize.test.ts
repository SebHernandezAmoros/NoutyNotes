import { expect, it } from 'vitest';
import { COMPACT_METRICS, resizeRectTarget } from './geometry';

it('noroeste mueve origen y tamaño manteniendo el extremo opuesto bajo zoom', () => {
  const source = { x: 10, y: 20, w: 4, h: 3 };
  expect(resizeRectTarget(source, 'nw', 28, 28, 0.5, COMPACT_METRICS)).toEqual({ x: 11, y: 21, w: 3, h: 2 });
  expect(source).toEqual({ x: 10, y: 20, w: 4, h: 3 });
});

it('no cruza el lado opuesto al llegar a 1×1 y no cambia el eje ajeno al asa', () => {
  const rect = { x: -3.25, y: 2, w: 4, h: 3 };
  expect(resizeRectTarget(rect, 'nw', 1000, 1000, 1, COMPACT_METRICS)).toEqual({ x: -0.25, y: 4, w: 1, h: 1 });
  expect(resizeRectTarget(rect, 'w', -56, 400, 1, COMPACT_METRICS)).toEqual({ x: -4.25, y: 2, w: 5, h: 3 });
  expect(resizeRectTarget(rect, 'n', 400, -56, 1, COMPACT_METRICS)).toEqual({ x: -3.25, y: 1, w: 4, h: 4 });
});

it.each([
  ['n', { x: 10, y: 21, w: 4, h: 2 }],
  ['ne', { x: 10, y: 21, w: 5, h: 2 }],
  ['e', { x: 10, y: 20, w: 5, h: 3 }],
  ['se', { x: 10, y: 20, w: 5, h: 4 }],
  ['s', { x: 10, y: 20, w: 4, h: 4 }],
  ['sw', { x: 11, y: 20, w: 3, h: 4 }],
  ['w', { x: 11, y: 20, w: 3, h: 3 }],
  ['nw', { x: 11, y: 21, w: 3, h: 2 }],
] as const)('el asa %s conserva sus lados opuestos', (handle, expected) => {
  expect(resizeRectTarget({ x: 10, y: 20, w: 4, h: 3 }, handle, 56, 56, 1, COMPACT_METRICS)).toEqual(expected);
});
