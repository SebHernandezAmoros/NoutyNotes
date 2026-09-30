import { isNoteFont } from '../fonts';
import type { NoteFont } from '../fonts';
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
  /** Fecha de creación en el pie de las fichas (ADR 0029). */
  readonly showDates: boolean;
  /** Tipografía del texto de las notas (ADR 0030): fuentes del sistema, o una importada (ADR 0041). */
  readonly noteFont: NoteFont;
  /** Ruta del asset de la fuente activada como «custom» (ADR 0041); solo tiene sentido en el workspace
   * que la tiene. En otro, o si ya no está, `noteFontFamily` cae a la reserva del sistema por diseño. */
  readonly customFontRef: string | null;
}

export const DEFAULT_PREFERENCES: ViewPreferences = { showGrid: true, snap: true, rowHeight: 64, cardGap: 8, showDates: false, noteFont: 'system', customFontRef: null };

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
  const flag = (key: 'showGrid' | 'snap' | 'showDates') => (typeof record[key] === 'boolean' ? (record[key] as boolean) : DEFAULT_PREFERENCES[key]);
  const number = (key: NumericPreference) => (typeof record[key] === 'number' && Number.isFinite(record[key])
    ? snapTo(record[key] as number, PREFERENCE_LIMITS[key]) : DEFAULT_PREFERENCES[key]);
  const noteFont = isNoteFont(record.noteFont) ? record.noteFont : DEFAULT_PREFERENCES.noteFont;
  const customFontRef = typeof record.customFontRef === 'string' ? record.customFontRef : DEFAULT_PREFERENCES.customFontRef;
  return { showGrid: flag('showGrid'), snap: flag('snap'), rowHeight: number('rowHeight'), cardGap: number('cardGap'), showDates: flag('showDates'), noteFont, customFontRef };
}

export function stepPreference(preferences: ViewPreferences, key: NumericPreference, direction: 1 | -1): ViewPreferences {
  const limits = PREFERENCE_LIMITS[key];
  return { ...preferences, [key]: snapTo(preferences[key] + direction * limits.step, limits) };
}

/** Área táctil mínima de una ficha minimizada (1 × 1). */
const MIN_TOUCH = 44;

/** Métricas del lienzo según el ancho y la densidad elegida, sin bajar del área táctil mínima. */
export function metricsFor(mode: 'wide' | 'compact', preferences: ViewPreferences): CanvasMetrics {
  const row = mode === 'wide' ? preferences.rowHeight : preferences.rowHeight - 8;
  // La unidad visible y la unidad real del arrastre son la misma y cuadrada. Antes escritorio usaba
  // 96 × rowHeight: la cuadrícula se veía rectangular y las subdivisiones sugerían destinos que el
  // motor no podía guardar. Mantener la medida en preferencias evita cambiar las coordenadas del
  // formato; solo corrige su proyección en pantalla.
  const cell = row;
  const gap = Math.max(PREFERENCE_LIMITS.cardGap.min, Math.min(preferences.cardGap, Math.min(cell, row) - MIN_TOUCH));
  return { cell, row, gap };
}
