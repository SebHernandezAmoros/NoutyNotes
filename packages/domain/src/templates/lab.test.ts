import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../__fixtures__/grid';
import { asset, id, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import type { TemplateId, WorkspaceId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import { validateTemplate } from './template';
import type { Template } from './template';
import { duplicateTemplate, instantiateTemplate } from './operations';
import { exportTemplate, importTemplate } from './exchange';

function source(): Template {
  const { cards, cardTypes, boards, layouts, relations, relationTypes } = validWorkspace();
  return { schemaVersion: 1, template: { id: id<TemplateId>('example'), name: 'Ejemplo', version: '1.0.0' },
    cards, cardTypes, boards, layouts, relations, relationTypes, assets: [asset('assets/images/a.png')],
    preview: asset('assets/images/a.png'), readme: '# Ejemplo\nTexto **inerte**.',
  };
}
const options = { workspaceId: id<WorkspaceId>('created'), name: 'Mi proyecto', namespace: 'copy' };

describe('contrato completo de plantilla', () => {
  it('acepta contenido completo conservando la identidad del validador', () => {
    const input = deepFreeze(source());
    expect(assertValid(validateTemplate(input))).toBe(input);
  });
  it.each([
    ['cardTypes', [{ id: 'wrong', label: 'Wrong', base: 'note', fields: [] }], 'missing-reference'],
    ['cards', null, 'invalid-value'],
    ['relations', [{ id: 'r', typeId: 'references', from: 'idea-a', to: 'missing' }], 'missing-reference'],
    ['layouts', [{ boardId: 'overview', placements: [{ cardId: 'idea-b', rect: { x: 12, y: 0, w: 4, h: 2 }, display: 'expanded' }] }], 'out-of-bounds'],
    ['assets', [], 'missing-reference'],
    ['assets', ['../escape'], 'invalid-asset-ref'],
    ['assets', ['assets/images/a.png', 'assets/images/a.png'], 'invalid-asset-ref'],
    ['preview', 'assets/missing.svg', 'missing-reference'],
    ['readme', 42, 'invalid-value'],
  ])('rechaza %s inválido', (key, value, code) => {
    const result = validateTemplate({ ...source(), [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain(code);
  });
  it('rechaza colisiones y pertenencias inválidas', () => {
    const input = source();
    const layout = input.layouts![0]!;
    expect(problems(validateTemplate({ ...input, layouts: [{ ...layout, placements: layout.placements.map(p => ({ ...p, rect: { ...p.rect, x: 0 } })) }] }))).toContain('grid-collision@layouts[0].placements[1]');
    expect(problems(validateTemplate({ ...input, boards: input.boards.map(b => ({ ...b, cardIds: [] })) }))).toContain('invalid-membership@layouts[0].placements[0].cardId');
  });
  it('cierra claves en tarjetas, relaciones y geometría', () => {
    const input = source();
    for (const patch of [
      { cards: input.cards!.map(c => ({ ...c, script: 'text' })) },
      { relations: input.relations!.map(r => ({ ...r, hooks: [] })) },
      { layouts: input.layouts!.map(l => ({ ...l, placements: l.placements.map(p => ({ ...p, rect: { ...p.rect, extra: 1 } })) })) },
    ]) {
      const result = validateTemplate({ ...input, ...patch });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some(i => i.code === 'unknown-property')).toBe(true);
    }
  });
  it('rechaza getters anidados sin ejecutarlos', () => {
    let calls = 0;
    const input = source();
    const fields = Object.defineProperty({}, 'summary', { enumerable: true, get() { calls += 1; return 'x'; } });
    expect(validateTemplate({ ...input, cards: [{ ...input.cards![0], fields }] }).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('rechaza datos que el export perdería: huecos, extras en arrays y propiedades ocultas', () => {
    const extra = Object.assign([], { hook: 'x' });
    const hidden = Object.defineProperty(source(), 'readme', { enumerable: false, value: 'invisible' });
    for (const input of [{ ...source(), cards: Array(2) }, { ...source(), cards: extra }, hidden]) {
      expect(validateTemplate(input).ok).toBe(false);
    }
  });
  it('rechaza profundidad excesiva sin desbordar la pila', () => {
    let nested: unknown = {};
    for (let i = 0; i < 500; i += 1) nested = { nested };
    const result = validateTemplate({ ...source(), extra: nested });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(i => i.message.includes('64'))).toBe(true);
  });
});

describe('instanciación y duplicación', () => {
  it('remapea todos los ámbitos y referencias y conserva campos, Markdown y assets', () => {
    const input = deepFreeze(source());
    const result = assertValid(instantiateTemplate(input, options));
    const workspace = result.workspace;
    expect(validateWorkspace(workspace).ok).toBe(true);
    expect(workspace.id).toBe('created');
    expect(workspace.metadata.name).toBe('Mi proyecto');
    expect(workspace.cardTypes[0]!.id).toBe('copy-note');
    expect(workspace.cards[0]!.id).toBe('copy-idea-a');
    expect(workspace.cards[0]!.typeId).toBe('copy-note');
    expect(workspace.cards[0]!.fields).toEqual(input.cards![0]!.fields);
    expect(workspace.cards[0]!.content).toBe(input.cards![0]!.content);
    expect(workspace.boards[0]!.id).toBe('copy-overview');
    expect(workspace.boards[0]!.cardIds).toEqual(['copy-idea-a', 'copy-idea-b']);
    expect(workspace.layouts[0]!.boardId).toBe('copy-overview');
    expect(workspace.layouts[0]!.placements[0]!.cardId).toBe('copy-idea-a');
    expect(workspace.relations[0]).toMatchObject({ id: 'copy-a-references-b', from: 'copy-idea-a', to: 'copy-idea-b', typeId: 'copy-references' });
    expect(result.assets).toEqual(input.assets);
    expect(result.readme).toBe(input.readme);
    expect(result.preview).toBe(input.preview);
    expect(instantiateTemplate(input, options)).toEqual(instantiateTemplate(input, options));
  });
  it('instancias independientes no comparten datos anidados con la fuente', () => {
    const input = source();
    const a = assertValid(instantiateTemplate(input, options));
    const b = assertValid(instantiateTemplate(input, { ...options, namespace: 'other' }));
    expect(a.workspace.cards[0]!.fields).not.toBe(input.cards![0]!.fields);
    expect(a.workspace.cardTypes[0]!.fields).not.toBe(b.workspace.cardTypes[0]!.fields);
    expect(a.workspace.layouts[0]!.placements[0]!.rect).not.toBe(input.layouts![0]!.placements[0]!.rect);
    expect(a.assets).not.toBe(input.assets);
  });
  it('acepta plantilla mínima y normaliza colecciones solo en la instancia', () => {
    const input = { schemaVersion: 1, template: source().template, cardTypes: [], relationTypes: [], boards: [{ id: 'empty', title: 'Vacío' }] };
    const created = assertValid(instantiateTemplate(input, options)).workspace;
    expect(created.cards).toEqual([]);
    expect(created.boards[0]!.cardIds).toEqual([]);
    expect(validateWorkspace(created).ok).toBe(true);
    expect(input).not.toHaveProperty('cards');
  });
  it('duplica con manifiesto nuevo, referencias remapeadas y sin modificar el original', () => {
    const input = deepFreeze(source());
    const duplicate = assertValid(duplicateTemplate(input, { manifest: { ...input.template, id: id<TemplateId>('duplicate'), name: 'Copia' }, namespace: 'new' }));
    expect(duplicate.template.id).toBe('duplicate');
    expect(duplicate.cards![0]!.id).toBe('new-idea-a');
    expect(duplicate.cards![0]!.fields).toEqual(input.cards![0]!.fields);
    expect(duplicate.cards![0]!.fields).not.toBe(input.cards![0]!.fields);
    expect(duplicate.layouts![0]!.boardId).toBe('new-overview');
    expect(validateTemplate(duplicate).ok).toBe(true);
    expect(instantiateTemplate(duplicate, options).ok).toBe(true);
  });
  it.each([null, {}, { ...options, namespace: '' }, { ...options, namespace: 'A' }, { ...options, workspaceId: null }, { ...options, name: ' ' }, { ...options, namespace: 'a'.repeat(64) }].map(value => ({ value })))('rechaza opciones inválidas ($value)', ({ value }) => {
    expect(instantiateTemplate(source(), unsafe(value)).ok).toBe(false);
  });
  it('rechaza duplicación con ID igual, manifiesto inválido y opciones nulas', () => {
    expect(duplicateTemplate(source(), { manifest: source().template, namespace: 'dup' }).ok).toBe(false);
    expect(duplicateTemplate(source(), unsafe({ manifest: null, namespace: 'dup' })).ok).toBe(false);
    expect(duplicateTemplate(source(), unsafe(null)).ok).toBe(false);
  });
  it('rechaza fuente inválida en ambas operaciones sin devolver resultados parciales', () => {
    expect(instantiateTemplate(null, options).ok).toBe(false);
    expect(duplicateTemplate(null, unsafe({})).ok).toBe(false);
  });
});

describe('intercambio de datos', () => {
  it('round-trip conserva semántica y produce texto estable', () => {
    const input = source();
    const text = assertValid(exportTemplate(input));
    const imported = assertValid(importTemplate(text));
    expect(imported).toEqual(input);
    expect(imported.cards).not.toBe(input.cards);
    expect(assertValid(exportTemplate(imported))).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
    expect(assertValid(exportTemplate(Object.fromEntries(Object.entries(input).reverse())))).toBe(text);
  });
  it('importa objetos copiándolos y conserva texto parecido a código como texto', () => {
    const input = { ...source(), readme: 'eval("alert(1)")' };
    const result = assertValid(importTemplate(input));
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
  it.each(['{', 'null', '[]', '{}', '"text"', '{"schemaVersion":99}'])('rechaza JSON inválido o no compatible (%s)', text => {
    expect(importTemplate(text).ok).toBe(false);
  });
  it('rechaza funciones y getters de opciones sin ejecutarlos', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'namespace', { enumerable: true, get() { calls += 1; return 'dup'; } });
    expect(instantiateTemplate(source(), unsafe(getter)).ok).toBe(false);
    expect(duplicateTemplate(source(), unsafe(getter)).ok).toBe(false);
    expect(exportTemplate({ ...source(), readme: () => { calls += 1; } }).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
