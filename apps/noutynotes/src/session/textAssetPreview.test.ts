import { expect, it } from 'vitest';
import { decodeTextAssetPreview } from './textAssetPreview';

it('previsualiza Markdown como texto inerte y rechaza UTF-8 inválido o un tipo no admitido', () => {
  const source = '<script>alert(1)</script>\n# Título';
  expect(decodeTextAssetPreview('ideas.md', new TextEncoder().encode(source))).toEqual({ ok: true, text: source });
  expect(decodeTextAssetPreview('ideas.md', new Uint8Array([0xff]))).toEqual({ ok: false, reason: 'encoding' });
  expect(decodeTextAssetPreview('foto.png', new Uint8Array())).toEqual({ ok: false, reason: 'type' });
});

// B9-R4-04: el límite de 1 MiB protege el renderizado, no la lectura (los bytes ya están completos en
// memoria) — un archivo más grande se recorta, nunca se rechaza por completo.
it('un archivo más grande que 1 MiB se previsualiza parcial en vez de rechazarse por completo', () => {
  const bytes = new TextEncoder().encode('a'.repeat(2_000_000));
  const result = decodeTextAssetPreview('grande.txt', bytes);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('no debería fallar');
  expect(result.truncated).toBe(true);
  expect(result.text.length).toBeLessThan(2_000_000);
  expect(result.text.length).toBeGreaterThan(1_000_000);
  expect(result.text).toBe('a'.repeat(result.text.length));
});

it('recorta en la última frontera UTF-8 válida en vez de partir un carácter multibyte por la mitad', () => {
  // El límite cae justo en medio de la codificación de 2 bytes de «é» (0xC3 0xA9).
  const filler = 'a'.repeat(1_048_575);
  const bytes = new TextEncoder().encode(`${filler}é` + 'resto de texto después del corte');
  const result = decodeTextAssetPreview('grande.md', bytes);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('no debería fallar');
  expect(result.truncated).toBe(true);
  // Nunca un carácter de reemplazo ni una excepción: o el carácter completo entra, o se recorta antes.
  expect(result.text.includes('�')).toBe(false);
  expect(result.text.startsWith(filler)).toBe(true);
});

it('un archivo pequeño con un solo byte inválido sigue rechazándose por completo (sin truncar la mitad válida)', () => {
  expect(decodeTextAssetPreview('corto.txt', new Uint8Array([0x61, 0x62, 0xff]))).toEqual({ ok: false, reason: 'encoding' });
});
