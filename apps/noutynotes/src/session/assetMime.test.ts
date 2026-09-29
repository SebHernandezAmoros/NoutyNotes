import { describe, expect, it } from 'vitest';

import { mimeForFileName } from './assetMime';

describe('MIME de un asset descargado o abierto (ADR 0038, ADR 0043)', () => {
  it('sale de la extensión real del archivo, sin distinguir mayúsculas; sin extensión conocida, genérico', () => {
    expect(mimeForFileName('mapa.PNG')).toBe('image/png');
    expect(mimeForFileName('Guion.pdf')).toBe('application/pdf');
    expect(mimeForFileName('tema.mp3')).toBe('audio/mpeg');
    expect(mimeForFileName('mi-fuente.woff2')).toBe('font/woff2');
    expect(mimeForFileName('archivo-sin-extension')).toBe('application/octet-stream');
    expect(mimeForFileName('archivo.raro')).toBe('application/octet-stream');
  });
});
