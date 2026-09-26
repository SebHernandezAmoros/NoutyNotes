import { describe, expect, it } from 'vitest';

import type { WorkspaceStorageIssue } from '@noutynotes/application';

import { describeFailure, describeImport, describeImportFailure } from './messages';

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

describe('formato de una versión más reciente (P2)', () => {
  it('explica que no reconoce el formato (quizá de una versión posterior) y que no se tocó nada, en vez del detalle técnico', () => {
    const newer: WorkspaceStorageIssue[] = [{ code: 'invalid-stored-data', path: 'id', message: 'm', details: [
      { code: 'unsupported-schema-version', path: '.nouty/layout.yaml#schemaVersion', message: 'Versión de esquema no admitida: 3. Versiones admitidas: 1, 2.' },
    ] }];
    expect(describeFailure(newer, 'folder')).toBe('Esta versión de NoutyNotes no reconoce el formato de .nouty/layout.yaml; puede venir de una versión más reciente. Actualiza la app para abrirlo; no se modificó ningún archivo.');
  });
});

describe('mensajes del fallback ZIP (fase 9)', () => {
  const importIssue = (code: string, path: string, message: string): WorkspaceStorageIssue[] =>
    [{ code: 'invalid-workspace', path: 'archivo', message: 'm', details: [{ code, path, message }] }];

  it('explica una importación fallida con el motivo y la ruta, y aclara que nada cambió', () => {
    expect(describeImportFailure(importIssue('invalid-path', '../fuera.md', 'No admite segmentos "." ni "..".')))
      .toBe('No se importó el ZIP y no cambió nada. ../fuera.md: No admite segmentos "." ni "..".');
    expect(describeImportFailure(importIssue('invalid-archive', 'archivo', 'No es un archivo ZIP o está incompleto.')))
      .toBe('No se importó el ZIP y no cambió nada. No es un archivo ZIP o está incompleto.');
    expect(describeImportFailure(importIssue('limit-exceeded', 'archivo', 'El ZIP supera 33554432 bytes.')))
      .toBe('No se importó el ZIP y no cambió nada. El ZIP supera 33554432 bytes.');
    expect(describeImportFailure([])).toBe('No se importó el ZIP y no cambió nada.');
  });

  it('informa de una importación correcta y de una copia con otro ID', () => {
    expect(describeImport({ summary: { id: 'demo', name: 'Demo' } })).toBe('ZIP importado: «Demo».');
    expect(describeImport({ summary: { id: 'demo-2', name: 'Demo' }, renamedFrom: 'demo' }))
      .toBe('Ya existía un espacio con el ID «demo»: el ZIP se importó como copia con el ID «demo-2». No se sobrescribió nada.');
  });
});
