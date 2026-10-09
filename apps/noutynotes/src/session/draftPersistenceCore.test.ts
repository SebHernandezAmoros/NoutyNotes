import { describe, expect, it } from 'vitest';

import { JournalDraftPersistence } from './draftPersistenceCore';

class Slots {
  readonly values: [string | null, string | null] = [null, null];
  fail = false;
  truncateSilently = false;
  read(slot: 0 | 1) { return Promise.resolve(this.values[slot]); }
  write(slot: 0 | 1, value: string) {
    if (this.fail) {
      this.values[slot] = value.slice(0, Math.max(1, Math.floor(value.length / 2)));
      return Promise.reject(new Error('interrupted'));
    }
    if (this.truncateSilently) {
      this.values[slot] = value.slice(0, Math.max(1, Math.floor(value.length / 2)));
      return Promise.resolve();
    }
    this.values[slot] = value;
    return Promise.resolve();
  }
}

describe('JournalDraftPersistence', () => {
  it('reabre la última ranura completa y sobrevive a una escritura interrumpida', async () => {
    const slots = new Slots();
    const first = new JournalDraftPersistence(slots);
    await first.write('{"draft":"A"}');
    expect(await new JournalDraftPersistence(slots).read()).toBe('{"draft":"A"}');
    slots.fail = true;
    await expect(first.write('{"draft":"B"}')).rejects.toThrow('interrupted');
    expect(await new JournalDraftPersistence(slots).read()).toBe('{"draft":"A"}');
  });

  it('ignora una ranura corrupta y conserva la otra', async () => {
    const slots = new Slots();
    const journal = new JournalDraftPersistence(slots);
    await journal.write('A');
    await journal.write('B');
    slots.values[1] = '{corrupt';
    expect(await new JournalDraftPersistence(slots).read()).toBe('A');
  });

  it('informa corrupción si existen ranuras pero ninguna es recuperable', async () => {
    const slots = new Slots();
    slots.values[0] = '{corrupt';
    slots.values[1] = '{also-corrupt';
    await expect(new JournalDraftPersistence(slots).read()).rejects.toThrow('corrupt');
  });

  it('solo confirma la escritura cuando la ranura se puede releer completa', async () => {
    const slots = new Slots();
    const journal = new JournalDraftPersistence(slots);
    await journal.write('A');
    slots.truncateSilently = true;
    await expect(journal.write('B')).rejects.toThrow('verification failed');
    expect(await new JournalDraftPersistence(slots).read()).toBe('A');
  });

  it('mantiene tamaño constante y recupera la última de muchas escrituras', async () => {
    const slots = new Slots();
    const journal = new JournalDraftPersistence(slots);
    for (let index = 0; index < 20; index += 1) await journal.write(`draft-${index}`);
    expect(slots.values).toHaveLength(2);
    expect(await new JournalDraftPersistence(slots).read()).toBe('draft-19');
  });
});
