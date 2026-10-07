import { describe, expect, it } from 'vitest';

import { floatingTextColor } from './floatingText';

describe('paleta del texto flotante', () => {
  it('usa tonos oscuros sobre papel claro y tonos claros sobre un tema oscuro', () => {
    expect(floatingTextColor('blue', '#1e1f1a')).toBe('#2457a6');
    expect(floatingTextColor('blue', '#f5f1e6')).toBe('#86b7ff');
  });

  it('el color por defecto sigue exactamente el token del tema', () => {
    expect(floatingTextColor(undefined, '#abcdef')).toBe('#abcdef');
    expect(floatingTextColor('default', '#123456')).toBe('#123456');
  });
});
