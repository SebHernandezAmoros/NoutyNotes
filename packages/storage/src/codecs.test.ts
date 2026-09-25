import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../domain/src/__fixtures__/grid';
import type { BoardLayout, Relation } from '@noutynotes/domain';
import { problems, unsafe, valueOf } from './__fixtures__/helpers';
import { parseLayouts, parseRelations, serializeLayouts, serializeRelations } from './codecs';

const relations = deepFreeze<Relation[]>(unsafe([
  { id: 'a-references-b', typeId: 'references', from: 'idea-a', to: 'idea-b' },
  { id: 'b-extends-c', typeId: 'extends', from: 'idea-b', to: 'idea-c', label: 'amplía' },
]));

// Salida esperada escrita a mano: claves ordenadas, listas en su orden y LF.
const relationsText = [
  'relations:',
  '  - from: idea-a',
  '    id: a-references-b',
  '    to: idea-b',
  '    typeId: references',
  '  - from: idea-b',
  '    id: b-extends-c',
  '    label: amplía',
  '    to: idea-c',
  '    typeId: extends',
  'schemaVersion: 1',
  '',
].join('\n');

const layouts = deepFreeze<BoardLayout[]>(unsafe([
  { boardId: 'overview', placements: [
    { cardId: 'idea-a', rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' },
    { cardId: 'idea-b', rect: { x: 20, y: 5, w: 30, h: 2 }, display: 'minimized' },
  ] },
  { boardId: 'empty', placements: [] },
]));

const layoutsText = [
  'layouts:',
  '  - boardId: overview',
  '    placements:',
  '      - cardId: idea-a',
  '        display: expanded',
  '        rect:',
  '          h: 3',
  '          w: 4',
  '          x: 0',
  '          "y": 0',
  '      - cardId: idea-b',
  '        display: minimized',
  '        rect:',
  '          h: 2',
  '          w: 30',
  '          x: 20',
  '          "y": 5',
  '  - boardId: empty',
  '    placements: []',
  'schemaVersion: 1',
  '',
].join('\n');

describe('codec de relaciones', () => {
  it('escribe el YAML esperado y lo vuelve a leer igual', () => {
    expect(valueOf(serializeRelations(relations))).toBe(relationsText);
    expect(valueOf(parseRelations(relationsText))).toEqual(relations);
    expect(valueOf(serializeRelations([]))).toBe('relations: []\nschemaVersion: 1\n');
    expect(valueOf(parseRelations('relations: []\nschemaVersion: 1\n'))).toEqual([]);
  });

  it('lee YAML equivalente escrito a mano con comentarios, comillas y CRLF', () => {
    const edited = '# Relaciones\r\nschemaVersion: 1\r\nrelations:\r\n  - {id: "a-references-b", typeId: references, from: idea-a, to: idea-b} # fin\r\n';
    expect(valueOf(parseRelations(edited))).toEqual([relations[0]]);
  });

  it.each([
    ['versión posterior', 'schemaVersion: 2\nrelations: []\n', 'unsupported-schema-version@.nouty/relations.yaml#schemaVersion'],
    ['sin versión', 'relations: []\n', 'unsupported-schema-version@.nouty/relations.yaml#schemaVersion'],
    ['versión como texto', 'schemaVersion: "1"\nrelations: []\n', 'unsupported-schema-version@.nouty/relations.yaml#schemaVersion'],
    ['no es un objeto', '- a\n', 'invalid-document@.nouty/relations.yaml'],
    ['clave desconocida', 'schemaVersion: 1\nrelations: []\nhooks: []\n', 'unknown-property@.nouty/relations.yaml#hooks'],
    ['clave desconocida en una relación', 'schemaVersion: 1\nrelations:\n  - {id: r, typeId: t, from: a, to: b, weight: 2}\n', 'unknown-property@.nouty/relations.yaml#relations[0].weight'],
    ['tipo incorrecto', 'schemaVersion: 1\nrelations:\n  - {id: r, typeId: t, from: a, to: 3}\n', 'invalid-value@.nouty/relations.yaml#relations[0].to'],
    ['ID inválido', 'schemaVersion: 1\nrelations:\n  - {id: R, typeId: t, from: a, to: b}\n', 'invalid-id@.nouty/relations.yaml#relations[0].id'],
    ['autoenlace', 'schemaVersion: 1\nrelations:\n  - {id: r, typeId: t, from: a, to: a}\n', 'self-relation@.nouty/relations.yaml#relations[0].to'],
    ['ID repetido', 'schemaVersion: 1\nrelations:\n  - {id: r, typeId: t, from: a, to: b}\n  - {id: r, typeId: t, from: b, to: a}\n', 'duplicate-id@.nouty/relations.yaml#relations[1]'],
    ['YAML inválido', 'schemaVersion: 1\nrelations: [\n', 'invalid-yaml@.nouty/relations.yaml'],
    ['alias', 'schemaVersion: 1\nrelations: &x []\nextra: *x\n', 'invalid-yaml@.nouty/relations.yaml'],
  ])('rechaza %s', (_case, text, expected) => {
    expect(problems(parseRelations(text))).toContain(expected);
  });

  it('rechaza datos de entrada que no se pueden escribir sin pérdida y no ejecuta getters', () => {
    expect(problems(serializeRelations(unsafe([{ ...relations[0], weight: 2 }])))).toEqual(['unknown-property@relations[0].weight']);
    expect(problems(serializeRelations(unsafe([{ ...relations[0], id: 'Mal' }])))).toEqual(['invalid-id@relations[0].id']);
    let read = false;
    const tricky = Object.defineProperty({ ...relations[0] }, 'label', { enumerable: true, get: () => { read = true; return 'x'; } });
    expect(problems(serializeRelations(unsafe([tricky])))).toEqual(['executable-content@relations[0].label']);
    expect(read).toBe(false);
    expect(problems(serializeRelations(unsafe(null)))).toEqual(['invalid-value@relations']);
  });
});

describe('codec de layouts', () => {
  it('escribe el YAML esperado y lo vuelve a leer igual', () => {
    expect(valueOf(serializeLayouts(layouts))).toBe(layoutsText);
    expect(valueOf(parseLayouts(layoutsText))).toEqual(layouts);
    // La clave y se entrecomilla porque YAML 1.1 la leería como booleano; sin comillas también es válida en YAML 1.2.
    expect(valueOf(parseLayouts(layoutsText.split('"y"').join('y')))).toEqual(layouts);
  });

  it('no impone una grilla de 12 columnas: el workspace no guarda configuración de grilla', () => {
    const wide = parseLayouts(layoutsText);
    expect(wide.ok && wide.value[0]?.placements[1]?.rect).toEqual({ x: 20, y: 5, w: 30, h: 2 });
  });

  it.each([
    ['coordenada negativa', '{cardId: a, display: expanded, rect: {x: -1, y: 0, w: 1, h: 1}}', 'invalid-layout@.nouty/layout.yaml#layouts[0].placements[0].rect.x'],
    ['coordenada fraccionaria', '{cardId: a, display: expanded, rect: {x: 1.5, y: 0, w: 1, h: 1}}', 'invalid-layout@.nouty/layout.yaml#layouts[0].placements[0].rect.x'],
    ['entero no seguro', '{cardId: a, display: expanded, rect: {x: 0, y: 0, w: 1, h: 9007199254740993}}', 'invalid-layout@.nouty/layout.yaml#layouts[0].placements[0].rect.h'],
    ['modo desconocido', '{cardId: a, display: hidden, rect: {x: 0, y: 0, w: 1, h: 1}}', 'invalid-layout@.nouty/layout.yaml#layouts[0].placements[0].display'],
    ['clave extra en rect', '{cardId: a, display: expanded, rect: {x: 0, y: 0, w: 1, h: 1, z: 0}}', 'unknown-property@.nouty/layout.yaml#layouts[0].placements[0].rect.z'],
    ['colocación repetida', '{cardId: a, display: expanded, rect: {x: 0, y: 0, w: 1, h: 1}}, {cardId: a, display: expanded, rect: {x: 5, y: 0, w: 1, h: 1}}', 'duplicate-id@.nouty/layout.yaml#layouts[0].placements[1]'],
  ])('rechaza %s', (_case, placements, expected) => {
    expect(problems(parseLayouts(`schemaVersion: 1\nlayouts:\n  - {boardId: b, placements: [${placements}]}\n`))).toContain(expected);
  });

  it('rechaza dos layouts para el mismo board', () => {
    const text = 'schemaVersion: 1\nlayouts:\n  - {boardId: b, placements: []}\n  - {boardId: b, placements: []}\n';
    expect(problems(parseLayouts(text))).toEqual(['duplicate-id@.nouty/layout.yaml#layouts[1]']);
  });

  it('rechaza entradas con claves que se perderían y no modifica los datos', () => {
    expect(problems(serializeLayouts(unsafe([{ ...layouts[0], columns: 12 }])))).toEqual(['unknown-property@layouts[0].columns']);
    const snapshot = JSON.stringify(layouts);
    serializeLayouts(layouts);
    expect(JSON.stringify(layouts)).toBe(snapshot);
  });
});
