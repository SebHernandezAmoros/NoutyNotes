import { describe, expect, it } from 'vitest';

import { isNoteFont, noteFontFamily } from './fonts';

describe('tipografía de las notas sin conexión (ADR 0030)', () => {
  it('solo fuentes del sistema: cada pila termina en una familia genérica y «Sistema» no fija ninguna', () => {
    expect(noteFontFamily('system', 'web')).toBeUndefined();
    expect(noteFontFamily('serif', 'web')).toBe('Georgia, "Times New Roman", serif');
    expect(noteFontFamily('mono', 'web')).toBe('ui-monospace, Menlo, Consolas, monospace');
    expect([noteFontFamily('serif', 'android'), noteFontFamily('mono', 'android')]).toEqual(['serif', 'monospace']);
    expect([noteFontFamily('serif', 'ios'), noteFontFamily('mono', 'ios')]).toEqual(['Georgia', 'Menlo']);
  });

  it('personalizada (ADR 0041): con familia activada, termina igual en una reserva del sistema; sin ella, cae a «Sistema»', () => {
    expect(noteFontFamily('custom', 'web', 'noty-mi-fuente')).toBe('noty-mi-fuente, Georgia, serif');
    expect(noteFontFamily('custom', 'web')).toBeUndefined();
    expect(noteFontFamily('custom', 'android', 'noty-mi-fuente')).toBe('noty-mi-fuente, Georgia, serif');
    expect(isNoteFont('custom')).toBe(true);
    expect(isNoteFont('comic-sans')).toBe(false);
  });
});
