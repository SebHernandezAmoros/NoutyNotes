import { describe, expect, it } from 'vitest';

import { ID_MAX_LENGTH, isValidId } from '@noutynotes/domain';

import { nextSequentialId, workspaceIdFromName } from './ids';

describe('IDs deterministas fuera del dominio (fase 7)', () => {
  it('nextSequentialId usa el menor número libre con el prefijo indicado', () => {
    expect(nextSequentialId('tarjeta', [])).toBe('tarjeta-1');
    expect(nextSequentialId('tarjeta', ['tarjeta-1', 'tarjeta-3', 'otra-2'])).toBe('tarjeta-2');
    expect(nextSequentialId('relacion', ['relacion-1', 'relacion-2'])).toBe('relacion-3');
  });

  it.each([
    ['Mis Ideas', 'mis-ideas'],
    ['  Ñandú & café  ', 'nandu-cafe'],
    ['Guion_v2 — final', 'guion-v2-final'],
    ['2026', '2026'],
    ['   ', 'espacio'],
    ['¡¡!!', 'espacio'],
    ['漢字', 'espacio'],
  ])('workspaceIdFromName(%j) → %s', (name, expected) => {
    expect(workspaceIdFromName(name, [])).toBe(expected);
  });

  it('evita IDs ocupados con un sufijo numérico', () => {
    expect(workspaceIdFromName('Mis ideas', ['mis-ideas'])).toBe('mis-ideas-2');
    expect(workspaceIdFromName('Mis ideas', ['mis-ideas', 'mis-ideas-2'])).toBe('mis-ideas-3');
    expect(workspaceIdFromName('', ['espacio'])).toBe('espacio-2');
  });

  it('siempre devuelve un ID válido, también con nombres largos, sufijos o valores no textuales', () => {
    const long = 'Una idea muy larga '.repeat(10);
    const first = workspaceIdFromName(long, []);
    expect(first.length).toBeLessThanOrEqual(ID_MAX_LENGTH);
    const second = workspaceIdFromName(long, [first]);
    expect(second).not.toBe(first);
    for (const value of [first, second, workspaceIdFromName('a-'.repeat(40), []), workspaceIdFromName(null as unknown as string, [])]) {
      expect(isValidId(value)).toBe(true);
    }
  });
});
