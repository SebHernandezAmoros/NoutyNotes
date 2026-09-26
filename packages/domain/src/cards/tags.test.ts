import { describe, expect, it } from 'vitest';

import type { CardTypeDefinition } from './card-type';
import { validateCard } from './card';
import type { Card } from './card';
import { normalizeTag, withTag, withoutTag } from './tags';

const nota: CardTypeDefinition = { id: 'nota' as CardTypeDefinition['id'], label: 'Nota', base: 'note', fields: [] };
const card = (tags: unknown): Card => ({ id: 'a' as Card['id'], typeId: nota.id, fields: {}, tags } as unknown as Card);
const problems = (result: { ok: boolean; issues?: readonly { code: string; path: string }[] }) => (result.issues ?? []).map((item) => `${item.code}@${item.path}`);

describe('etiquetas # de una tarjeta (ADR 0019)', () => {
  it('normaliza lo que escribe la persona: sin #, sin espacios alrededor, en minúsculas y NFC', () => {
    expect(normalizeTag('  #Idea ')).toEqual({ ok: true, value: 'idea' });
    expect(normalizeTag('Viaje/Japón')).toEqual({ ok: true, value: 'viaje/japón' });
    // «é» compuesta y descompuesta son la misma etiqueta.
    expect(normalizeTag('café')).toEqual(normalizeTag('café'));
  });

  it('rechaza nombres vacíos, con espacios o signos, con / en los extremos o de más de 40 caracteres', () => {
    for (const bad of ['', '#', 'dos palabras', 'a,b', '/raíz', 'fin/', 'x'.repeat(41)]) {
      expect(normalizeTag(bad).ok, bad).toBe(false);
    }
  });

  it('añadir y quitar mantienen la lista sin duplicados y ordenada', () => {
    expect(withTag(['zeta', 'alfa'], 'beta')).toEqual(['alfa', 'beta', 'zeta']);
    expect(withTag(['alfa'], 'alfa')).toEqual(['alfa']);
    expect(withoutTag(['alfa', 'beta'], 'alfa')).toEqual(['beta']);
  });

  it('una tarjeta solo admite etiquetas normalizadas, únicas y ordenadas', () => {
    expect(validateCard(card(['alfa', 'beta']), nota).ok).toBe(true);
    expect(problems(validateCard(card(['Idea']), nota))).toEqual(['invalid-value@card.tags[0]']);
    expect(problems(validateCard(card(['beta', 'alfa']), nota))).toEqual(['invalid-value@card.tags']);
    expect(problems(validateCard(card(['alfa', 'alfa']), nota))).toEqual(['invalid-value@card.tags']);
    expect(problems(validateCard(card('alfa'), nota))).toEqual(['invalid-value@card.tags']);
  });
});
