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
