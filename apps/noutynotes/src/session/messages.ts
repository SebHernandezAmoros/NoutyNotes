import type { WorkspaceStorageIssue } from '@noutynotes/application';

import { MEMORY_LOSS_NOTICE } from './memoryNotice';

export { MEMORY_LOSS_NOTICE };

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

/** Texto de un código del motor de grilla o de relaciones, para avisos previos al guardado. */
export function describeCode(code: string): string {
  return byCode[code] ?? 'Posición o tamaño no válidos.';
}

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

const IMPORT_FAILED = 'No se importó el ZIP y no cambió nada.';

/** Motivo de una importación ZIP rechazada: la primera incidencia del formato, con su ruta si es un archivo. */
export function describeImportFailure(issues: readonly WorkspaceStorageIssue[]): string {
  const [first] = issues;
  const cause = first?.details?.[0] ?? first;
  if (!cause) return IMPORT_FAILED;
  const located = cause.path && cause.path !== 'archivo' ? `${cause.path}: ` : '';
  return `${IMPORT_FAILED} ${located}${cause.message}`;
}

/** Resultado de una importación correcta; una copia renombrada se explica siempre. */
export function describeImport(result: { readonly summary: { readonly id: string; readonly name: string }; readonly renamedFrom?: string }): string {
  if (result.renamedFrom !== undefined) {
    return `Ya existía un espacio con el ID «${result.renamedFrom}»: el ZIP se importó como copia con el ID «${result.summary.id}». No se sobrescribió nada.`;
  }
  return `ZIP importado: «${result.summary.name}».`;
}
