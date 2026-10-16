import { describe, expect, it } from 'vitest';

import { isPdfFileName, isPdfSignature, mimeForFileName } from './assetMime';

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

describe('UX7-F: detección de PDF para la vista previa', () => {
  it('isPdfFileName distingue un PDF del resto de documentos, sin distinguir mayúsculas', () => {
    expect(isPdfFileName('Manual.PDF')).toBe(true);
    expect(isPdfFileName('manual.pdf')).toBe(true);
    expect(isPdfFileName('manual.docx')).toBe(false);
    expect(isPdfFileName('manual.txt')).toBe(false);
    expect(isPdfFileName('manual')).toBe(false);
  });

  it('isPdfSignature (PDF-08/PDF-09) exige la cabecera real "%PDF-" — el nombre nunca basta', () => {
    const encoder = new TextEncoder();
    expect(isPdfSignature(encoder.encode('%PDF-1.4\n%âãÏÓ\n1 0 obj'))).toBe(true);
    // Un archivo de texto plano renombrado a .pdf no pasa la firma, aunque el nombre diga lo contrario.
    expect(isPdfSignature(encoder.encode('esto no es un PDF'))).toBe(false);
    // Demasiado corto para contener siquiera la cabecera: tratado como inválido, no como excepción.
    expect(isPdfSignature(encoder.encode('%PD'))).toBe(false);
    expect(isPdfSignature(new Uint8Array(0))).toBe(false);
  });
});
