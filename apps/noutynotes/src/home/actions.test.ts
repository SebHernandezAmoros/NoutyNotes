import { describe, expect, it } from 'vitest';

import { numberActions, singleFlight } from './actions';

describe('acciones del inicio (ADR 0013, decisión 10)', () => {
  it('numera solo las acciones visibles, en orden y con dos cifras', () => {
    expect(numberActions(['create', 'folder', 'reopen', 'template'])).toEqual({ create: '01', folder: '02', reopen: '03', template: '04' });
    expect(numberActions(['create', 'folder', 'zip', 'template'])).toEqual({ create: '01', folder: '02', zip: '03', template: '04' });
  });

  it('una segunda llamada mientras la primera sigue en curso no ejecuta nada', async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const create = singleFlight(() => new Promise<string>((resolve) => { calls += 1; finish = () => resolve('hecho'); }));
    const first = create();
    const second = create();
    expect(calls).toBe(1);
    expect(create.busy()).toBe(true);
    finish();
    expect(await first).toBe('hecho');
    expect(await second).toBeNull();
    expect(create.busy()).toBe(false);
    // Terminada la primera, se puede volver a crear.
    void create();
    expect(calls).toBe(2);
  });

  it('un fallo libera el bloqueo', async () => {
    const create = singleFlight(async () => { throw new Error('x'); });
    await expect(create()).rejects.toThrow('x');
    expect(create.busy()).toBe(false);
  });
});

describe('singleFlight con argumentos', () => {
  it('pasa los argumentos de la llamada que sí se ejecuta', async () => {
    const seen: string[] = [];
    const create = singleFlight(async (name: string) => { seen.push(name); return name.length; });
    const first = create('Guion');
    const ignored = create('Otro');
    expect(await first).toBe(5);
    expect(await ignored).toBeNull();
    expect(seen).toEqual(['Guion']);
  });
});
