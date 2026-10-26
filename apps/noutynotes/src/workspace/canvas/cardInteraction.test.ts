import { expect, it } from 'vitest';
import { gestureContext, handlesFor, headerlessGripLayout } from './cardInteraction';
import { COMPACT_METRICS } from './geometry';

it('ocho zonas caben a zoom reducido y una Card diminuta conserva la alternativa contextual', () => {
  expect(handlesFor({ width: 400, height: 240 }, 0.5, 'expanded')).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  expect(handlesFor({ width: 80, height: 70 }, 1, 'expanded')).toEqual(['se']);
  expect(handlesFor({ width: 40, height: 40 }, 0.5, 'expanded')).toEqual([]);
  expect(handlesFor({ width: 300, height: 44 }, 1, 'collapsed')).toEqual(['w', 'e']);
  expect(handlesFor({ width: 400, height: 240 }, 1, 'minimized')).toEqual([]);
});

it('el agarre interior conserva 44 px físicos y espacio para el contenido bajo zoom', () => {
  for (const zoom of [0.5, 1, 1.25]) {
    const grip = headerlessGripLayout({ width: 200, height: 140 }, zoom)!;
    expect(grip.size * zoom).toBe(44);
    expect(grip.inset).toBeGreaterThan(0);
    expect(grip.inset + grip.size).toBeLessThan(200);
    expect(grip.contentTop - grip.inset - grip.size).toBeCloseTo(0, 10);
  }
  expect(headerlessGripLayout({ width: 44, height: 44 }, 1)).toBeNull();
  expect(headerlessGripLayout({ width: 200, height: 100 }, 0.5)).toBeNull();
  const short = headerlessGripLayout({ width: 156, height: 116 }, 0.5)!;
  expect(short.contentTop).toBe(0);
  expect(short.contentLeft - short.inset - short.size).toBeCloseTo(0, 10);
});

it('un gesto pertenece a un tablero, cámara y layout concretos, aunque comparta la misma Card', () => {
  const context = { workspaceId: 'lab', layout: undefined, metrics: COMPACT_METRICS, zoom: 1, pan: { x: 0, y: 0 }, tool: 'select', snap: true };
  const source = gestureContext(context);
  expect(gestureContext({ ...context, pan: { x: 1, y: 0 } })).not.toBe(source);
  expect(gestureContext({ ...context, zoom: 0.5 })).not.toBe(source);
  expect(gestureContext({ ...context, layout: { boardId: 'b' as never, placements: [] } })).not.toBe(source);
  expect(gestureContext(structuredClone(context))).toBe(source);
});
