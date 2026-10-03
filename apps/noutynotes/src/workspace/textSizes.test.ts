import { describe, expect, it } from 'vitest';

import { bodyFontSize, bodyLineHeight, titleFontSize, titleLineHeight } from './textSizes';

describe('tamaños semánticos de título y cuerpo (ADR 0050)', () => {
  it('ausente es "medium", el tamaño de hoy; "small"/"large" se separan en ambas direcciones', () => {
    expect(titleFontSize(undefined)).toBe(titleFontSize('medium'));
    expect(bodyFontSize(undefined)).toBe(bodyFontSize('medium'));
    expect(titleFontSize('small')).toBeLessThan(titleFontSize('medium'));
    expect(titleFontSize('large')).toBeGreaterThan(titleFontSize('medium'));
    expect(bodyFontSize('small')).toBeLessThan(bodyFontSize('medium'));
    expect(bodyFontSize('large')).toBeGreaterThan(bodyFontSize('medium'));
  });

  it('la altura de línea es proporcional al tamaño, no un valor fijo', () => {
    expect(titleLineHeight(titleFontSize('medium'))).toBe(20);
    expect(bodyLineHeight(bodyFontSize('medium'))).toBe(18);
    expect(titleLineHeight(titleFontSize('large'))).toBeGreaterThan(titleLineHeight(titleFontSize('medium')));
    expect(bodyLineHeight(bodyFontSize('small'))).toBeLessThan(bodyLineHeight(bodyFontSize('medium')));
  });
});
