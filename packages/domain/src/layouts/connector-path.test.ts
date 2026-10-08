import { describe, expect, it } from 'vitest';

import { problems } from '../__fixtures__/workspace';
import { addConnectorDetour, createOrthogonalConnectorPath, moveConnectorPoint, removeConnectorPoint, resetConnectorPath, validateConnectorPath } from './connector-path';

describe('ruta ortogonal de conector (UX7 P18-D)', () => {
  it('crea una ruta mínima portable entre dos puntos y rechaza diagonales', () => {
    expect(createOrthogonalConnectorPath({ x: 1, y: 2 }, { x: 6, y: 5 })).toEqual([
      { x: 1, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 5 },
    ]);
    expect(problems(validateConnectorPath([{ x: 1, y: 2 }, { x: 2, y: 3 }]))).toContain('invalid-layout@connectorPath[1]');
  });

  it('mueve un codo conservando todos los tramos ortogonales', () => {
    const path = createOrthogonalConnectorPath({ x: 1, y: 2 }, { x: 6, y: 5 });
    expect(moveConnectorPoint(path, 1, { x: 4, y: 4 })).toEqual([
      { x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }, { x: 6, y: 5 },
    ]);
  });

  it('añade un desvío y puede volver a una ruta mínima por la otra orientación', () => {
    const straight = createOrthogonalConnectorPath({ x: 0, y: 0 }, { x: 4, y: 0 });
    const detour = addConnectorDetour(straight, 0, 1);
    expect(detour).toEqual([
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 0 },
    ]);
    expect(resetConnectorPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], 'vertical-first')).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 3 },
    ]);
  });

  it('mantiene el desvío en cuartos de celda cuando el punto medio exacto cae en un octavo', () => {
    const detour = addConnectorDetour([{ x: 0, y: 0 }, { x: 2.25, y: 0 }], 0, 1);
    expect(validateConnectorPath(detour).ok).toBe(true);
    expect(detour).toHaveLength(5);
  });

  it('elimina un punto interior y recompone una unión ortogonal válida', () => {
    const path = [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }, { x: 6, y: 4 }];
    const removed = removeConnectorPoint(path, 1);
    expect(validateConnectorPath(removed).ok).toBe(true);
    expect(removed[0]).toEqual(path[0]);
    expect(removed[removed.length - 1]).toEqual(path[path.length - 1]);
  });
});
