import { describe, expect, it } from 'vitest';
import type { RichTextImage } from '@noutynotes/domain';
import { mergeHiddenIntoOrder, moveReadingId, outgoingReadingTargets, readingPreviewText, readingThumbnailRef, reconcileReadingOrder } from './readingOrder';

const asImageRef = (ref: string) => ref as RichTextImage['assetRef'];

describe('extracto seguro de vista previa (B9-R3-01)', () => {
  it('prioriza contentDocument sobre content, corta espacios y trunca con elipsis', () => {
    expect(readingPreviewText({ content: 'Markdown histórico' })).toBe('Markdown histórico');
    expect(readingPreviewText({
      content: '',
      contentDocument: { schemaVersion: 2, blocks: [{ type: 'heading', level: 1, content: [{ type: 'text', text: 'Título' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Cuerpo  con\nespacios' }] }] },
    })).toBe('Título Cuerpo con espacios');
    expect(readingPreviewText({ content: 'x'.repeat(200) }, 10)).toBe('xxxxxxxxxx…');
  });
  it('ignora bloques no textuales (tabla, imagen, PDF) sin lanzar ni filtrar HTML', () => {
    expect(readingPreviewText({
      contentDocument: { schemaVersion: 2, blocks: [{ type: 'image', assetRef: asImageRef('assets/images/a.png'), alt: 'x' }] },
    })).toBe('');
  });
});

describe('miniatura e imagen intercalada en Markdown v1 (B9-R4-01)', () => {
  it('no muestra la ruta cruda de una imagen intercalada en el extracto de una Nota v1', () => {
    const content = 'Antes de la imagen\n\n![alt](assets/images/a.png)\n\nDespués de la imagen';
    expect(readingPreviewText({ content })).toBe('Antes de la imagen Después de la imagen');
    expect(readingPreviewText({ content })).not.toContain('assets/images');
  });
  it('resuelve la primera imagen intercalada como miniatura, en v1 y en v2', () => {
    const content = 'Texto\n\n![alt](assets/images/a.png)\n\n![alt](assets/images/b.png)';
    expect(readingThumbnailRef({ content })).toBe('assets/images/a.png');
    expect(readingThumbnailRef({
      contentDocument: { schemaVersion: 2, blocks: [{ type: 'image', assetRef: asImageRef('assets/images/c.png'), alt: 'x' }] },
    })).toBe('assets/images/c.png');
    expect(readingThumbnailRef({ content: 'Sin ninguna imagen' })).toBeUndefined();
  });
});

describe('orden principal con tarjetas sin colocación (B9-R4-02)', () => {
  it('reordena solo las visibles y conserva las ocultas en su posición relativa', () => {
    const original = ['a', 'hidden1', 'b', 'c', 'hidden2', 'd'];
    const newVisibleOrder = ['d', 'c', 'b', 'a'];
    expect(mergeHiddenIntoOrder(original, newVisibleOrder)).toEqual(['d', 'hidden1', 'c', 'b', 'hidden2', 'a']);
  });
  it('sin tarjetas ocultas, es una permutación directa; sin cambios, devuelve el mismo conjunto', () => {
    expect(mergeHiddenIntoOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(mergeHiddenIntoOrder(['a', 'hidden', 'b'], ['a', 'b'])).toEqual(['a', 'hidden', 'b']);
  });
  it('conserva siempre el mismo conjunto de IDs, sin perder ni duplicar ninguno', () => {
    const original = ['a', 'hidden1', 'b', 'c', 'hidden2', 'd'];
    const result = mergeHiddenIntoOrder(original, ['b', 'a', 'd', 'c']);
    expect([...result].sort()).toEqual([...original].sort());
    expect(result).toHaveLength(original.length);
  });
});

describe('orden temporal de lectura', () => {
  it('mueve una identidad sin alterar las demás y restaura el orden del tablero', () => {
    const defaults = ['a', 'b', 'c'];
    const custom = moveReadingId(defaults, 'c', -1);
    expect(custom).toEqual(['a', 'c', 'b']);
    expect(defaults).toEqual(['a', 'b', 'c']);
    expect(reconcileReadingOrder(custom, ['a', 'c', 'd'])).toEqual(['a', 'c', 'd']);
    expect(reconcileReadingOrder([], defaults)).toEqual(defaults);
  });
  it('solo ofrece conexiones salientes hacia elementos visibles y deduplica ciclos', () => {
    const relations = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'a', to: 'hidden' }, { from: 'b', to: 'a' }];
    expect(outgoingReadingTargets('a', ['a', 'b'], relations)).toEqual(['b']);
    expect(outgoingReadingTargets('b', ['a', 'b'], relations)).toEqual(['a']);
  });
});
