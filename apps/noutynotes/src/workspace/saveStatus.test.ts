import { describe, expect, it } from 'vitest';

import { isSaveFailure, saveStatus } from './saveStatus';

describe('estado de guardado visible en la cabecera (P4)', () => {
  it('en carpeta distingue guardado, guardando y error, y el error nunca usa el tono de «guardado»', () => {
    expect(saveStatus({ mode: 'folder', saving: false, failed: false, native: false })).toEqual({ text: 'CARPETA LOCAL · CAMBIOS GUARDADOS', tone: 'saved' });
    expect(saveStatus({ mode: 'folder', saving: true, failed: false, native: false })).toEqual({ text: 'GUARDANDO EN LA CARPETA…', tone: 'saving' });
    expect(saveStatus({ mode: 'folder', saving: false, failed: true, native: false })).toEqual({ text: 'ERROR AL GUARDAR · REVISA EL AVISO', tone: 'error' });
  });

  it('en memoria avisa de la pérdida, con el texto de cada plataforma', () => {
    expect(saveStatus({ mode: 'memory', saving: false, failed: false, native: false })).toEqual({ text: 'SOLO EN MEMORIA · SE PIERDE AL RECARGAR', tone: 'volatile' });
    expect(saveStatus({ mode: 'memory', saving: false, failed: false, native: true })).toEqual({ text: 'SOLO EN MEMORIA · SE PIERDE AL CERRAR', tone: 'volatile' });
  });
});

describe('UX7-SAVE: conflicto y cambios pendientes, sin tocar los estados ya existentes', () => {
  it('conflicto es un tono y texto propios, no el mismo que un error genérico de guardado', () => {
    expect(saveStatus({ mode: 'folder', saving: false, failed: false, native: false, conflict: true }))
      .toEqual({ text: 'CONFLICTO DE CAMBIOS · REVISA EL AVISO', tone: 'conflict' });
  });

  it('cambios pendientes (borrador privado activo, sin estar ya guardando) tiene su propio tono discreto', () => {
    expect(saveStatus({ mode: 'folder', saving: false, failed: false, native: false, pending: true }))
      .toEqual({ text: 'CAMBIOS PENDIENTES', tone: 'pending' });
  });

  it('prioridad visual: memoria > conflicto > guardando > error > pendiente > guardado; ninguno nuevo cambia los textos ya probados', () => {
    expect(saveStatus({ mode: 'memory', saving: true, failed: true, native: false, conflict: true, pending: true }).tone).toBe('volatile');
    expect(saveStatus({ mode: 'folder', saving: true, failed: true, native: false, conflict: true, pending: true }).tone).toBe('conflict');
    expect(saveStatus({ mode: 'folder', saving: true, failed: true, native: false, conflict: false, pending: true }).tone).toBe('saving');
    expect(saveStatus({ mode: 'folder', saving: false, failed: true, native: false, conflict: false, pending: true }).tone).toBe('error');
    expect(saveStatus({ mode: 'folder', saving: false, failed: false, native: false, conflict: false, pending: false })).toEqual({ text: 'CARPETA LOCAL · CAMBIOS GUARDADOS', tone: 'saved' });
  });
});

describe('qué cuenta como error al guardar', () => {
  it('solo un fallo de la carpeta; una edición rechazada no escribió nada y no es un error de guardado', () => {
    const issue = (code: Parameters<typeof isSaveFailure>[0][number]['code']) => [{ code, path: 'x', message: '' }];
    for (const code of ['io-failure', 'permission-denied', 'external-change', 'invalid-stored-data', 'workspace-not-found'] as const) expect(isSaveFailure(issue(code)), code).toBe(true);
    for (const code of ['invalid-workspace', 'invalid-asset', 'asset-conflict'] as const) expect(isSaveFailure(issue(code)), code).toBe(false);
  });
});
