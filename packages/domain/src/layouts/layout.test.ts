import { describe, expect, it } from 'vitest';

import { problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { validateLayout } from './layout';
import type { BoardLayout } from './layout';

const layout = validWorkspace().layouts[0] as BoardLayout;
const withPlacement = (placement: Record<string, unknown>) =>
  unsafe<BoardLayout>({ ...layout, placements: [{ cardId: 'idea-a', rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded', ...placement }] });

describe('layouts en unidades de grilla', () => {
  it('acepta posiciones y tamaños enteros con cualquier modo de visualización', () => {
    expect(validateLayout(layout).ok).toBe(true);
    for (const display of ['expanded', 'collapsed', 'minimized']) {
      expect(validateLayout(withPlacement({ display })).ok).toBe(true);
    }
  });

  it('acepta un layout vacío: una tarjeta del board puede no estar colocada aún', () => {
    expect(validateLayout({ ...layout, placements: [] }).ok).toBe(true);
  });

  it('acepta coordenadas firmadas; los límites dependen de la configuración de grilla', () => {
    expect(validateLayout(withPlacement({ rect: { x: -1, y: -3, w: 1, h: 1 } })).ok).toBe(true);
  });

  it.each([
    ['coordenada fraccionaria (píxeles)', { rect: { x: 12.5, y: 0, w: 1, h: 1 } }, 'invalid-layout@layout.placements[0].rect.x'],
    ['ancho cero', { rect: { x: 0, y: 0, w: 0, h: 1 } }, 'invalid-layout@layout.placements[0].rect.w'],
    ['alto negativo', { rect: { x: 0, y: 0, w: 1, h: -2 } }, 'invalid-layout@layout.placements[0].rect.h'],
    ['medida como texto', { rect: { x: '0', y: 0, w: 1, h: 1 } }, 'invalid-layout@layout.placements[0].rect.x'],
    ['sin rectángulo', { rect: undefined }, 'invalid-layout@layout.placements[0].rect'],
    ['modo desconocido', { display: 'hidden' }, 'invalid-layout@layout.placements[0].display'],
    ['tarjeta con id inválido', { cardId: 'Idea A' }, 'invalid-id@layout.placements[0].cardId'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(validateLayout(withPlacement(change)))).toContain(expected);
  });

  it('rechaza dos colocaciones de la misma tarjeta en un layout', () => {
    const duplicated = { ...layout, placements: [...layout.placements, ...layout.placements.slice(0, 1)] };
    expect(problems(validateLayout(duplicated))).toEqual(['duplicate-id@layout.placements[2]']);
  });
});
