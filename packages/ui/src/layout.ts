/** Ancho mínimo, en píxeles independientes de densidad, para distribuir el inicio en dos columnas. */
export const wideLayoutMinWidth = 800;

export type LayoutMode = 'compact' | 'wide';

/**
 * Sin medida disponible (render estático o primer paso de la hidratación) se usa la
 * distribución compacta: es legible en cualquier ancho y coincide con el HTML generado.
 */
export function resolveLayoutMode(width: number | null): LayoutMode {
  return width !== null && width >= wideLayoutMinWidth ? 'wide' : 'compact';
}
