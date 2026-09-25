import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../domain/src/__fixtures__/grid';
import type { Template } from '@noutynotes/domain';
import { problems, unsafe, valueOf } from './__fixtures__/helpers';
import { parseTemplate, serializeTemplate } from './template-codec';
import type { TextFiles } from './text-files';

const minimal = (): Template => deepFreeze(unsafe<Template>({
  schemaVersion: 1,
  template: { id: 'research', name: 'Research', version: '1.0.0' },
  cardTypes: [{ id: 'source', label: 'Fuente', base: 'link', fields: [{ key: 'url', kind: 'url', required: true }] }],
  relationTypes: [{ id: 'supports', label: 'Respalda' }],
  boards: [{ id: 'overview', title: 'Resumen' }],
}));

// Salida esperada escrita a mano para la plantilla mínima.
const minimalText = [
  'definition:',
  '  boards:',
  '    - id: overview',
  '      title: Resumen',
  '  cardTypes:',
  '    - base: link',
  '      fields:',
  '        - key: url',
  '          kind: url',
  '          required: true',
  '      id: source',
  '      label: Fuente',
  '  relationTypes:',
  '    - id: supports',
  '      label: Respalda',
  '  schemaVersion: 1',
  '  template:',
  '    id: research',
  '    name: Research',
  '    version: 1.0.0',
  'schemaVersion: 1',
  '',
].join('\n');

const complete = (): Template => deepFreeze(unsafe<Template>({
  ...minimal(),
  template: { id: 'research', name: 'Research', version: '1.0.0', author: 'Equipo', description: 'Fuentes y hallazgos.' },
  boards: [{ id: 'overview', title: 'Resumen', description: 'Board\r\ninicial', cardIds: ['paper'] }],
  cards: [{ id: 'paper', typeId: 'source', title: 'Artículo', content: '# Resumen\r\n\r\n```md\n---\n```\n', fields: { url: 'https://example.com/paper' }, assetRefs: ['assets/cover.svg'] }],
  relations: [],
  layouts: [{ boardId: 'overview', placements: [{ cardId: 'paper', rect: { x: 0, y: 0, w: 4, h: 2 }, display: 'expanded' }] }],
  assets: ['assets/cover.svg'],
  preview: 'assets/cover.svg',
  readme: '# Research\r\n\r\nCómo usar la plantilla.\n',
}));

const edit = (files: TextFiles, path: string, text: string): TextFiles => ({ ...files, [path]: text });
const without = (files: TextFiles, path: string): TextFiles => Object.fromEntries(Object.entries(files).filter(([key]) => key !== path));

describe('plantilla ↔ archivos', () => {
  it('escribe la plantilla mínima como template.yaml esperado, sin README', () => {
    expect(valueOf(serializeTemplate(minimal()))).toEqual({ 'template.yaml': minimalText });
    expect(valueOf(parseTemplate({ 'template.yaml': minimalText }))).toEqual(minimal());
  });

  it('separa el README y conserva exactamente su texto', () => {
    const files = valueOf(serializeTemplate(complete()));
    expect(Object.keys(files)).toEqual(['README.md', 'template.yaml']);
    expect(files['README.md']).toBe('# Research\r\n\r\nCómo usar la plantilla.\n');
    expect(files['template.yaml']).toContain('readmeFile: README.md');
    expect(files['template.yaml']).not.toContain('readme:');
    expect(valueOf(parseTemplate(files))).toEqual(complete());
  });

  it('distingue README ausente de README vacío', () => {
    const empty = valueOf(serializeTemplate({ ...minimal(), readme: '' }));
    expect(empty['README.md']).toBe('');
    expect(valueOf(parseTemplate(empty)).readme).toBe('');
    expect('readme' in valueOf(parseTemplate(valueOf(serializeTemplate(minimal()))))).toBe(false);
  });

  it('conserva Markdown de tarjetas y descripciones dentro del YAML', () => {
    const parsed = valueOf(parseTemplate(valueOf(serializeTemplate(complete()))));
    expect(parsed.cards?.[0]?.content).toBe('# Resumen\r\n\r\n```md\n---\n```\n');
    expect(parsed.boards[0]?.description).toBe('Board\r\ninicial');
  });

  it('es determinista y no modifica la plantilla recibida', () => {
    const template = complete();
    const snapshot = JSON.stringify(template);
    expect(serializeTemplate(template)).toEqual(serializeTemplate(complete()));
    expect(JSON.stringify(template)).toBe(snapshot);
  });
});

describe('lectura de plantillas inválidas', () => {
  const files = (): TextFiles => valueOf(serializeTemplate(complete()));

  it.each<[string, (f: TextFiles) => TextFiles, string]>([
    ['sin template.yaml', (f) => without(f, 'template.yaml'), 'missing-file@template.yaml'],
    ['README declarado ausente', (f) => without(f, 'README.md'), 'missing-file@README.md'],
    ['README no declarado', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('readmeFile: README.md\n', '')), 'unexpected-file@README.md'],
    ['archivo desconocido', (f) => edit(f, 'install.sh', 'rm -rf /'), 'unexpected-file@install.sh'],
    ['readme dentro de la definición', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('definition:\n', 'definition:\n  readme: x\n')), 'unknown-property@template.yaml#definition.readme'],
    ['clave desconocida en el sobre', (f) => edit(f, 'template.yaml', `${f['template.yaml'] ?? ''}hooks: []\n`), 'unknown-property@template.yaml#hooks'],
    ['nombre de README distinto', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('readmeFile: README.md', 'readmeFile: readme.md')), 'invalid-value@template.yaml#readmeFile'],
    ['versión de sobre posterior', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace(/\nschemaVersion: 1\n$/, '\nschemaVersion: 2\n')), 'unsupported-schema-version@template.yaml#schemaVersion'],
    ['versión de definición posterior', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('  schemaVersion: 1\n', '  schemaVersion: 2\n')), 'unsupported-schema-version@template.yaml#definition.schemaVersion'],
    ['clave ejecutable en la definición', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('definition:\n', 'definition:\n  scripts: [install]\n')), 'unknown-property@template.yaml#definition.scripts'],
    ['asset no declarado', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('  preview: assets/cover.svg', '  preview: assets/other.svg')), 'missing-reference@template.yaml#definition.preview'],
    ['asset no portable', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replaceAll('assets/cover.svg', 'assets/cover?.svg')), 'invalid-path@template.yaml#definition.assets[0]'],
    ['YAML con anchor', (f) => edit(f, 'template.yaml', (f['template.yaml'] ?? '').replace('definition:', 'definition: &d')), 'invalid-yaml@template.yaml'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(parseTemplate(change(files())))).toContain(expected);
  });

  it('admite y conserva extras bajo assets/', () => {
    const withAssets = { ...files(), 'assets/cover.svg': '<svg/>' };
    expect(valueOf(parseTemplate(withAssets))).toEqual(complete());
  });
});

describe('escritura y preservación de plantillas', () => {
  it('rechaza plantillas inválidas o no portables', () => {
    expect(problems(serializeTemplate(unsafe({ ...minimal(), scripts: ['x'] })))).toEqual(['unknown-property@scripts']);
    expect(problems(serializeTemplate(unsafe({ ...minimal(), assets: ['assets/cover?.svg'], preview: 'assets/cover?.svg' }))))
      .toEqual(['invalid-path@assets[0]', 'invalid-path@preview']);
    expect(problems(serializeTemplate(unsafe({ ...minimal(), readme: () => 'x' })))).toEqual(['executable-content@readme']);
  });

  it('sin cambios reutiliza los bytes anteriores, comentarios incluidos, y conserva assets', () => {
    const previous: TextFiles = { ...valueOf(serializeTemplate(complete())), 'assets/cover.svg': '<svg/>' };
    const commented = edit(previous, 'template.yaml', `# Plantilla revisada a mano\n${previous['template.yaml'] ?? ''}`);
    expect(valueOf(serializeTemplate(complete(), commented))).toEqual(commented);
  });

  it('cambiar solo el README no regenera template.yaml; quitarlo retira README.md', () => {
    const previous: TextFiles = { ...valueOf(serializeTemplate(complete())), 'assets/cover.svg': '<svg/>' };
    const commented = edit(previous, 'template.yaml', `# comentario\n${previous['template.yaml'] ?? ''}`);
    const reworded = valueOf(serializeTemplate({ ...complete(), readme: 'Nuevo\n' }, commented));
    expect(reworded['template.yaml']).toBe(commented['template.yaml']);
    expect(reworded['README.md']).toBe('Nuevo\n');
    const { readme: _removed, ...noReadme } = complete();
    const next = valueOf(serializeTemplate(noReadme, commented));
    expect(Object.keys(next)).toEqual(['assets/cover.svg', 'template.yaml']);
    expect(next['template.yaml']).not.toContain('readmeFile');
  });

  it('rechaza un paquete anterior inválido', () => {
    expect(problems(serializeTemplate(minimal(), { 'template.yaml': 'a: [' }))).toEqual(['invalid-yaml@previousFiles:template.yaml']);
    expect(problems(serializeTemplate(minimal(), { 'template.yaml': minimalText, 'run.js': 'x' }))).toEqual(['unexpected-file@previousFiles:run.js']);
  });
});
