import { describe, expect, it } from 'vitest';

import { BUILT_IN_TEMPLATES } from './builtInTemplates';

describe('plantillas incorporadas (fase 11a, ADR 0033)', () => {
  it('son exactamente GDD, Storyboard e Investigación, cada una ya validada por el dominio', () => {
    expect(BUILT_IN_TEMPLATES.map((entry) => entry.id)).toEqual(['gdd', 'storyboard', 'research']);
    for (const { template } of BUILT_IN_TEMPLATES) {
      expect(template.template.name.trim()).not.toBe('');
      expect(template.readme?.trim()).not.toBe('');
      expect(template.boards.length).toBeGreaterThan(0);
    }
  });

  it('cada una declara al menos el asset de su propia vista previa', () => {
    for (const { id, template } of BUILT_IN_TEMPLATES) {
      expect(template.preview).toBe(`assets/${id}.svg`);
      expect(template.assets).toContain(`assets/${id}.svg`);
    }
  });
});
