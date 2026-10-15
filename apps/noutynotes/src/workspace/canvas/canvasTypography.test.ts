import { describe, expect, it } from 'vitest';

import { canvasTextMetrics } from './canvasTypography';

describe('tipografía proporcional durante el zoom del lienzo', () => {
  it.each([0.5, 0.75, 0.76, 1, 1.25, 1.5, 2])('mantiene las métricas internas y deja que el lienzo las escale en zoom %s', (zoom) => {
    const metrics = canvasTextMetrics({ titleSize: 16, bodySize: 13 });

    expect(metrics.titleSize).toBe(16);
    expect(metrics.bodySize).toBe(13);
    expect(metrics.headerSize).toBe(11);
    expect(metrics.captionSize).toBe(11);
    expect(metrics.bodyLineHeight).toBe(18);
    expect(metrics.titleSize * zoom).toBeCloseTo(16 * zoom, 5);
    expect(metrics.bodySize * zoom).toBeCloseTo(13 * zoom, 5);
  });
});
