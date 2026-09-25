import { Platform } from 'react-native';

/** Selector de archivo y descarga del navegador para el fallback ZIP (ADR 0011). Solo web. */
export function supportsArchiveFiles(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined' && typeof Blob !== 'undefined';
}

/**
 * Abre el selector de archivos del sistema para un `.zip`. Solo se invoca desde el gesto de un
 * botón. Devuelve `null` si se cancela.
 */
export function pickZipFile(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';
    const finish = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      file.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, { once: true });
    input.addEventListener('cancel', () => { finish(); resolve(null); }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Descarga un archivo generado en memoria, sin red. */
export function downloadFile(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
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
