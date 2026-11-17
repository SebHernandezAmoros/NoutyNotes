import { expect, it } from 'vitest';
import { captureDocumentQuote, documentQuoteVerified, readDocumentQuote } from './document-quote';
const fingerprint = 'sha256:' + 'a'.repeat(64);
const input = { visibleText: 'Antes\r\nCita\nDespués', sourceText: 'Antes\r\nCita\nDespués', start: 7, end: 11, fingerprint, kind: 'txt' as const, partial: false };
it('captura texto y contexto independientes con línea TXT verificable y detecta fuente cambiada', () => {
  const result = captureDocumentQuote(input);
  if (!('quote' in result)) throw new Error('quote expected');
  expect(result.quote).toMatchObject({ text: 'Cita', line: 2, prefix: 'Antes\r\n', suffix: '\nDespués' });
  expect(readDocumentQuote(JSON.stringify(result.quote))).toEqual(result.quote);
  expect(documentQuoteVerified(result.quote, fingerprint)).toBe(true);
  expect(documentQuoteVerified(result.quote, 'sha256:' + 'b'.repeat(64))).toBe(false);
});
it('no atribuye línea exacta a Markdown, texto repetido, representación distinta ni vista parcial', () => {
  for (const change of [{kind: 'markdown' as const}, { partial: true }, {sourceText: 'otro'}, {visibleText: 'Cita Cita', start: 0, end: 4}]) {
    const result = captureDocumentQuote({ ...input, ...change });
    expect('quote' in result && result.quote.line).toBeUndefined();
  }
});
it('rechaza vacíos, límites, metadatos inválidos y conserva texto inerte', () => {
  expect(captureDocumentQuote({ ...input, start: 0, end: 0 })).toEqual({error:'empty'});
  expect(captureDocumentQuote({ ...input, visibleText: 'x'.repeat(4001), start: 0, end: 4001 })).toEqual({error:'long'});
  expect(captureDocumentQuote({ ...input, start: -1 })).toEqual({error:'invalid'});
  expect(readDocumentQuote('{')).toBeNull();
  expect(readDocumentQuote(JSON.stringify({...input, version: 9}))).toBeNull();
  const result = captureDocumentQuote({...input, visibleText: '<script>x</script>', start: 0, end: 18});
  expect('quote' in result && result.quote.text).toBe('<script>x</script>');
});
it('conserva separaciones visibles entre párrafos Markdown sin inventar offsets fuente', () => {
  const result = captureDocumentQuote({...input, kind:'markdown', visibleText:'Unodos', start:0, end:6, selectedText:'Uno\n\ndos'});
  expect('quote' in result && result.quote).toMatchObject({text:'Uno\n\ndos', kind:'markdown'});
  expect('quote' in result && result.quote.line).toBeUndefined();
});
