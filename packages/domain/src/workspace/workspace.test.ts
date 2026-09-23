import { describe, expect, it } from 'vitest';

import { ideaA, ideaB, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import type { BoardLayout } from '../layouts/layout';
import { validateWorkspace } from './workspace';
import type { Workspace } from './workspace';

const change = (patch: Record<string, unknown>) => unsafe<Workspace>({ ...validWorkspace(), ...patch });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('workspace', () => {
  it('acepta un workspace consistente y no modifica los datos al validar', () => {
    const workspace = deepFreeze(validWorkspace());
    const result = validateWorkspace(workspace);
    expect(problems(result)).toEqual([]);
    expect(result.ok && result.value).toBe(workspace);
  });

  it('exige nombre en la metadata', () => {
    expect(problems(validateWorkspace(change({ metadata: { name: ' ' } })))).toEqual(['invalid-value@metadata.name']);
    expect(problems(validateWorkspace(change({ id: 'Mi Workspace' })))).toEqual(['invalid-id@id']);
  });

  it('informa si una colección no es una lista', () => {
    expect(problems(validateWorkspace(change({ relations: {} })))).toEqual(['invalid-value@relations']);
  });
});

describe('estructuras mal formadas', () => {
  // Regresiones de R1 (revisión de fase 1): antes lanzaban TypeError en lugar de devolver incidencias.
  const base = validWorkspace();
  const [firstType] = base.cardTypes;
  const [firstBoard, secondBoard] = base.boards;

  it.each([
    ['campos de un tipo como objeto', { cardTypes: [{ ...firstType, fields: {} }] }, 'invalid-value@cardTypes[0].fields'],
    ['definición de campo null', { cardTypes: [{ ...firstType, fields: [null] }] }, 'invalid-field-definition@cardTypes[0].fields[0]'],
    ['cardIds de un board como objeto con layout', { boards: [{ ...firstBoard, cardIds: {} }, secondBoard] }, 'invalid-value@boards[0].cardIds'],
  ])('devuelve incidencias sin excepción: %s', (_case, patch, expected) => {
    const workspace = change(patch);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(problems(validateWorkspace(workspace))).toContain(expected);
  });

  it.each([
    ['tipo null', { cardTypes: [null] }],
    ['tipo sin campos', { cardTypes: [{ ...firstType, fields: undefined }] }],
    ['definición sin clave', { cardTypes: [{ ...firstType, fields: [{ kind: 'text' }] }] }],
    ['select con opciones de texto', { cardTypes: [{ ...firstType, fields: [{ key: 'summary', kind: 'select', options: 'Resumen' }] }] }],
    ['tarjeta null', { cards: [null, base.cards[1]] }],
    ['campos de tarjeta null', { cards: [{ ...base.cards[0], fields: null }, base.cards[1]] }],
    ['board null con layout', { boards: [null, secondBoard] }],
    ['cardIds null con layout', { boards: [{ ...firstBoard, cardIds: null }, secondBoard] }],
    ['colocaciones como objeto', { layouts: [{ boardId: 'overview', placements: {} }] }],
    ['colocación null', { layouts: [{ boardId: 'overview', placements: [null] }] }],
    ['relación null', { relations: [null] }],
    ['metadata null', { metadata: null }],
  ])('devuelve incidencias sin excepción: %s', (_case, patch) => {
    const workspace = change(patch);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(validateWorkspace(workspace).ok).toBe(false);
  });

  it('no valida campos contra un tipo inválido, pero sí informa del tipo', () => {
    const result = validateWorkspace(change({ cardTypes: [{ ...firstType, fields: {} }] }));
    expect(problems(result)).toEqual(['invalid-value@cardTypes[0].fields']);
  });
});

describe('identificadores únicos en su ámbito', () => {
  it.each([
    ['tarjetas', { cards: [ideaA, ideaB, ideaA] }, 'duplicate-id@cards[2]'],
    ['boards', { boards: [...validWorkspace().boards, { id: 'overview', title: 'Otro', cardIds: [] }] }, 'duplicate-id@boards[2]'],
    ['tipos de tarjeta', { cardTypes: [...validWorkspace().cardTypes, ...validWorkspace().cardTypes] }, 'duplicate-id@cardTypes[1]'],
    ['tipos de relación', { relationTypes: [{ id: 'references', label: 'a' }, { id: 'references', label: 'b' }] }, 'duplicate-id@relationTypes[1]'],
    ['relaciones', { relations: [...validWorkspace().relations, ...validWorkspace().relations] }, 'duplicate-id@relations[1]'],
    ['layouts por board', { layouts: [...validWorkspace().layouts, { boardId: 'overview', placements: [] }] }, 'duplicate-id@layouts[1]'],
  ])('rechaza %s repetidos', (_case, patch, expected) => {
    expect(problems(validateWorkspace(change(patch)))).toContain(expected);
  });

  it('permite el mismo texto de ID en ámbitos distintos', () => {
    const workspace = validWorkspace();
    const board = { id: 'idea-a', title: 'Mismo texto que una tarjeta', cardIds: [] };
    expect(validateWorkspace(change({ boards: [...workspace.boards, board] })).ok).toBe(true);
  });
});

describe('pertenencia de tarjetas a boards', () => {
  it('una tarjeta puede aparecer en varios boards o en ninguno', () => {
    const workspace = validWorkspace();
    const boardsWithA = workspace.boards.filter((board) => board.cardIds.includes(ideaA.id));
    expect(boardsWithA).toHaveLength(2);
    const unassigned = { ...ideaB, id: 'idea-c' };
    expect(validateWorkspace(change({ cards: [...workspace.cards, unassigned] })).ok).toBe(true);
  });

  it('retirar una tarjeta de un board no la elimina ni cambia sus relaciones', () => {
    const workspace = validWorkspace();
    const withoutA = {
      ...workspace,
      boards: workspace.boards.map((board) => ({ ...board, cardIds: board.cardIds.filter((cardId) => cardId !== ideaA.id) })),
      layouts: workspace.layouts.map((layout) => ({ ...layout, placements: layout.placements.filter((p) => p.cardId !== ideaA.id) })),
    };
    expect(validateWorkspace(withoutA).ok).toBe(true);
    expect(withoutA.cards).toContain(ideaA);
    expect(withoutA.relations).toEqual(workspace.relations);
  });

  it('rechaza un board que referencia una tarjeta inexistente', () => {
    const boards = [{ id: 'overview', title: 'Resumen', cardIds: ['idea-a', 'ghost'] }];
    expect(problems(validateWorkspace(change({ boards, layouts: [] })))).toEqual(['missing-reference@boards[0].cardIds[1]']);
  });

  it('rechaza colocar en un layout una tarjeta que no pertenece a su board', () => {
    const layouts = [{ boardId: 'research', placements: [{ cardId: 'idea-b', rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded' }] }];
    expect(problems(validateWorkspace(change({ layouts })))).toEqual(['invalid-membership@layouts[0].placements[0].cardId']);
  });
});

describe('referencias inexistentes', () => {
  it.each([
    ['tipo de tarjeta', { cards: [{ ...ideaA, typeId: 'missing' }, ideaB] }, 'missing-reference@cards[0].typeId'],
    ['board de un layout', { layouts: [{ boardId: 'missing', placements: [] }] }, 'missing-reference@layouts[0].boardId'],
    ['tarjeta de un layout', {
      layouts: [{ boardId: 'overview', placements: [{ cardId: 'ghost', rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded' }] }],
    }, 'missing-reference@layouts[0].placements[0].cardId'],
    ['origen de una relación', { relations: [{ id: 'r', typeId: 'references', from: 'ghost', to: 'idea-b' }] }, 'missing-reference@relations[0].from'],
    ['destino de una relación', { relations: [{ id: 'r', typeId: 'references', from: 'idea-a', to: 'ghost' }] }, 'missing-reference@relations[0].to'],
    ['tipo de relación', { relations: [{ id: 'r', typeId: 'depends-on', from: 'idea-a', to: 'idea-b' }] }, 'missing-reference@relations[0].typeId'],
  ])('rechaza %s inexistente', (_case, patch, expected) => {
    expect(problems(validateWorkspace(change(patch)))).toEqual([expected]);
  });

  it('valida los campos de una tarjeta contra el tipo que referencia', () => {
    const cards = [{ ...ideaA, fields: { status: 'open' } }, ideaB];
    expect(problems(validateWorkspace(change({ cards })))).toEqual(['missing-required-field@cards[0].fields.summary']);
  });

  it('las relaciones enlazan tarjetas aunque estén en boards distintos o en ninguno', () => {
    const workspace = validWorkspace();
    const loose = { ...ideaB, id: 'idea-c' };
    const relation = { id: 'a-to-c', typeId: 'references', from: 'idea-a', to: 'idea-c' };
    expect(validateWorkspace(change({ cards: [...workspace.cards, loose], relations: [...workspace.relations, relation] })).ok).toBe(true);
  });
});

describe('separación entre layout, contenido y relaciones', () => {
  it('mover, redimensionar o minimizar una tarjeta solo cambia su colocación', () => {
    const original = deepFreeze(validWorkspace());
    const [layout] = original.layouts as [BoardLayout];
    const moved: Workspace = {
      ...original,
      layouts: [{
        ...layout,
        placements: layout.placements.map((placement) =>
          placement.cardId === ideaA.id ? { ...placement, rect: { x: 8, y: 5, w: 2, h: 1 }, display: 'minimized' } : placement),
      }],
    };
    expect(validateWorkspace(moved).ok).toBe(true);
    // Identidad, contenido, campos y relaciones son exactamente los mismos objetos.
    expect(moved.cards).toBe(original.cards);
    expect(moved.relations).toBe(original.relations);
    expect(moved.boards).toBe(original.boards);
    expect(moved.cards[0]).toEqual(ideaA);
  });

  it('una tarjeta sin colocación en ningún layout conserva sus relaciones', () => {
    expect(validateWorkspace(change({ layouts: [] })).ok).toBe(true);
  });
});
