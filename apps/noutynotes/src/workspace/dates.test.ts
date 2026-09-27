import { describe, expect, it } from 'vitest';

import { formatCreated, formatDay } from './dates';

describe('fecha visible (ADR 0029)', () => {
  it('día y hora locales con el desfase del dispositivo, sin Intl; sin fecha no se inventa nada', () => {
    // 23:30 UTC del 25 son las 01:30 del 26 en Madrid (desfase −120).
    expect(formatDay('2026-09-25T23:30:00.000Z', -120)).toBe('26 sep 2026');
    expect(formatDay('2026-09-25T23:30:00.000Z', 0)).toBe('25 sep 2026');
    expect(formatDay('2027-01-01T05:00:00.000Z', 300)).toBe('1 ene 2027');
    expect(formatCreated('2026-09-25T23:30:00.000Z', -120)).toBe('Creada el 26 sep 2026, 01:30');
    expect(formatCreated(undefined, 0)).toBe('Sin fecha de creación: es anterior a esta versión');
  });
});
