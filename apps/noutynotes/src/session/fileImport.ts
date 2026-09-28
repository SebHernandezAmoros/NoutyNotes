import { Platform } from 'react-native';

import { LIBRARY_FILE_MIME_TYPES } from './fileTypes';
import type { PickedFile } from './imageTypes';

export type { PickedFile } from './imageTypes';

/** Selector genérico de documento/audio (ADR 0038): mismo patrón que `imageFiles.ts`. */
export function supportsFileImport(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Selector de archivo del navegador. Solo desde el gesto de un botón; `null` si se cancela. */
export function pickLibraryFile(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = LIBRARY_FILE_MIME_TYPES.join(',');
    input.style.display = 'none';
    const finish = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      file.arrayBuffer().then((buffer) => resolve({ bytes: new Uint8Array(buffer), name: file.name }), reject);
    }, { once: true });
    input.addEventListener('cancel', () => { finish(); resolve(null); }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
