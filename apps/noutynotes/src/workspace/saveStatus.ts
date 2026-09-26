/** Estado de guardado de la cabecera (P4): texto y tono. Puro; la pantalla elige el color por tono. */
export type SaveTone = 'saved' | 'saving' | 'error' | 'volatile';

export interface SaveStatusInput {
  readonly mode: 'memory' | 'folder';
  readonly saving: boolean;
  /** El último guardado falló (aviso de error visible). */
  readonly failed: boolean;
  /** App nativa: en memoria se pierde al cerrar, no al recargar. */
  readonly native: boolean;
}

export function saveStatus({ mode, saving, failed, native }: SaveStatusInput): { text: string; tone: SaveTone } {
  if (mode === 'memory') return { text: native ? 'SOLO EN MEMORIA · SE PIERDE AL CERRAR' : 'SOLO EN MEMORIA · SE PIERDE AL RECARGAR', tone: 'volatile' };
  if (saving) return { text: 'GUARDANDO EN LA CARPETA…', tone: 'saving' };
  if (failed) return { text: 'ERROR AL GUARDAR · REVISA EL AVISO', tone: 'error' };
  return { text: 'CARPETA LOCAL · CAMBIOS GUARDADOS', tone: 'saved' };
}
