import { describe, expect, it } from 'vitest';

import { createExternalPreference } from './externalPreference';

describe('preferencia externa del dispositivo (ADR 0032)', () => {
  it('empieza con lo guardado o, sin ello, con el valor por defecto; set guarda y avisa a quien esté suscrito', () => {
    let saved: string | null = null;
    const store = createExternalPreference<string>('es', () => null, (next) => { saved = next; });
    expect(store.get()).toBe('es');
    let notified = 0;
    const unsubscribe = store.subscribe(() => { notified += 1; });
    store.set('en');
    expect(store.get()).toBe('en');
    expect(saved).toBe('en');
    expect(notified).toBe(1);
    unsubscribe();
    store.set('es');
    expect(notified).toBe(1);
  });

  it('con una preferencia ya guardada, empieza con ella y no vuelve a leerla en cada get', () => {
    let reads = 0;
    const store = createExternalPreference<string>('es', () => { reads += 1; return 'en'; });
    expect(store.get()).toBe('en');
    expect(store.get()).toBe('en');
    expect(reads).toBe(1);
  });

  it('sin load ni save, funciona solo en memoria', () => {
    const store = createExternalPreference<string>('es');
    expect(store.get()).toBe('es');
    store.set('en');
    expect(store.get()).toBe('en');
  });
});
