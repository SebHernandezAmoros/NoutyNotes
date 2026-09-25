import { describe, expect, it } from 'vitest';

import { problems, valueOf } from './__fixtures__/helpers';
import { joinFrontmatter, splitFrontmatter } from './frontmatter';

describe('frontmatter', () => {
  it('escribe delimitadores LF y conserva el cuerpo carácter a carácter', () => {
    expect(joinFrontmatter('id: a\n', '# Título\r\n\r\nTexto  \n')).toBe('---\nid: a\n---\n# Título\r\n\r\nTexto  \n');
    expect(joinFrontmatter('id: a\n', '')).toBe('---\nid: a\n---\n');
  });

  it.each([
    ['LF', '---\nid: a\n---\ncuerpo\n', 'id: a\n', 'cuerpo\n'],
    ['CRLF', '---\r\nid: a\r\n---\r\ncuerpo\r\n', 'id: a\r\n', 'cuerpo\r\n'],
    ['cierre al final sin salto', '---\nid: a\n---', 'id: a\n', ''],
    ['cuerpo vacío', '---\nid: a\n---\n', 'id: a\n', ''],
    ['cuerpo que empieza con salto', '---\nid: a\n---\n\n\nx', 'id: a\n', '\n\nx'],
    ['cuerpo con separadores y cercas', '---\nid: a\n---\n---\n```\n---\n```\n', 'id: a\n', '---\n```\n---\n```\n'],
    ['frontmatter vacío', '---\n---\ncuerpo', '', 'cuerpo'],
  ])('lee delimitadores %s', (_case, text, frontmatter, body) => {
    expect(valueOf(splitFrontmatter(text, 'cards/a.md'))).toEqual({ frontmatter, body });
  });

  it.each([
    ['sin frontmatter', '# Solo Markdown\n'],
    ['apertura con espacios', '--- \nid: a\n---\n'],
    ['sin cierre', '---\nid: a\ncuerpo\n'],
    ['BOM inicial', '\uFEFF---\nid: a\n---\n'],
    ['cierre con texto', '---\nid: a\n--- x\n'],
  ])('rechaza %s', (_case, text) => {
    expect(problems(splitFrontmatter(text, 'cards/a.md'))).toEqual(['invalid-document@cards/a.md']);
  });
});
