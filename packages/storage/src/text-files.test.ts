import { describe, expect, it } from 'vitest';

import { problems, unsafe } from './__fixtures__/helpers';
import { MAX_FILES, MAX_TEXT_LENGTH, validateTextFiles } from './text-files';

describe('paquete de archivos de texto', () => {
  it('acepta un mapa de rutas portables a texto y lo devuelve con rutas ordenadas', () => {
    const result = validateTextFiles({ 'cards/b.md': 'B', '.nouty/workspace.yaml': 'x: 1\n', 'cards/a.md': '' });
    expect(result.ok && Object.keys(result.value)).toEqual(['.nouty/workspace.yaml', 'cards/a.md', 'cards/b.md']);
  });

  it('no modifica el mapa recibido', () => {
    const files = Object.freeze({ 'README.md': 'hola\r\n' });
    const result = validateTextFiles(files);
    expect(result.ok && result.value).toEqual(files);
    expect(result.ok && result.value).not.toBe(files);
  });

  it.each([
    ['null', null],
    ['lista', ['a']],
    ['texto', 'README.md'],
  ])('rechaza un contenedor %s', (_case, files) => {
    expect(problems(validateTextFiles(unsafe(files)))).toEqual(['invalid-files@files']);
  });

  it('rechaza contenidos que no son texto y rutas no portables', () => {
    expect(problems(validateTextFiles({ 'README.md': 1 }))).toEqual(['invalid-files@README.md']);
    expect(problems(validateTextFiles({ '../x.md': '' }))).toEqual(['invalid-path@../x.md']);
    expect(problems(validateTextFiles({ 'cards\\a.md': '' }))).toEqual(['invalid-path@cards\\a.md']);
  });

  it('rechaza rutas con sustitutos UTF-16 aislados', () => {
    const path = `assets/a${String.fromCharCode(0xd800)}.txt`;
    expect(problems(validateTextFiles({ [path]: '' }))).toEqual([`invalid-path@${path}`]);
  });

  it('rechaza colisiones de rutas que solo difieren en mayúsculas', () => {
    expect(problems(validateTextFiles({ 'cards/a.md': '', 'Cards/A.md': '' }))).toEqual(['path-collision@cards/a.md']);
  });

  it('no ejecuta getters ni acepta propiedades calculadas', () => {
    let read = false;
    const files = Object.defineProperty({}, 'README.md', { enumerable: true, get: () => { read = true; return 'x'; } });
    expect(problems(validateTextFiles(files))).toEqual(['invalid-files@README.md']);
    expect(read).toBe(false);
  });

  it('aplica los límites de cantidad de archivos y tamaño de texto', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_FILES + 1 }, (_, i) => [`assets/f${i}.txt`, '']));
    expect(problems(validateTextFiles(many))).toEqual(['limit-exceeded@files']);
    const exact = Object.fromEntries(Array.from({ length: MAX_FILES }, (_, i) => [`assets/f${i}.txt`, '']));
    expect(validateTextFiles(exact).ok).toBe(true);
    expect(problems(validateTextFiles({ 'README.md': 'x'.repeat(MAX_TEXT_LENGTH + 1) }))).toEqual(['limit-exceeded@README.md']);
    expect(validateTextFiles({ 'README.md': 'x'.repeat(MAX_TEXT_LENGTH) }).ok).toBe(true);
  });
});
