import { describe, expect, it } from 'vitest';

// El resolvedor de ESLint con extensiones de plataforma cree que ambos son el mismo archivo.
// eslint-disable-next-line import/no-duplicates
import { MEMORY_LOSS_NOTICE as android } from './memoryNotice.android';
// eslint-disable-next-line import/no-duplicates
import { MEMORY_LOSS_NOTICE as web } from './memoryNotice';

describe('aviso de memoria por plataforma (ADR 0013, decisión 10)', () => {
  it('en web habla de recargar o cerrar la pestaña', () => {
    expect(web).toBe('Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.');
  });

  it('en Android habla de cerrar la app, nunca de una pestaña', () => {
    expect(android).toBe('Los espacios del prototipo viven en memoria y se pierden al cerrar la app.');
    expect(android).not.toMatch(/pestaña/);
  });
});
