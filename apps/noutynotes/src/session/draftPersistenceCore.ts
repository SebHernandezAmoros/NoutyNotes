import type { DraftPersistence } from '@noutynotes/application';

export interface DraftSlotPort {
  read(slot: 0 | 1): Promise<string | null>;
  write(slot: 0 | 1, serialized: string): Promise<void>;
}

interface SlotValue { readonly sequence: number; readonly payload: string; readonly checksum: string }

function checksum(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function slotValue(serialized: string | null): SlotValue | null {
  if (serialized === null) return null;
  try {
    const parsed = JSON.parse(serialized) as Partial<SlotValue>;
    if (!Number.isSafeInteger(parsed.sequence) || (parsed.sequence ?? 0) < 1 || typeof parsed.payload !== 'string'
      || parsed.checksum !== checksum(parsed.payload)) return null;
    return { sequence: parsed.sequence as number, payload: parsed.payload, checksum: parsed.checksum };
  } catch { return null; }
}

/** Journal de dos ranuras: una escritura parcial nunca destruye la última copia válida. */
export class JournalDraftPersistence implements DraftPersistence {
  constructor(private readonly slots: DraftSlotPort) {}

  async read(): Promise<string | null> {
    const values = await Promise.all([this.slots.read(0), this.slots.read(1)] as const);
    const valid = values.map((value, slot) => ({ slot: slot as 0 | 1, value: slotValue(value) }))
      .filter((entry): entry is { slot: 0 | 1; value: SlotValue } => entry.value !== null)
      .sort((left, right) => right.value.sequence - left.value.sequence);
    if (valid.length === 0 && values.some((value) => value !== null)) {
      throw new Error('draft journal is corrupt');
    }
    return valid[0]?.value.payload ?? null;
  }

  async write(payload: string): Promise<void> {
    const values = await Promise.all([this.slots.read(0), this.slots.read(1)] as const);
    const candidates = values.map((value, slot) => ({ slot: slot as 0 | 1, value: slotValue(value) }))
      .filter((entry): entry is { slot: 0 | 1; value: SlotValue } => entry.value !== null)
      .sort((left, right) => right.value.sequence - left.value.sequence);
    const latest = candidates[0];
    const target: 0 | 1 = latest?.slot === 0 ? 1 : 0;
    const sequence = (latest?.value.sequence ?? 0) + 1;
    await this.slots.write(target, JSON.stringify({ sequence, payload, checksum: checksum(payload) }));
    const verified = slotValue(await this.slots.read(target));
    if (!verified || verified.sequence !== sequence || verified.payload !== payload) {
      throw new Error('draft journal verification failed');
    }
  }
}
