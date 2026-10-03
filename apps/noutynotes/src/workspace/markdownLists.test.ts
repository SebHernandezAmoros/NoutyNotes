import { describe, expect, it } from 'vitest';

import { applyInlineMark, applyListCommand, continueListOnChange, isChecklistLine, markdownExcerpt, normalizeListChange, parseChecklistLine, renumberOrderedLists, toggleChecklistLine } from './markdownLists';

describe('herramientas Markdown portables', () => {
  it('inserta guiones, viñetas, enumeración y casillas en la selección', () => {
    expect(applyListCommand('uno\ndos', { start: 0, end: 7 }, 'dash').text).toBe('- uno\n- dos');
    expect(applyListCommand('uno', { start: 0, end: 0 }, 'bullet').text).toBe('* uno');
    expect(applyListCommand('uno\ndos', { start: 0, end: 7 }, 'number').text).toBe('1. uno\n2. dos');
    expect(applyListCommand('uno', { start: 0, end: 0 }, 'check').text).toBe('- [ ] uno');
  });

  it('Enter continúa la lista y Enter en un elemento vacío la termina', () => {
    expect(continueListOnChange('- uno', '- uno\n', { start: 5, end: 5 })?.text).toBe('- uno\n- ');
    expect(continueListOnChange('2. uno', '2. uno\n', { start: 6, end: 6 })?.text).toBe('2. uno\n3. ');
    expect(continueListOnChange('- [x] listo', '- [x] listo\n', { start: 11, end: 11 })?.text).toBe('- [x] listo\n- [ ] ');
    expect(continueListOnChange('- ', '- \n', { start: 2, end: 2 })?.text).toBe('\n');
    expect(continueListOnChange('4. ', '4. \n', { start: 3, end: 3 })?.text).toBe('\n');
    expect(continueListOnChange('```md\n- código', '```md\n- código\n', { start: 14, end: 14 })).toBeNull();
  });

  it('renumera bloques al insertar o borrar líneas, sin tocar bloques cercados', () => {
    expect(renumberOrderedLists('3. uno\n9. dos\n7. tres\n\n```md\n1. código\n8. literal\n```'))
      .toBe('3. uno\n4. dos\n5. tres\n\n```md\n1. código\n8. literal\n```');
    expect(renumberOrderedLists('1. uno\n3. tres')).toBe('1. uno\n2. tres');
    expect(normalizeListChange('1. uno\n2. dos\n3. tres', '1. uno\n3. tres', { start: 15, end: 15 })?.text)
      .toBe('1. uno\n2. tres');
  });

  it('marca casillas por línea sin alterar el resto del Markdown', () => {
    expect(toggleChecklistLine('- [ ] uno\n- [x] dos', 0)).toBe('- [x] uno\n- [x] dos');
    expect(toggleChecklistLine('- [ ] uno\n- [x] dos', 1)).toBe('- [ ] uno\n- [ ] dos');
    expect(toggleChecklistLine('texto', 0)).toBeNull();
  });

  it('reconoce y descompone una línea de checklist (UX7-B2: misma regla para lienzo, editor y resumen)', () => {
    expect(isChecklistLine('- [ ] uno')).toBe(true);
    expect(isChecklistLine('  * [x] con sangría')).toBe(true);
    expect(isChecklistLine('- uno')).toBe(false);
    expect(isChecklistLine('texto')).toBe(false);
    expect(parseChecklistLine('- [ ] comprar leche')).toEqual({ indent: '', checked: false, text: 'comprar leche' });
    expect(parseChecklistLine('  - [x] hecho')).toEqual({ indent: '  ', checked: true, text: 'hecho' });
    expect(parseChecklistLine('- comprar leche')).toBeNull();
  });

  it('envuelve o quita negrita/cursiva en la selección, manteniéndola; sin selección abre el par (UX7-B3)', () => {
    // Envolver una selección: el texto seleccionado se conserva, ahora entre marcas.
    expect(applyInlineMark('un texto', { start: 3, end: 8 }, 'bold')).toEqual({ text: 'un **texto**', selection: { start: 5, end: 10 } });
    expect(applyInlineMark('un texto', { start: 3, end: 8 }, 'italic')).toEqual({ text: 'un *texto*', selection: { start: 4, end: 9 } });
    // Alternar: la misma selección ya envuelta exactamente en esa marca la pierde.
    expect(applyInlineMark('un **texto**', { start: 5, end: 10 }, 'bold')).toEqual({ text: 'un texto', selection: { start: 3, end: 8 } });
    expect(applyInlineMark('un *texto*', { start: 4, end: 9 }, 'italic')).toEqual({ text: 'un texto', selection: { start: 3, end: 8 } });
    // Sin selección: abre el par y deja el cursor en medio, listo para escribir.
    expect(applyInlineMark('', { start: 0, end: 0 }, 'bold')).toEqual({ text: '****', selection: { start: 2, end: 2 } });
    // Negrita no confunde una cursiva ya puesta (marcas de distinta longitud): la envuelve a su vez.
    expect(applyInlineMark('un *texto*', { start: 4, end: 9 }, 'bold')).toEqual({ text: 'un ***texto***', selection: { start: 6, end: 11 } });
  });

  it('muestra listas y títulos como texto seguro, sin interpretar HTML ni código', () => {
    expect(markdownExcerpt('# Idea\n- [x] lista\n* viñeta\n<script>run()</script>'))
      .toBe('Idea\n☑ lista\n• viñeta\n<script>run()</script>');
    expect(markdownExcerpt('```md\n- [ ] literal\n```')).toBe('```md\n- [ ] literal\n```');
  });
});

describe('regresiones de listas (P3)', () => {
  it('al volver de una sublista, la numeración exterior continúa en vez de reiniciarse', () => {
    expect(renumberOrderedLists('1. a\n   1. x\n   2. y\n1. b\n5. c')).toBe('1. a\n   1. x\n   2. y\n2. b\n3. c');
  });

  it('borrar el primer elemento conserva el número con que empezaba la lista; editar el número lo respeta', () => {
    expect(normalizeListChange('1. Harina\n2. Agua\n3. Sal', '2. Agua\n3. Sal', { start: 0, end: 10 })?.text).toBe('1. Agua\n2. Sal');
    expect(normalizeListChange('x\n1. a\n2. b\n3. c', 'x\n2. b\n3. c', { start: 2, end: 7 })?.text).toBe('x\n1. b\n2. c');
    // Renumerar cambia la longitud (10 → 9): el cursor, al final del texto, queda al final.
    const ten = Array.from({ length: 10 }, (_, i) => `${i + 1}. e${i + 1}`).join('\n');
    const withoutSecond = ten.replace('2. e2\n', '');
    const renumbered = normalizeListChange(ten, withoutSecond, { start: ten.length, end: ten.length });
    expect(renumbered?.text.endsWith('\n9. e10')).toBe(true);
    expect(renumbered?.caret).toBe(renumbered?.text.length);
    // La persona cambia a propósito el primer número: la lista empieza ahí.
    expect(normalizeListChange('1. a\n2. b', '3. a\n2. b', { start: 0, end: 1 })?.text).toBe('3. a\n4. b');
  });

  it('aplicar una lista a varias líneas conserva en blanco las líneas vacías', () => {
    expect(applyListCommand('uno\n\ndos', { start: 0, end: 8 }, 'dash').text).toBe('- uno\n\n- dos');
    expect(applyListCommand('uno\n\ndos', { start: 0, end: 8 }, 'number').text).toBe('1. uno\n\n2. dos');
    // Una sola línea vacía (la nota nueva) sí recibe la marca: es donde se empieza a escribir.
    expect(applyListCommand('', { start: 0, end: 0 }, 'number')).toEqual({ text: '1. ', caret: 3 });
    expect(applyListCommand('a\n', { start: 2, end: 2 }, 'check').text).toBe('a\n- [ ] ');
  });
});
