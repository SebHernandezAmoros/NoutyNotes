/**
 * Tipos que se ofrecen en el selector de documentos/audio de la biblioteca (ADR 0038). La validación
 * real es por extensión, igual que el catálogo (`assetKind`): esto solo filtra lo que muestra el
 * selector del sistema, no decide qué se acepta.
 */
export const LIBRARY_FILE_MIME_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text', 'application/rtf',
  'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.presentation',
  'application/json', 'application/x-yaml', 'text/yaml',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/opus',
] as const;
