import { describe, expect, it } from 'vitest';

import { CONTROL_SIZE, cardActions, chromeFor, miniIcon } from './cardChrome';

const viewport = { width: 378, height: 300 };

describe('controles de la cabecera de una tarjeta (ADR 0016)', () => {
  it('cada estado ofrece minimizar, contraer o expandir y Papelera; nunca eliminar definitivamente', () => {
    expect(cardActions('expanded').map((action) => action.kind)).toEqual(['minimized', 'collapsed', 'trash']);
    expect(cardActions('collapsed').map((action) => action.kind)).toEqual(['minimized', 'expanded', 'trash']);
    expect(cardActions('minimized').map((action) => action.kind)).toEqual(['expanded', 'trash']);
  });

  it('en una cabecera ancha van alineados a la derecha, dentro de la tarjeta y a 44 px reales con cualquier zoom', () => {
    const screen = { left: 20, top: 30, width: 220, height: 160 };
    expect(chromeFor('expanded', screen, false, viewport)).toEqual({ kind: 'header', left: 20 + 220 - 3 * CONTROL_SIZE - 2, top: 32, count: 3 });
    expect(CONTROL_SIZE).toBe(44);
  });

  it('deja siempre al menos 44 px de cabecera libres para arrastrar; si no, usa el menú', () => {
    expect(chromeFor('expanded', { left: 0, top: 0, width: 170, height: 150 }, false, viewport)?.kind).toBe('menu');
    expect(chromeFor('expanded', { left: 0, top: 0, width: 180, height: 150 }, false, viewport)?.kind).toBe('header');
  });

  it('una cabecera estrecha usa un único botón de menú', () => {
    expect(chromeFor('collapsed', { left: 10, top: 10, width: 104, height: 48 }, false, viewport)).toEqual({ kind: 'menu', left: 10 + 104 - CONTROL_SIZE - 2, top: 12, count: 1 });
  });

  it('una ficha minimizada no tapa su cara: sin controles salvo seleccionada, y entonces una tira al lado', () => {
    const tile = { left: 20, top: 40, width: 48, height: 48 };
    expect(chromeFor('minimized', tile, false, viewport)).toBeNull();
    expect(chromeFor('minimized', tile, true, viewport)).toEqual({ kind: 'strip', left: 20 + 48 + 4, top: 40, count: 2 });
    // Sin sitio a la derecha, va a la izquierda.
    expect(chromeFor('minimized', { ...tile, left: 330 }, true, viewport)).toEqual({ kind: 'strip', left: 330 - 4 - 2 * CONTROL_SIZE, top: 40, count: 2 });
  });
});

describe('controles que no caben dentro de la tarjeta', () => {
  it('una barra contraída más baja que un control (zoom alejado) no los saca fuera: tira al lado y solo seleccionada', () => {
    const bar = { left: 20, top: 40, width: 190, height: 28 };
    expect(chromeFor('collapsed', bar, false, viewport)).toBeNull();
    expect(chromeFor('collapsed', bar, true, viewport)).toEqual({ kind: 'strip', left: 20 + 190 + 4, top: 40, count: 3 });
  });
});

describe('cara de una ficha minimizada', () => {
  it('nota e imagen tienen icono propio; los demás tipos muestran solo el título', () => {
    expect(miniIcon('note')).toBe('note');
    expect(miniIcon('image')).toBe('image');
    expect(miniIcon('link')).toBeNull();
    expect(miniIcon(undefined)).toBeNull();
  });
});
