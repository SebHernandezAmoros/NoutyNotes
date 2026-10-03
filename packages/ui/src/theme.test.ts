import { describe, expect, it } from 'vitest';

import { resolveThemeMode, themeColors } from './theme';

describe('preferencia de tema', () => {
  it('sigue los cambios del sistema sin cambiar la preferencia', () => {
    expect(resolveThemeMode('system', 'light')).toBe('light');
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
  });

  it('respeta una elección explícita aunque el sistema sea diferente', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
  });

  it('tiene un resultado predecible si el sistema no informa un tema', () => {
    expect(resolveThemeMode('system', null)).toBe('light');
    expect(resolveThemeMode('system', undefined)).toBe('light');
    expect(resolveThemeMode('system', 'unspecified')).toBe('light');
  });
});

describe('adaptación de color al tema oscuro (UX7-D2)', () => {
  // `note`/`noteText` colorean la nota de ejemplo (inicio), el marcador de imagen y la ficha de nota en
  // Lista: un acento por tipo, igual que `headerNote`/`headerImage` en el lienzo, no un «papel» que deba
  // mantenerse igual a propósito (eso sí aplica a `cardSurface`/`cardText`, que no se comprueban aquí).
  // Antes, `note` repetía el mismo valor del tema claro sin adaptar, a diferencia de su equivalente del
  // lienzo.
  it('el acento de tipo «nota» cambia entre claro y oscuro, como ya hacen sus equivalentes del lienzo', () => {
    expect(themeColors.dark.note).not.toBe(themeColors.light.note);
    expect(themeColors.dark.headerNote).not.toBe(themeColors.light.headerNote);
    expect(themeColors.dark.headerImage).not.toBe(themeColors.light.headerImage);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

describe.each(['light', 'dark'] as const)('legibilidad del tema %s', (mode) => {
  it('mantiene contraste de texto de al menos 4.5:1 en las superficies usadas', () => {
    const colors = themeColors[mode];
    const pairs = [
      [colors.textPrimary, colors.background],
      [colors.textSecondary, colors.background],
      [colors.textPrimary, colors.surface],
      [colors.textSecondary, colors.surface],
      [colors.textPrimary, colors.surfaceRaised],
      [colors.textSecondary, colors.surfaceRaised],
      [colors.accentText, colors.accent],
      [colors.noteText, colors.note],
      // Etiquetas en el color de selección (panel de búsqueda, ADR 0019).
      [colors.selection, colors.surface],
      [colors.selection, colors.background],
    ] as const;
    for (const [foreground, background] of pairs) {
      const values = [luminance(foreground), luminance(background)];
      expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el indicador de foco contrasta al menos 3:1 con su estado sin foco y con el fondo', () => {
    // El foco cambia el borde de `surface` a `selection`; el borde limita con el fondo de la página.
    const colors = themeColors[mode];
    for (const neighbour of [colors.surface, colors.background]) {
      const values = [luminance(colors.selection), luminance(neighbour)];
      expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });
});

const ratio = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
};

describe.each(['light', 'dark'] as const)('tokens del lienzo del tema %s (ADR 0013)', (mode) => {
  it('texto de tarjetas, cabeceras por tipo y marca con contraste de al menos 4.5:1', () => {
    const colors = themeColors[mode];
    for (const [foreground, background] of [
      [colors.cardText, colors.cardSurface],
      [colors.headerText, colors.headerNote],
      [colors.headerText, colors.headerImage],
      [colors.brandText, colors.brand],
      [colors.textPrimary, colors.canvas],
      [colors.danger, colors.canvas],
    ] as const) {
      expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('selección, error, líneas de relación y marca se distinguen del lienzo al menos 3:1', () => {
    const colors = themeColors[mode];
    for (const color of [colors.selection, colors.danger, colors.relationLine, colors.brand]) {
      expect(ratio(color, colors.canvas)).toBeGreaterThanOrEqual(3);
    }
  });
});
