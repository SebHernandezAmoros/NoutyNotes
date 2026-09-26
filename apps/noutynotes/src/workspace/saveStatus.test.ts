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

describe('qué cuenta como error al guardar', () => {
  it('solo un fallo de la carpeta; una edición rechazada no escribió nada y no es un error de guardado', () => {
    const issue = (code: Parameters<typeof isSaveFailure>[0][number]['code']) => [{ code, path: 'x', message: '' }];
    for (const code of ['io-failure', 'permission-denied', 'external-change', 'invalid-stored-data', 'workspace-not-found'] as const) expect(isSaveFailure(issue(code)), code).toBe(true);
    for (const code of ['invalid-workspace', 'invalid-asset', 'asset-conflict'] as const) expect(isSaveFailure(issue(code)), code).toBe(false);
  });
});
