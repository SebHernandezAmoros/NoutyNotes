import { describe, expect, it } from 'vitest';

import { problems, valueOf } from './__fixtures__/helpers';
import { parseYaml, stringifyYaml } from './yaml';

const nested = (levels: number): string => `${'['.repeat(levels)}${']'.repeat(levels)}\n`;

describe('YAML canónico', () => {
  it('ordena las claves de todos los niveles, conserva el orden de las listas y termina en LF', () => {
    const text = stringifyYaml({ b: 1, a: { z: true, c: ['y', 'x'] }, list: [{ k: 2, j: 1 }] });
    expect(text).toBe([
      'a:',
      '  c:',
      // En YAML 1.1 "y" es booleano: el modo de compatibilidad lo entrecomilla.
      '    - "y"',
      '    - x',
      '  z: true',
      'b: 1',
      'list:',
      '  - j: 1',
      '    k: 2',
      '',
    ].join('\n'));
  });

  it('no parte líneas largas y entrecomilla textos ambiguos para lectores YAML 1.1', () => {
    const long = 'palabra '.repeat(40).trim();
    expect(stringifyYaml({ long })).toBe(`long: ${long}\n`);
    expect(stringifyYaml({ a: 'yes', b: '2026-02-28', c: '0123', d: 'on', e: 'null' }))
      .toBe('a: "yes"\nb: "2026-02-28"\nc: "0123"\nd: "on"\ne: "null"\n');
  });

  it('no genera anchors ni aliases para objetos compartidos, así su propia salida es legible', () => {
    const shared = { key: 'notes', kind: 'markdown' };
    const text = stringifyYaml({ a: shared, b: [shared] });
    expect(text).not.toMatch(/[&*]a\d/);
    expect(valueOf(parseYaml(text, 'x.yaml'))).toEqual({ a: shared, b: [shared] });
  });

  it.each([
    ['CRLF', 'a\r\nb\r\n'],
    ['espacios finales', 'uno   \ndos\n'],
    ['sangría inicial', '  indentado\n'],
    ['solo un salto', '\n'],
    ['sin salto final', 'x\ny'],
    ['vacío', ''],
    ['tabulador', 'a\tb'],
    ['control', 'a\u0007b'],
    ['unicode', 'ñandú 🦜'],
    ['surrogate suelto', 'a\uD800b'],
    ['separadores y cercas', '---\n```ts\nconst a = 1;\n```\n...\n'],
    ['indicadores', '- # : & * ! | > \' " % @ `'],
  ])('conserva exactamente un texto con %s', (_case, value) => {
    expect(valueOf(parseYaml(stringifyYaml({ value }), 'x.yaml'))).toEqual({ value });
  });
});

describe('YAML estricto', () => {
  it('lee YAML 1.2 core con saltos LF o CRLF y devuelve datos simples', () => {
    expect(valueOf(parseYaml('a: 1\r\nb: yes\r\nc: [x, 2]\r\n', 'x.yaml'))).toEqual({ a: 1, b: 'yes', c: ['x', 2] });
    expect(valueOf(parseYaml('%YAML 1.2\n---\na: 1\n', 'x.yaml'))).toEqual({ a: 1 });
    expect(valueOf(parseYaml('', 'x.yaml'))).toBeNull();
  });

  it('no expande claves de mezcla: "<<" queda como una clave más', () => {
    expect(valueOf(parseYaml('b:\n  "<<": {x: 2}\n', 'x.yaml'))).toEqual({ b: { '<<': { x: 2 } } });
  });

  it.each([
    ['sintaxis inválida', 'a: [1, 2\n'],
    ['clave duplicada', 'a: 1\na: 2\n'],
    ['anchor', 'a: &x 1\n'],
    ['alias', 'a: &x 1\nb: *x\n'],
    ['tag estándar explícito', 'a: !!str 1\n'],
    ['tag propio', 'a: !foo 1\n'],
    ['directiva %TAG', '%TAG !e! tag:example.com,2000:\n---\na: !e!x 1\n'],
    ['directiva de otra versión', '%YAML 1.1\n---\na: yes\n'],
    ['varios documentos', 'a: 1\n---\nb: 2\n'],
    ['clave numérica', '1: a\n'],
    ['clave compuesta', '? [a]\n: b\n'],
    ['clave __proto__', '__proto__:\n  polluted: true\n'],
    ['clave __proto__ anidada', 'a:\n  "__proto__": 1\n'],
    ['BOM inicial', '\uFEFFa: 1\n'],
  ])('rechaza %s', (_case, text) => {
    expect(problems(parseYaml(text, 'cfg.yaml'))).toEqual(['invalid-yaml@cfg.yaml']);
  });

  it('limita la profundidad a 64 niveles bajo la raíz sin desbordar la pila', () => {
    expect(parseYaml(nested(65), 'x.yaml').ok).toBe(true);
    expect(problems(parseYaml(nested(66), 'x.yaml'))).toEqual(['limit-exceeded@x.yaml']);
    expect(parseYaml(nested(100_000), 'x.yaml').ok).toBe(false);
  });

  it('no permite prototipos contaminados en los datos leídos', () => {
    const data = valueOf(parseYaml('a: 1\n', 'x.yaml')) as object;
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
