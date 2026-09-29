import { describe, expect, it } from 'vitest';

import { composeSaved, composeSavedWithNotes, resolveAction, savedSuffix } from './actionFeedback';

describe('aviso de una acción de edición (ADR 0044)', () => {
  it('el sufijo de modo y el aviso simple salen de una clave, no de una frase fija', () => {
    expect(savedSuffix('memory', 'es')).toBe('Guardado en memoria.');
    expect(savedSuffix('folder', 'es')).toBe('Guardado en la carpeta.');
    expect(savedSuffix('memory', 'en')).toBe('Saved in memory.');
    expect(composeSaved('Tarjeta movida', 'memory', 'es')).toBe('Tarjeta movida. Guardado en memoria.');
    expect(composeSaved('Tarjeta movida', 'folder', 'es')).toBe('Tarjeta movida. Guardado en la carpeta.');
  });

  it('una acción sin parámetros resuelve la misma etiqueta para el aviso y para deshacer/rehacer', () => {
    expect(resolveAction('action.cardMoved', 'memory', 'es')).toEqual({ label: 'Tarjeta movida', text: 'Tarjeta movida. Guardado en memoria.' });
    expect(resolveAction('action.cardMoved', 'memory', 'en')).toEqual({ label: 'Card moved', text: 'Card moved. Saved in memory.' });
  });

  it('una acción con parámetros interpola antes de componer, en cualquier idioma', () => {
    expect(resolveAction({ key: 'action.tagRemoved', params: { tag: 'idea' } }, 'folder', 'es'))
      .toEqual({ label: 'Etiqueta «#idea» quitada', text: 'Etiqueta «#idea» quitada. Guardado en la carpeta.' });
  });

  it('las notas ya formadas se insertan entre la etiqueta y el sufijo de modo, sin duplicar puntos', () => {
    expect(composeSavedWithNotes('Tarjeta restaurada', [], 'memory', 'es')).toBe('Tarjeta restaurada. Guardado en memoria.');
    expect(composeSavedWithNotes('Tarjeta restaurada', ['Su sitio estaba ocupado.'], 'memory', 'es'))
      .toBe('Tarjeta restaurada. Su sitio estaba ocupado. Guardado en memoria.');
  });
});
