import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../__fixtures__/grid';
import { id, ideaA, ideaB, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import type { CardId, RelationId, RelationTypeId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import { createRelation, deleteRelation, getIncomingRelations, getOutgoingRelations, getRelatedCards } from './operations';
import { validateRelation } from './relation';
import type { Relation } from './relation';

const original = validWorkspace().relations[0] as Relation;
const reverse: Relation = { ...original, id: id<RelationId>('reverse'), from: ideaB.id, to: ideaA.id };
const missing = id<CardId>('missing');

describe('políticas de relaciones', () => {
  it('rechaza autoenlaces en entidad y workspace', () => {
    const self = { ...original, to: original.from };
    expect(problems(validateRelation(self))).toContain('self-relation@relation.to');
    expect(problems(validateWorkspace({ ...validWorkspace(), relations: [self] }))).toContain('self-relation@relations[0].to');
  });
  it('rechaza duplicados semánticos incluso con otra etiqueta e ID', () => {
    const duplicate = { ...original, id: id<RelationId>('duplicate'), label: 'Otra etiqueta' };
    expect(problems(validateWorkspace({ ...validWorkspace(), relations: [original, duplicate] }))).toContain('duplicate-relation@relations[1]');
  });
  it('permite tipos distintos, sentidos opuestos y ciclos', () => {
    const workspace = validWorkspace();
    const otherType = id<RelationTypeId>('extends');
    const result = validateWorkspace({ ...workspace,
      relationTypes: [...workspace.relationTypes, { id: otherType, label: 'Amplía' }],
      relations: [original, reverse, { ...original, id: id<RelationId>('other'), typeId: otherType }],
    });
    expect(result.ok).toBe(true);
  });
  it.each([null, undefined, [], {}, { from: null, to: null }].map(input => ({ input })))('valida formas mal construidas sin lanzar ($input)', ({ input }) => {
    expect(validateRelation(unsafe(input)).ok).toBe(false);
    expect(validateWorkspace({ ...validWorkspace(), relations: unsafe([input, original]) }).ok).toBe(false);
  });
});

describe('crear y eliminar relaciones', () => {
  it('crea A→B sin necesitar board y sin mutar contenido o layout', () => {
    const base = deepFreeze({ ...validWorkspace(), boards: [], layouts: [], relations: [] });
    const result = assertValid(createRelation(base, original));
    expect(result.relations).toEqual([original]);
    expect(result.cards).toBe(base.cards);
    expect(base.relations).toEqual([]);
    expect(validateWorkspace(result).ok).toBe(true);
    expect(createRelation(base, original)).toEqual(createRelation(base, original));
  });
  it('agrega al final y permite el sentido inverso', () => {
    expect(assertValid(createRelation(validWorkspace(), reverse)).relations).toEqual([original, reverse]);
  });
  it.each([
    ['from', missing, 'missing-reference'], ['to', missing, 'missing-reference'],
    ['typeId', 'missing-type', 'missing-reference'], ['id', original.id, 'duplicate-id'],
    ['id', '', 'invalid-id'], ['label', ' ', 'invalid-value'], ['from', ideaA.id, 'self-relation'],
  ])('rechaza %s=%s (%s)', (key, replacement, code) => {
    const result = createRelation(validWorkspace(), unsafe({ ...reverse, [key]: replacement }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(i => i.code)).toContain(code);
  });
  it('rechaza duplicado con distinto ID sin alterar la entrada', () => {
    const base = deepFreeze(validWorkspace());
    expect(problems(createRelation(base, { ...original, id: id<RelationId>('another') }))).toContain('duplicate-relation@relations[1]');
    expect(base).toEqual(validWorkspace());
  });
  it('elimina solo la relación solicitada y conserva ambas tarjetas', () => {
    const base = deepFreeze({ ...validWorkspace(), relations: [original, reverse] });
    const result = assertValid(deleteRelation(base, original.id));
    expect(result.relations).toEqual([reverse]);
    expect(result.cards).toBe(base.cards);
    expect(result.boards).toBe(base.boards);
    expect(result.layouts).toBe(base.layouts);
    expect(base.relations).toEqual([original, reverse]);
    expect(validateWorkspace(result).ok).toBe(true);
    expect(problems(deleteRelation(result, original.id))).toEqual(['missing-reference@relationId']);
  });
  it.each([null, undefined, [], {}, 'bad'].map(input => ({ input })))('rechaza entrada raíz inválida ($input)', ({ input }) => {
    expect(createRelation(unsafe(input), original).ok).toBe(false);
    expect(deleteRelation(unsafe(input), original.id).ok).toBe(false);
    expect(createRelation(validWorkspace(), unsafe(input)).ok).toBe(false);
  });
  it('no repara un workspace inválido al intentar eliminar la relación defectuosa', () => {
    const bad = { ...validWorkspace(), relations: [{ ...original, to: missing }] };
    expect(deleteRelation(bad, original.id).ok).toBe(false);
    expect(createRelation(bad, reverse).ok).toBe(false);
  });
  it.each([null, '', 'BAD', 7])('rechaza ID de eliminación inválido (%j)', input => {
    expect(problems(deleteRelation(validWorkspace(), unsafe(input)))).toEqual(['invalid-id@relationId']);
  });
});

describe('consultas semánticas', () => {
  const cardC = { ...ideaB, id: id<CardId>('idea-c') };
  const bc = { ...original, id: id<RelationId>('bc'), from: ideaB.id, to: cardC.id };
  const base = deepFreeze({ ...validWorkspace(), cards: [cardC, ideaA, ideaB], relations: [bc, reverse, original] });
  it('distingue entrantes y salientes y mantiene su orden', () => {
    expect(assertValid(getIncomingRelations(base, ideaB.id))).toEqual([original]);
    expect(assertValid(getOutgoingRelations(base, ideaB.id))).toEqual([bc, reverse]);
  });
  it('consulta vecinos sin repetición y en orden de tarjetas', () => {
    expect(assertValid(getRelatedCards(base, ideaB.id))).toEqual([cardC, ideaA]);
    expect(getRelatedCards(base, ideaB.id)).toEqual(getRelatedCards(base, ideaB.id));
  });
  it.each([getIncomingRelations, getOutgoingRelations, getRelatedCards])('%s distingue aislada, inexistente e inválida', query => {
    const isolated = { ...validWorkspace(), cards: [...validWorkspace().cards, cardC] };
    expect(query(isolated, cardC.id)).toEqual({ ok: true, value: [] });
    expect(problems(query(base, missing))).toEqual(['missing-reference@cardId']);
    expect(problems(query(base, unsafe(null)))).toEqual(['invalid-id@cardId']);
    expect(query(unsafe(null), ideaA.id).ok).toBe(false);
    expect(query({ ...base, relations: [{ ...original, to: missing }] }, ideaA.id).ok).toBe(false);
  });
});
