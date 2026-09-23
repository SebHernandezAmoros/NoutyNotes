import { describe, expect, it } from 'vitest';

import { resolveLayoutMode, wideLayoutMinWidth } from './layout';

describe('distribución responsive', () => {
  it('usa dos columnas desde el límite y una por debajo', () => {
    expect(resolveLayoutMode(wideLayoutMinWidth - 1)).toBe('compact');
    expect(resolveLayoutMode(wideLayoutMinWidth)).toBe('wide');
    expect(resolveLayoutMode(1366)).toBe('wide');
    expect(resolveLayoutMode(390)).toBe('compact');
  });

  it('usa la distribución compacta mientras el ancho es desconocido', () => {
    expect(resolveLayoutMode(null)).toBe('compact');
    expect(resolveLayoutMode(0)).toBe('compact');
  });
});
