import { Platform } from 'react-native';

import { mimeForFileName } from './assetMime';

/** «Abrir» un documento o audio de la biblioteca en una pestaña nueva (ADR 0038). Solo web por ahora. */
export function supportsOpenAsset(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Deja que el navegador decida cómo mostrarlo (visor de PDF, reproductor…) en vez de forzar una descarga. */
export function openAssetFile(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeForFileName(fileName) }));
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
