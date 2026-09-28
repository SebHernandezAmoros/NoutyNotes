import { Platform } from 'react-native';

/** Descarga de un archivo de texto generado en memoria, sin red (ADR 0037). Solo web, como Imprimir. */
export function supportsTextDownload(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined' && typeof Blob !== 'undefined';
}

export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera después de que el navegador haya iniciado la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
