import { describe, expect, it } from 'vitest';
import type { RichTextDocument, RichTextImage } from '@noutynotes/domain';
import { placedNoteImage } from './noteImagePlacement';

const historical: RichTextImage = { type: 'image', assetRef: 'assets/shared.png' as RichTextImage['assetRef'], alt: 'Histórica' };
const current: RichTextImage = { ...historical, alt: '', captionPolicy: 'explicit', accessibilityIntent: 'pending' };
const before: RichTextDocument = { schemaVersion: 2, blocks: [historical, { ...historical, alt: 'Segunda' }] };
describe('el bloque editorial colocado no se identifica por AssetRef compartido', () => {
  it('devuelve la nueva referencia editorial y sus políticas, no la primera histórica', () => {
    expect(placedNoteImage(before, { ...before, blocks: [...before.blocks, current] }, { kind: 'insert', afterBlock: 1 }, historical.assetRef)).toBe(current);
    expect(placedNoteImage(before, { ...before, blocks: [current, ...before.blocks] }, { kind: 'insert', afterBlock: -1 }, historical.assetRef)).toBe(current);
  });
  it('reemplaza la aparición indicada y rechaza una posición o ref incoherente', () => {
    const after = { ...before, blocks: [historical, current] };
    expect(placedNoteImage(before, after, { kind: 'replace', blockIndex: 1 }, historical.assetRef)).toBe(current);
    expect(placedNoteImage(before, after, { kind: 'replace', blockIndex: 2 }, historical.assetRef)).toBeNull();
    expect(placedNoteImage(before, after, { kind: 'replace', blockIndex: 1 }, 'assets/otra.png')).toBeNull();
  });
});
