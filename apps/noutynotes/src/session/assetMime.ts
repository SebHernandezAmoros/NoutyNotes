/**
 * MIME por extensión para descargar o abrir un asset (ADR 0038, ADR 0043). Módulo puro, sin `Platform`
 * ni DOM: así se puede probar con Vitest sin cargar `react-native` (Flow, no soportado por el parser
 * de pruebas).
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2',
};

/** El MIME sale de la extensión real del archivo, no del tipo de asset que decide el catálogo. */
export function mimeForFileName(fileName: string): string {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
