import { describe, expect, it } from 'vitest';

import type { WorkspaceStorageIssue } from '@noutynotes/application';

import { describeFailure } from './messages';

const transform = (code: string, path = 'x'): WorkspaceStorageIssue[] =>
  [{ code: 'invalid-workspace', path: 'transform', message: 'm', details: [{ code, path, message: 'original' }] }];

describe('mensajes visibles de error (fase 7)', () => {
  it.each([
    ['out-of-bounds', 'La tarjeta saldría de los límites de la grilla.'],
    ['grid-collision', 'Ahí se solaparía con otra tarjeta.'],
    ['no-free-space', 'No queda espacio libre en el tablero.'],
    ['invalid-layout', 'Posición o tamaño no válidos: el mínimo es 1 × 1 dentro de la grilla.'],
    ['duplicate-relation', 'Estas tarjetas ya están conectadas en ese sentido.'],
    ['self-relation', 'Una tarjeta no puede conectarse consigo misma.'],
    ['missing-reference', 'Ese elemento ya no existe en este espacio.'],
  ])('traduce %s del motor', (code, text) => {
    expect(describeFailure(transform(code))).toBe(text);
  });

  it('informa con honestidad de un espacio que no existe en la sesión', () => {
    expect(describeFailure([{ code: 'workspace-not-found', path: 'id', message: 'm' }]))
      .toBe('Este espacio no existe en esta sesión. Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.');
    expect(describeFailure([{ code: 'invalid-workspace-id', path: 'id', message: 'm' }]))
      .toBe('Este espacio no existe en esta sesión. Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.');
  });

  it('pide un nombre cuando falta y conserva el mensaje original si no hay traducción', () => {
    expect(describeFailure(transform('invalid-value', 'metadata.name'))).toBe('Escribe un nombre para el espacio.');
    expect(describeFailure(transform('unknown-property', 'changes.x'))).toBe('original');
    expect(describeFailure([{ code: 'invalid-stored-data', path: 'id', message: 'sin detalle' }])).toContain('recuperación pendiente');
    expect(describeFailure([])).toBe('No se pudo completar la acción.');
  });
});
