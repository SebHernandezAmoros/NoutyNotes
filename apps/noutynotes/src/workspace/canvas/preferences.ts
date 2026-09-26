import type { CanvasMetrics } from './geometry';

/**
 * Preferencias de vista del dispositivo (ADR 0014): no cambian coordenadas, archivos ni el formato,
 * y no viajan con el workspace. El zoom y el desplazamiento son estado de la sesión.
 */
export interface ViewPreferences {
  readonly showGrid: boolean;
  /** Vista previa del arrastre por celdas; al soltar siempre se guarda la celda entera. */
  readonly snap: boolean;
  /** Alto de fila al 100 % en escritorio; en móvil se usa 8 px menos. */
  readonly rowHeight: number;
  /** Separación entre fichas en píxeles. */
  readonly cardGap: number;
}

export const DEFAULT_PREFERENCES: ViewPreferences = { showGrid: true, snap: true, rowHeight: 64, cardGap: 8 };

export const PREFERENCE_LIMITS = {
  rowHeight: { min: 56, max: 96, step: 8 },
  cardGap: { min: 4, max: 16, step: 2 },
} as const;

type NumericPreference = keyof typeof PREFERENCE_LIMITS;

function snapTo(value: number, { min, max, step }: { min: number; max: number; step: number }): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Math.min(max, min + Math.round((clamped - min) / step) * step) + 0;
}

/** Lee lo guardado (JSON) sin confiar en él: tipos erróneos o ausentes toman el valor por defecto. */
export function parsePreferences(stored: string | null): ViewPreferences {
  let data: unknown = null;
  try {
    data = stored === null ? null : JSON.parse(stored);
  } catch {
    data = null;
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const flag = (key: 'showGrid' | 'snap') => (typeof record[key] === 'boolean' ? (record[key] as boolean) : DEFAULT_PREFERENCES[key]);
  const number = (key: NumericPreference) => (typeof record[key] === 'number' && Number.isFinite(record[key])
    ? snapTo(record[key] as number, PREFERENCE_LIMITS[key]) : DEFAULT_PREFERENCES[key]);
  return { showGrid: flag('showGrid'), snap: flag('snap'), rowHeight: number('rowHeight'), cardGap: number('cardGap') };
}

export function stepPreference(preferences: ViewPreferences, key: NumericPreference, direction: 1 | -1): ViewPreferences {
  const limits = PREFERENCE_LIMITS[key];
  return { ...preferences, [key]: snapTo(preferences[key] + direction * limits.step, limits) };
}

/** Área táctil mínima de una ficha minimizada (1 × 1). */
const MIN_TOUCH = 44;

/** Métricas del lienzo según el ancho y la densidad elegida, sin bajar del área táctil mínima. */
export function metricsFor(mode: 'wide' | 'compact', preferences: ViewPreferences): CanvasMetrics {
  const cell = mode === 'wide' ? 96 : 56;
  const row = mode === 'wide' ? preferences.rowHeight : preferences.rowHeight - 8;
  const gap = Math.max(PREFERENCE_LIMITS.cardGap.min, Math.min(preferences.cardGap, Math.min(cell, row) - MIN_TOUCH));
  return { cell, row, gap };
}
