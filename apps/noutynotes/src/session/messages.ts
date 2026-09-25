import type { WorkspaceStorageIssue } from '@noutynotes/application';

export const MEMORY_LOSS_NOTICE = 'Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.';

/** Textos para los códigos que la interfaz puede provocar. La lógica usa códigos, nunca mensajes. */
const byCode: Readonly<Record<string, string>> = {
  'out-of-bounds': 'La tarjeta saldría de los límites de la grilla.',
  'grid-collision': 'Ahí se solaparía con otra tarjeta.',
  'no-free-space': 'No queda espacio libre en el tablero.',
  'invalid-layout': 'Posición o tamaño no válidos: el mínimo es 1 × 1 dentro de la grilla.',
  'duplicate-relation': 'Estas tarjetas ya están conectadas en ese sentido.',
  'self-relation': 'Una tarjeta no puede conectarse consigo misma.',
  'missing-reference': 'Ese elemento ya no existe en este espacio.',
  'workspace-not-found': `Este espacio no existe en esta sesión. ${MEMORY_LOSS_NOTICE}`,
  'invalid-workspace-id': `Este espacio no existe en esta sesión. ${MEMORY_LOSS_NOTICE}`,
  'permission-denied': 'La carpeta no concedió permiso de lectura y escritura. Vuelve a seleccionarla.',
  'external-change': 'Los archivos cambiaron fuera de NoutyNotes. No se guardó nada. Vuelve a seleccionar la carpeta para cargar los cambios.',
  'io-failure': 'No se pudieron guardar los archivos. Vuelve a seleccionar la carpeta para intentar la recuperación.',
  'invalid-stored-data': 'La carpeta contiene datos inválidos o una recuperación pendiente. No se sobrescribió nada.',
};

/** Mensaje legible del primer problema: la incidencia original del dominio si la hay, o la del puerto. */
export function describeFailure(issues: readonly WorkspaceStorageIssue[], mode: 'memory' | 'folder' = 'memory'): string {
  const [first] = issues;
  if (!first) return 'No se pudo completar la acción.';
  const cause = first.details?.[0] ?? first;
  if (cause.code === 'invalid-value' && cause.path === 'metadata.name') return 'Escribe un nombre para el espacio.';
  if (mode === 'folder' && (cause.code === 'workspace-not-found' || cause.code === 'invalid-workspace-id')) {
    return 'Este espacio no está disponible en la carpeta seleccionada. Si recargaste, vuelve al inicio y selecciona la carpeta.';
  }
  return byCode[cause.code] ?? cause.message;
}
