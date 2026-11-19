import { describe, expect, it } from 'vitest';
import type { DocumentQuote } from '@noutynotes/application';
import { documentQuotePosition } from './documentSelection';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const quote: DocumentQuote = { version: 1, text: 'cita', prefix: 'Antes ', suffix: ' después', fingerprint, kind: 'txt', line: 1 };
describe('B9-R6-C: posición verificable en el texto visible del lector', () => {
  it('localiza una cita única con la misma huella y contexto', () => {
    expect(documentQuotePosition('Antes cita después', quote, { fingerprint, kind: 'txt', partial: false })).toEqual({ start: 6, end: 10 });
  });
  it('rechaza repeticiones, contexto incompatible, fuente cambiada y vista parcial', () => {
    const source = { fingerprint, kind: 'txt' as const, partial: false };
    expect(documentQuotePosition('Antes cita después cita', quote, source)).toBeNull();
    expect(documentQuotePosition('Otro cita después', quote, source)).toBeNull();
    expect(documentQuotePosition('Antes cita después', quote, { ...source, fingerprint: `sha256:${'b'.repeat(64)}` })).toBeNull();
    expect(documentQuotePosition('Antes cita después', quote, { ...source, partial: true })).toBeNull();
  });
  it('Markdown usa texto renderizado y no interpreta línea u offsets de la fuente', () => {
    const markdownQuote: DocumentQuote = { version: 1, text: quote.text, prefix: quote.prefix, suffix: quote.suffix, fingerprint, kind: 'markdown' };
    expect(documentQuotePosition('Antes cita después', markdownQuote, { fingerprint, kind: 'markdown', partial: false })).toEqual({ start: 6, end: 10 });
    expect(documentQuotePosition('Antes cita después', quote, { fingerprint, kind: 'markdown', partial: false })).toBeNull();
  });
});
