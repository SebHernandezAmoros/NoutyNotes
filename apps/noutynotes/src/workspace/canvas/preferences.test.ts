import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES, metricsFor, parsePreferences, stepPreference } from './preferences';

describe('preferencias de vista del dispositivo (ADR 0014)', () => {
  it('lee lo guardado dentro de los límites y cae en los valores por defecto si falta o está corrupto', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{no es json')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ showGrid: false, snap: false, rowHeight: 80, cardGap: 12 })))
      .toEqual({ showGrid: false, snap: false, rowHeight: 80, cardGap: 12 });
    // Fuera de rango o de paso: se ajusta al valor válido más cercano; tipos erróneos, por defecto.
    expect(parsePreferences(JSON.stringify({ showGrid: 'sí', rowHeight: 500, cardGap: 3 })))
      .toEqual({ ...DEFAULT_PREFERENCES, rowHeight: 96, cardGap: 4 });
  });

  it('sube y baja por pasos sin salir de los límites', () => {
    expect(stepPreference(DEFAULT_PREFERENCES, 'rowHeight', 1).rowHeight).toBe(72);
    expect(stepPreference({ ...DEFAULT_PREFERENCES, rowHeight: 56 }, 'rowHeight', -1).rowHeight).toBe(56);
    expect(stepPreference({ ...DEFAULT_PREFERENCES, cardGap: 16 }, 'cardGap', 1).cardGap).toBe(16);
  });

  it('la densidad cambia filas y separación; en móvil una ficha minimizada sigue midiendo al menos 44 px', () => {
    expect(metricsFor('wide', DEFAULT_PREFERENCES)).toEqual({ cell: 96, row: 64, gap: 8 });
    expect(metricsFor('compact', DEFAULT_PREFERENCES)).toEqual({ cell: 56, row: 56, gap: 8 });
    expect(metricsFor('wide', { ...DEFAULT_PREFERENCES, rowHeight: 96, cardGap: 16 })).toEqual({ cell: 96, row: 96, gap: 16 });
    // Compacto con fila 48 (56 − 8): la separación se limita para que 56 − gap y 48 − gap ≥ 44.
    expect(metricsFor('compact', { ...DEFAULT_PREFERENCES, rowHeight: 56, cardGap: 16 })).toEqual({ cell: 56, row: 48, gap: 4 });
  });
});
