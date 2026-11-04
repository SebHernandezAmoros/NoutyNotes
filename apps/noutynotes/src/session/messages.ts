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
  // ADR 0010, Paquete 1 (incidente de integridad): antes, ambos casos quedaban bajo el mismo texto
  // genérico de arriba. Ahora cada uno tiene su propia explicación, sin implicar corrupción cuando no
  // se ha demostrado.
  'recovery-pending': 'Esta carpeta tiene una recuperación pendiente de una sesión anterior. Vuelve a seleccionarla para completarla automáticamente; no se modificó nada todavía.',
  'duplicate-workspace-id': 'Hay más de una carpeta con el mismo proyecto dentro de la selección. Quita o renombra la copia repetida y vuelve a intentarlo; no se modificó nada.',
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
  // Un archivo con una versión posterior del formato (por ejemplo, layout v2 abierto por una app que solo
  // conoce v1): se dice qué pasa y qué hacer, y que no se tocó nada, en vez del detalle del esquema.
  if (cause.code === 'unsupported-schema-version') {
    const file = cause.path.split('#')[0] ?? cause.path;
    return `Esta versión de NoutyNotes no reconoce el formato de ${file}; puede venir de una versión más reciente. Actualiza la app para abrirlo; no se modificó ningún archivo.`;
  }
  // ADR 0010, Paquete 1: una estructura inválida (p. ej. el manifiesto no es un objeto YAML) ya
  // identifica el archivo exacto en `cause.path` — mostrarlo evita volver a un mensaje sin ubicación.
  if (mode === 'folder' && cause.code === 'invalid-document' && cause.path) return `${cause.message} (${cause.path})`;
  if (mode === 'folder' && (cause.code === 'workspace-not-found' || cause.code === 'invalid-workspace-id')) {
    return 'Este espacio no está disponible en la carpeta seleccionada. Si recargaste, vuelve al inicio y selecciona la carpeta.';
  }
  // El adaptador distingue rutas ausentes de otros fallos de E/S. Conservar ese texto seguro evita
  // ocultar el diagnóstico bajo la frase genérica asociada al código `io-failure`.
  if (cause.code === 'io-failure') return cause.message;
  // ADR 0010, Paquete 1: `folder-storage.ts` ya redacta un mensaje específico y seguro para cada causa
  // (marcador de recuperación, archivo desaparecido, paquete inválido, ID repetido) — mostrarlo
  // siempre evita que la frase genérica de `byCode` vuelva a ocultar esa clasificación.
  if (cause.code === 'invalid-stored-data' || cause.code === 'recovery-pending' || cause.code === 'duplicate-workspace-id') return cause.message;
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
