import { describe, expect, it } from 'vitest';

import { TRANSLATIONS, t } from './i18n';

describe('idioma de la interfaz (ADR 0032)', () => {
  it('toda clave existe en español y en inglés: nada se queda a medio traducir', () => {
    const keys = Object.keys(TRANSLATIONS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const entry = TRANSLATIONS[key as keyof typeof TRANSLATIONS];
      expect(entry.es, `falta «es» en ${key}`).toBeTruthy();
      expect(entry.en, `falta «en» en ${key}`).toBeTruthy();
    }
  });

  it('t(clave, idioma) devuelve el texto de ese idioma; sin idioma, español; una clave desconocida no rompe', () => {
    expect(t('tool.select', 'es')).toBe('Seleccionar');
    expect(t('tool.select', 'en')).toBe('Select');
    expect(t('settings.title', 'en')).toBe('Settings');
    // @ts-expect-error clave inexistente a propósito, para probar el resguardo
    expect(t('no-existe', 'en')).toBe('no-existe');
  });
});
