import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES, metricsFor, parsePreferences, stepPreference } from './preferences';

describe('preferencias de vista del dispositivo (ADR 0014)', () => {
  it('lee lo guardado dentro de los límites y cae en los valores por defecto si falta o está corrupto', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{no es json')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ showGrid: false, snap: false, rowHeight: 80, cardGap: 12, showDates: true, hideFrames: true, noteFont: 'serif' })))
      .toEqual({ showGrid: false, snap: false, rowHeight: 80, cardGap: 12, showDates: true, hideFrames: true, noteFont: 'serif', customFontRef: null });
    // Fecha visible (ADR 0029): apagada por defecto y también si lo guardado no es un booleano.
    expect(parsePreferences(JSON.stringify({ showDates: 'sí' })).showDates).toBe(false);
    // Marco oculto (UX7-D3/ADR 0049): visible por defecto y también si lo guardado no es un booleano.
    expect(parsePreferences(JSON.stringify({ hideFrames: 'sí' })).hideFrames).toBe(false);
    // Tipografía de las notas (ADR 0030): «Sistema» por defecto y también ante un valor desconocido.
    expect(parsePreferences(JSON.stringify({ noteFont: 'comic-sans' })).noteFont).toBe('system');
    // Fuente importada (ADR 0041): se lee si es texto; cualquier otra cosa cae a null (sin fuente activada).
    expect(parsePreferences(JSON.stringify({ noteFont: 'custom', customFontRef: 'assets/fonts/mi-fuente.ttf' })).customFontRef).toBe('assets/fonts/mi-fuente.ttf');
    expect(parsePreferences(JSON.stringify({ customFontRef: 42 })).customFontRef).toBeNull();
    // Fuera de rango o de paso: se ajusta al valor válido más cercano; tipos erróneos, por defecto.
    expect(parsePreferences(JSON.stringify({ showGrid: 'sí', rowHeight: 500, cardGap: 3 })))
      .toEqual({ ...DEFAULT_PREFERENCES, rowHeight: 96, cardGap: 4 });
  });

  it('sube y baja por pasos sin salir de los límites', () => {
    expect(stepPreference(DEFAULT_PREFERENCES, 'rowHeight', 1).rowHeight).toBe(56);
    expect(stepPreference({ ...DEFAULT_PREFERENCES, rowHeight: 48 }, 'rowHeight', -1).rowHeight).toBe(48);
    expect(stepPreference({ ...DEFAULT_PREFERENCES, cardGap: 16 }, 'cardGap', 1).cardGap).toBe(16);
  });

  it('la densidad cambia filas y separación; en móvil una ficha minimizada sigue midiendo al menos 44 px', () => {
    // UX7-D1: por defecto (48 px) la separación de 6 px no cabe sin bajar el área táctil de 44 px, así
    // que se recorta a 4 px (el mínimo de `PREFERENCE_LIMITS.cardGap`), en ancho y en compacto.
    expect(metricsFor('wide', DEFAULT_PREFERENCES)).toEqual({ cell: 48, row: 48, gap: 4 });
    expect(metricsFor('compact', DEFAULT_PREFERENCES)).toEqual({ cell: 40, row: 40, gap: 4 });
    expect(metricsFor('wide', { ...DEFAULT_PREFERENCES, rowHeight: 96, cardGap: 16 })).toEqual({ cell: 96, row: 96, gap: 16 });
    // Compacto con fila 48 (56 − 8): la separación se limita para que 56 − gap y 48 − gap ≥ 44.
    expect(metricsFor('compact', { ...DEFAULT_PREFERENCES, rowHeight: 56, cardGap: 16 })).toEqual({ cell: 48, row: 48, gap: 4 });
  });
});
