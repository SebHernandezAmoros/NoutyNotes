import { describe, expect, it } from 'vitest';

import { problems } from './__fixtures__/workspace';
import { DomainError, assertValid } from './errors';
import { ID_MAX_LENGTH, isValidId, parseId } from './ids';
import type { CardId } from './ids';

describe('identificadores', () => {
  it.each(['a', 'idea-a', 'card_01', '2026-plan', 'x'.repeat(ID_MAX_LENGTH)])('acepta %s', (value) => {
    expect(isValidId(value)).toBe(true);
  });

  it.each([
    ['vacío', ''],
    ['mayúsculas', 'Card-1'],
    ['espacios', ' card-1'],
    ['separador inicial', '-card'],
    ['separador final', 'card-'],
    ['separadores seguidos', 'card--1'],
    ['barra de ruta', 'boards/home'],
    ['acentos', 'canción'],
    ['demasiado largo', 'x'.repeat(ID_MAX_LENGTH + 1)],
    ['no texto', 42],
  ])('rechaza %s', (_case, value) => {
    expect(isValidId(value)).toBe(false);
    expect(problems(parseId(value))).toEqual(['invalid-id@id']);
  });

  it('es estable: no normaliza ni reescribe el valor recibido', () => {
    const parsed = assertValid(parseId<CardId>('idea-a'));
    expect(parsed).toBe('idea-a');
    expect(parseId('Idea-A').ok).toBe(false);
  });

  it('lanza un error tipado con las incidencias al exigir un valor válido', () => {
    expect(() => assertValid(parseId('Idea A', 'cards[0].id'))).toThrow(DomainError);
    try {
      assertValid(parseId('Idea A', 'cards[0].id'));
    } catch (error) {
      expect((error as DomainError).issues[0]).toMatchObject({ code: 'invalid-id', path: 'cards[0].id' });
    }
  });
});
