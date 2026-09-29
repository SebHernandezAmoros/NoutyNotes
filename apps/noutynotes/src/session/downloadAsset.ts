import { Platform } from 'react-native';

import { mimeForFileName } from './assetMime';

/**
 * Descargar (guardar como) un asset individual de la biblioteca (ADR 0043): la exportación que
 * quedaba pendiente desde ADR 0031. Solo web por ahora, como «Abrir» (ADR 0038): `URL.createObjectURL`
 * y un enlace con `download` son API del navegador, sin equivalente nativo directo en React Native.
 */
export function supportsAssetDownload(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined' && typeof Blob !== 'undefined';
}

/** Descarga los bytes de un asset con su nombre, cualquiera que sea su tipo. */
export function downloadAssetFile(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeForFileName(fileName) }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
