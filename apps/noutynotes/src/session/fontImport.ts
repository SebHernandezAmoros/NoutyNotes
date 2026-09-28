import { Platform } from 'react-native';

import type { PickedFile } from './imageTypes';

export type { PickedFile } from './imageTypes';

/**
 * Tipos que se ofrecen en el selector de fuentes (ADR 0041). Solo filtra lo que muestra el selector del
 * sistema; la validación real es por firma binaria (`inspectFont`), nunca por esto ni por la extensión.
 */
const FONT_MIME_TYPES = ['font/ttf', 'font/otf', 'font/sfnt', 'application/x-font-ttf', 'application/x-font-otf'] as const;

/** Selector de fuente (ADR 0041): solo web por ahora, mismo patrón que `fileImport.ts`. */
export function supportsFontImport(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Selector de archivo del navegador. Solo desde el gesto de un botón; `null` si se cancela. */
export function pickFontFile(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [...FONT_MIME_TYPES, '.ttf', '.otf'].join(',');
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
