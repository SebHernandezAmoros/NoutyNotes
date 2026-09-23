import { describe, expect, it } from 'vitest';

import { problems } from '../__fixtures__/workspace';
import { validateTemplate } from './template';

function template(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    template: { id: 'research-board', name: 'Research Board', version: '1.0.0', author: 'Example Author' },
    cardTypes: [
      { id: 'source', label: 'Fuente', base: 'link', fields: [{ key: 'url', kind: 'url', required: true }] },
      { id: 'finding', label: 'Hallazgo', base: 'note', fields: [{ key: 'confidence', kind: 'select', options: ['low', 'high'] }] },
    ],
    relationTypes: [{ id: 'supports', label: 'Respalda' }],
    boards: [{ id: 'overview', title: 'Resumen' }],
  };
}

describe('validación mínima de plantillas', () => {
  it('acepta una plantilla declarativa y la devuelve sin transformar', () => {
    const input = template();
    const result = validateTemplate(input);
    expect(problems(result)).toEqual([]);
    expect(result.ok && result.value).toBe(input);
  });

  it('acepta datos compartidos como los alias de YAML', () => {
    const shared = { key: 'notes', kind: 'markdown' };
    const input = template();
    input.cardTypes = [
      { id: 'a', label: 'A', base: 'note', fields: [shared] },
      { id: 'b', label: 'B', base: 'note', fields: [shared] },
    ];
    expect(validateTemplate(input).ok).toBe(true);
  });

  it.each([
    ['versión posterior', 2],
    ['sin versión', undefined],
    ['versión como texto', '1'],
  ])('rechaza schemaVersion %s', (_case, schemaVersion) => {
    expect(problems(validateTemplate({ ...template(), schemaVersion }))).toEqual(['unsupported-schema-version@schemaVersion']);
  });

  it.each([
    ['manifiesto ausente', { template: undefined }, 'invalid-value@template'],
    ['id inválido', { template: { id: 'Research Board', name: 'R', version: '1.0.0' } }, 'invalid-id@template.id'],
    ['versión no semántica', { template: { id: 'r', name: 'R', version: 'v1' } }, 'invalid-value@template.version'],
    ['nombre vacío', { template: { id: 'r', name: '', version: '1.0.0' } }, 'invalid-value@template.name'],
    ['tipo de tarjeta específico sin primitiva', { cardTypes: [{ id: 'character', label: 'C', base: 'character', fields: [] }] }, 'invalid-value@cardTypes[0].base'],
    ['campo inválido', { cardTypes: [{ id: 'x', label: 'X', base: 'note', fields: [{ key: 'k', kind: 'javascript' }] }] }, 'invalid-field-definition@cardTypes[0].fields[0].kind'],
    ['boards repetidos', { boards: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }, 'duplicate-id@boards[1]'],
    ['board sin título', { boards: [{ id: 'a' }] }, 'invalid-value@boards[0].title'],
  ])('rechaza %s', (_case, patch, expected) => {
    expect(problems(validateTemplate({ ...template(), ...patch }))).toContain(expected);
  });
});

describe('las plantillas nunca ejecutan código', () => {
  it.each([
    ['scripts', { scripts: { postinstall: 'rm -rf /' } }, 'unknown-property@scripts'],
    ['hooks', { hooks: ['onCreate'] }, 'unknown-property@hooks'],
    ['propiedad desconocida en el manifiesto', { template: { id: 'r', name: 'R', version: '1.0.0', main: 'index.js' } }, 'unknown-property@template.main'],
    ['propiedad desconocida en un board', { boards: [{ id: 'a', title: 'A', onOpen: 'run()' }] }, 'unknown-property@boards[0].onOpen'],
  ])('rechaza la clave %s en lugar de ignorarla', (_case, patch, expected) => {
    expect(problems(validateTemplate({ ...template(), ...patch }))).toContain(expected);
  });

  // Regresiones de R2 (revisión de fase 1): tipos y campos aceptaban claves no declaradas.
  it.each([
    ['en un tipo de tarjeta', { cardTypes: [{ id: 'note', label: 'Nota', base: 'note', fields: [], hooks: ['onCreate'] }] }, 'unknown-property@cardTypes[0].hooks'],
    ['en una definición de campo', {
      cardTypes: [{ id: 'note', label: 'Nota', base: 'note', fields: [{ key: 'title', kind: 'text', onChange: 'run()' }] }],
    }, 'unknown-property@cardTypes[0].fields[0].onChange'],
    ['en un tipo de relación', { relationTypes: [{ id: 'supports', label: 'Respalda', script: 'x' }] }, 'unknown-property@relationTypes[0].script'],
  ])('rechaza propiedades no declaradas %s', (_case, patch, expected) => {
    expect(problems(validateTemplate({ ...template(), ...patch }))).toEqual([expected]);
  });

  it('admite todas las propiedades declaradas de tipos y campos', () => {
    const cardTypes = [{
      id: 'note', label: 'Nota', base: 'note',
      fields: [{ key: 'state', kind: 'select', label: 'Estado', required: true, options: ['a', 'b'] }],
    }];
    expect(problems(validateTemplate({ ...template(), cardTypes }))).toEqual([]);
  });

  it('rechaza funciones sin llamarlas', () => {
    let called = false;
    const input = { ...template(), boards: [{ id: 'a', title: () => { called = true; return 'A'; } }] };
    expect(problems(validateTemplate(input))).toEqual(['executable-content@boards[0].title']);
    expect(called).toBe(false);
  });

  it('rechaza propiedades calculadas sin evaluarlas', () => {
    let evaluated = false;
    const board = Object.defineProperty({ id: 'a' }, 'title', {
      enumerable: true,
      get: () => { evaluated = true; return 'A'; },
    });
    expect(problems(validateTemplate({ ...template(), boards: [board] }))).toEqual(['executable-content@boards[0].title']);
    expect(evaluated).toBe(false);
  });

  it.each([
    ['instancias de clase', new Date(0)],
    ['expresiones regulares', /x/],
    ['símbolos', Symbol('x')],
    ['bigint', 10n],
  ])('rechaza %s', (_case, value) => {
    expect(problems(validateTemplate({ ...template(), extra: value }))[0]).toBe('executable-content@extra');
  });

  it('trata como texto inerte un valor que parece código', () => {
    const input = { ...template(), boards: [{ id: 'a', title: 'eval("alert(1)")' }] };
    expect(validateTemplate(input).ok).toBe(true);
  });

  it('rechaza estructuras circulares', () => {
    const input = template();
    input.self = input;
    expect(problems(validateTemplate(input))).toEqual(['invalid-value@self']);
  });
});
