import { describe, expect, it } from 'vitest';

import { problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { validateRelation } from './relation';
import type { Relation } from './relation';

const relation = validWorkspace().relations[0] as Relation;

describe('relaciones', () => {
  it('acepta una relación dirigida entre dos tarjetas, con etiqueta opcional', () => {
    expect(validateRelation(relation).ok).toBe(true);
    expect(validateRelation({ ...relation, label: 'amplía' }).ok).toBe(true);
  });

  it('no contiene datos de posición ni de board', () => {
    expect(Object.keys(relation).sort()).toEqual(['from', 'id', 'to', 'typeId']);
  });

  it.each([
    ['origen inválido', { from: '' }, 'invalid-id@relation.from'],
    ['destino inválido', { to: 'B' }, 'invalid-id@relation.to'],
    ['tipo inválido', { typeId: 'Uses' }, 'invalid-id@relation.typeId'],
    ['etiqueta vacía', { label: ' ' }, 'invalid-value@relation.label'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(validateRelation(unsafe<Relation>({ ...relation, ...change })))).toContain(expected);
  });
});

describe('estilo de flecha (ADR 0034)', () => {
  it('es opcional, independiente de from/to; sin ella se dibuja como antes (forward)', () => {
    expect(validateRelation(relation).ok).toBe(true);
    expect((['none', 'forward', 'both'] as const).every((arrow) => validateRelation({ ...relation, arrow }).ok)).toBe(true);
    expect(problems(validateRelation(unsafe({ ...relation, arrow: 'double' })))).toContain('invalid-value@relation.arrow');
  });
});
