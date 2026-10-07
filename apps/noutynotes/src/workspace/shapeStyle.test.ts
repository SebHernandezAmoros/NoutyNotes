import { describe, expect, it } from 'vitest';

import { shapeFillColor, shapeStrokeColor, shapeStrokePixels } from './shapeStyle';

describe('shapeStyle (UX7 P14)', () => {
  it('adapta la paleta al tema y conserva transparencia y grosores semánticos', () => {
    expect(shapeFillColor('orange', '#fffdf5')).toBe('#f2c792');
    expect(shapeFillColor('orange', '#20261f')).toBe('#704b27');
    expect(shapeFillColor('transparent', '#20261f')).toBe('transparent');
    expect(shapeStrokeColor('blue', '#334433', '#fffdf5')).toBe('#2457a6');
    expect(shapeStrokeColor('blue', '#aabbcc', '#20261f')).toBe('#86b7ff');
    expect(shapeStrokeColor('default', '#334433', '#20261f')).toBe('#334433');
    expect([shapeStrokePixels('thin'), shapeStrokePixels('medium'), shapeStrokePixels('thick')]).toEqual([2, 4, 6]);
  });
});
