import { describe, expect, it } from 'vitest';

import { insertImageBlock, moveNoteBlock, noteImageRefs, parseNoteBlocks, removeNoteBlock, replaceNoteImage, serializeNoteBlocks, setNoteImageAlt, syncNoteAssetRefs } from './note-blocks';

const note = 'Intro del viaje.\nSegunda línea.\n\n![Templo](assets/images/tarjeta-1-1.png)\n\n- uno\n- dos\n\n![Río](assets/images/tarjeta-1-2.jpg)';

describe('bloques de una nota con imágenes (ADR 0021)', () => {
  it('divide en párrafos e imágenes en orden y vuelve a unir sin cambiar el texto', () => {
    const blocks = parseNoteBlocks(note);
    expect(blocks.map((block) => (block.kind === 'image' ? `img:${block.ref}` : `txt:${block.text}`))).toEqual([
      'txt:Intro del viaje.\nSegunda línea.', 'img:assets/images/tarjeta-1-1.png', 'txt:- uno\n- dos', 'img:assets/images/tarjeta-1-2.jpg',
    ]);
    expect(serializeNoteBlocks(blocks)).toBe(note);
    expect(noteImageRefs(note)).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg']);
  });

  it('una imagen externa, una ruta no portable o una línea dentro de código son texto', () => {
    const text = '![web](https://ejemplo.com/a.png)\n\n![sube](../fuera.png)\n\n```\n![no](assets/images/x.png)\n\n```\n\nfin';
    expect(parseNoteBlocks(text).every((block) => block.kind === 'text')).toBe(true);
    expect(noteImageRefs(text)).toEqual([]);
    expect(serializeNoteBlocks(parseNoteBlocks(text))).toBe(text);
  });

  it('insertar va después del párrafo del cursor (o al final); mover, reemplazar, quitar y el texto alternativo', () => {
    const cursorInList = note.indexOf('- dos');
    const inserted = insertImageBlock(note, cursorInList, 'assets/images/tarjeta-1-3.webp', 'Mapa [viejo]\n');
    expect(noteImageRefs(inserted)).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-3.webp', 'assets/images/tarjeta-1-2.jpg']);
    expect(inserted).toContain('- dos\n\n![Mapa viejo](assets/images/tarjeta-1-3.webp)\n\n![Río]');
    expect(noteImageRefs(insertImageBlock('', undefined, 'assets/images/a.png', 'a'))).toEqual(['assets/images/a.png']);
    // La primera imagen (bloque 1) sube al principio.
    expect(parseNoteBlocks(moveNoteBlock(note, 1, -1))[0]).toMatchObject({ kind: 'image', ref: 'assets/images/tarjeta-1-1.png' });
    expect(moveNoteBlock(note, 0, -1)).toBe(note);
    expect(noteImageRefs(replaceNoteImage(note, 3, 'assets/images/tarjeta-1-4.png'))).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-4.png']);
    expect(noteImageRefs(removeNoteBlock(note, 1))).toEqual(['assets/images/tarjeta-1-2.jpg']);
    expect(setNoteImageAlt(note, 1, 'Pagoda')).toContain('![Pagoda](assets/images/tarjeta-1-1.png)');
    // Mientras se escribe, el espacio final se conserva (si no, no se podrían escribir dos palabras).
    expect(setNoteImageAlt(note, 1, 'Pagoda ')).toContain('![Pagoda ](assets/images/tarjeta-1-1.png)');
    expect(setNoteImageAlt(note, 1, 'a]b')).toContain('![a b](assets/images/tarjeta-1-1.png)');
  });

  it('assetRefs sigue al contenido: quita solo las imágenes que salieron del texto y conserva las ajenas', () => {
    const before = ['assets/files/guion.pdf', 'assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg'];
    const after = removeNoteBlock(note, 1);
    expect(syncNoteAssetRefs(before, note, after)).toEqual(['assets/files/guion.pdf', 'assets/images/tarjeta-1-2.jpg']);
    const added = insertImageBlock(note, undefined, 'assets/images/tarjeta-1-5.png', 'nueva');
    expect(syncNoteAssetRefs([], '', added)).toEqual(['assets/images/tarjeta-1-1.png', 'assets/images/tarjeta-1-2.jpg', 'assets/images/tarjeta-1-5.png']);
    expect(syncNoteAssetRefs(undefined, note, 'solo texto')).toEqual([]);
  });
});
