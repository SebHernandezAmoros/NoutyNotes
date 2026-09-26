import { describe, expect, it } from 'vitest';

import type { CardTypeDefinition } from './card-type';
import { linkDisplay, linkUrlField, normalizeLinkUrl } from './links';

const type = (fields: CardTypeDefinition['fields'], base: CardTypeDefinition['base'] = 'link'): CardTypeDefinition =>
  ({ id: 't' as CardTypeDefinition['id'], label: 'T', base, fields });
const url = { key: 'url', kind: 'url', required: true } as CardTypeDefinition['fields'][number];

describe('enlaces de tarjeta (ADR 0020)', () => {
  it('normaliza lo que escribe la persona: sin espacios y con https si falta el esquema', () => {
    expect(normalizeLinkUrl('  https://ejemplo.com/a?b=1 ')).toEqual({ ok: true, value: 'https://ejemplo.com/a?b=1' });
    expect(normalizeLinkUrl('ejemplo.com/ruta')).toEqual({ ok: true, value: 'https://ejemplo.com/ruta' });
    expect(normalizeLinkUrl('HTTP://Ejemplo.com')).toEqual({ ok: true, value: 'HTTP://Ejemplo.com' });
    expect(normalizeLinkUrl('mailto:ana@ejemplo.com')).toEqual({ ok: true, value: 'mailto:ana@ejemplo.com' });
  });

  it('rechaza lo vacío, lo que no es un enlace y los esquemas que ejecutan o leen archivos', () => {
    for (const bad of ['', '   ', 'hola', 'dos palabras.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://ejemplo.com']) {
      expect(normalizeLinkUrl(bad).ok, bad).toBe(false);
    }
  });

  it('el campo de enlace de un tipo es el primero de clase url; solo si el tipo es de enlace', () => {
    expect(linkUrlField(type([{ key: 'nota', kind: 'text' } as CardTypeDefinition['fields'][number], url]))).toBe('url');
    expect(linkUrlField(type([]))).toBeUndefined();
    expect(linkUrlField(type([url], 'note'))).toBeUndefined();
  });

  it('muestra el dominio y la ruta sin el esquema, y el correo en mailto', () => {
    expect(linkDisplay('https://www.ejemplo.com/a/b?c=1')).toEqual({ host: 'www.ejemplo.com', rest: '/a/b?c=1' });
    expect(linkDisplay('http://ejemplo.com')).toEqual({ host: 'ejemplo.com', rest: '' });
    expect(linkDisplay('mailto:ana@ejemplo.com')).toEqual({ host: 'ana@ejemplo.com', rest: '' });
  });
});
