import { Platform } from 'react-native';

/** «Abrir» un documento o audio de la biblioteca en una pestaña nueva (ADR 0038). Solo web por ahora. */
export function supportsOpenAsset(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
};

/** Deja que el navegador decida cómo mostrarlo (visor de PDF, reproductor…) en vez de forzar una descarga. */
export function openAssetFile(fileName: string, bytes: Uint8Array): void {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const type = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
