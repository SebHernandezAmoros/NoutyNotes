import { describe, expect, it } from 'vitest';

import { ideaA, ideaB, noteType, problems, unsafe } from '../__fixtures__/workspace';
import { validateCard } from './card';
import type { Card } from './card';
import { validateCardType } from './card-type';
import type { CardTypeDefinition } from './card-type';
import { isCalendarDate } from './field-values';

const withFields = (fields: Record<string, unknown>) => unsafe<Card>({ ...ideaB, fields });

describe('tarjetas', () => {
  it('acepta tarjetas válidas, con o sin título, contenido y assets', () => {
    expect(validateCard(ideaA, noteType).ok).toBe(true);
    expect(validateCard(ideaB, noteType).ok).toBe(true);
  });

  it('conserva el contenido Markdown sin interpretarlo', () => {
    const result = validateCard(ideaA, noteType);
    expect(result.ok && result.value.content).toBe('# Idea A\n\nTexto **Markdown**.');
    expect(result.ok && result.value).toBe(ideaA);
  });

  it.each([
    ['id inválido', { id: 'Idea A' }, 'invalid-id@card.id'],
    ['id de tipo inválido', { typeId: '' }, 'invalid-id@card.typeId'],
    ['título vacío', { title: '   ' }, 'invalid-value@card.title'],
    ['contenido no textual', { content: 12 }, 'invalid-value@card.content'],
    ['asset absoluto', { assetRefs: ['/tmp/a.png'] }, 'invalid-asset-ref@card.assetRefs[0]'],
    ['assets repetidos', { assetRefs: ['assets/a.png', 'assets/a.png'] }, 'invalid-asset-ref@card.assetRefs'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(validateCard(unsafe<Card>({ ...ideaB, ...change }), noteType))).toContain(expected);
  });

  it('devuelve incidencias sin excepción si el tipo recibido está mal formado', () => {
    const malformed = unsafe<CardTypeDefinition>({ ...noteType, fields: {} });
    expect(() => validateCard(ideaB, malformed)).not.toThrow();
    expect(problems(validateCard(ideaB, malformed))).toEqual(['invalid-value@cardType.fields']);
  });

  it('rechaza validar una tarjeta contra un tipo distinto del que declara', () => {
    const other: CardTypeDefinition = { ...noteType, id: unsafe('other') };
    expect(problems(validateCard(ideaB, other))).toContain('missing-reference@card.typeId');
  });
});

describe('campos compatibles con sus definiciones', () => {
  it.each([
    ['markdown', { summary: 'texto' }],
    ['select', { summary: 's', status: 'done' }],
    ['fecha bisiesta', { summary: 's', due: '2028-02-29' }],
    ['asset', { summary: 's', cover: 'assets/c.png' }],
    ['url https', { summary: 's', source: 'https://example.com/x?y=1' }],
    ['mailto', { summary: 's', source: 'mailto:hola@example.com' }],
    ['número', { summary: 's', score: -2.5 }],
    ['booleano', { summary: 's', pinned: false }],
  ])('acepta %s', (_case, fields) => {
    expect(validateCard(withFields(fields), noteType).ok).toBe(true);
  });

  it.each([
    ['campo no definido', { summary: 's', owner: 'x' }, 'unknown-field@card.fields.owner'],
    ['obligatorio ausente', { status: 'open' }, 'missing-required-field@card.fields.summary'],
    ['texto con número', { summary: 3 }, 'invalid-field-value@card.fields.summary'],
    ['opción inexistente', { summary: 's', status: 'later' }, 'invalid-field-value@card.fields.status'],
    ['fecha imposible', { summary: 's', due: '2026-02-29' }, 'invalid-field-value@card.fields.due'],
    ['fecha con hora', { summary: 's', due: '2026-01-01T10:00' }, 'invalid-field-value@card.fields.due'],
    ['asset fuera del workspace', { summary: 's', cover: '../x.png' }, 'invalid-field-value@card.fields.cover'],
    ['esquema no permitido', { summary: 's', source: 'javascript:alert(1)' }, 'invalid-field-value@card.fields.source'],
    ['número infinito', { summary: 's', score: Number.POSITIVE_INFINITY }, 'invalid-field-value@card.fields.score'],
    ['booleano como texto', { summary: 's', pinned: 'true' }, 'invalid-field-value@card.fields.pinned'],
    ['null como valor', { summary: null }, 'invalid-field-value@card.fields.summary'],
  ])('rechaza %s', (_case, fields, expected) => {
    expect(problems(validateCard(withFields(fields), noteType))).toContain(expected);
  });

  it('comprueba fechas de calendario sin depender del reloj', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('1900-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
  });
});

describe('tipos de tarjeta y definiciones de campo', () => {
  it('acepta un tipo genérico basado en una primitiva', () => {
    expect(validateCardType(noteType).ok).toBe(true);
  });

  it.each([
    ['primitiva desconocida', { base: 'character' }, 'invalid-value@cardType.base'],
    ['sin etiqueta', { label: '' }, 'invalid-value@cardType.label'],
    ['clave de campo repetida', { fields: [{ key: 'a', kind: 'text' }, { key: 'a', kind: 'number' }] }, 'duplicate-id@cardType.fields[1]'],
    ['tipo de campo desconocido', { fields: [{ key: 'a', kind: 'script' }] }, 'invalid-field-definition@cardType.fields[0].kind'],
    ['select sin opciones', { fields: [{ key: 'a', kind: 'select' }] }, 'invalid-field-definition@cardType.fields[0].options'],
    ['opciones repetidas', { fields: [{ key: 'a', kind: 'select', options: ['x', 'x'] }] }, 'invalid-field-definition@cardType.fields[0].options'],
    ['opciones fuera de select', { fields: [{ key: 'a', kind: 'text', options: ['x'] }] }, 'invalid-field-definition@cardType.fields[0].options'],
    ['required no booleano', { fields: [{ key: 'a', kind: 'text', required: 'yes' }] }, 'invalid-field-definition@cardType.fields[0].required'],
    ['clave inválida', { fields: [{ key: 'A b', kind: 'text' }] }, 'invalid-id@cardType.fields[0].key'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(validateCardType(unsafe<CardTypeDefinition>({ ...noteType, ...change })))).toContain(expected);
  });
});
