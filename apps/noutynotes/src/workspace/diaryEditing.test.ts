import { describe, expect, it } from 'vitest';

import type { CardId, RichTextDocument } from '@noutynotes/domain';

import { persistLatestDiaryRevision } from './diaryEditing';
import type { DiaryEditing } from './diaryEditing';

const document = (text: string) => ({
  schemaVersion: 1 as const,
  blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
});
const firstText = (value: RichTextDocument) => {
  const block = value.blocks[0];
  if (block?.type !== 'paragraph') return '';
  const inline = block.content[0];
  return inline?.type === 'text' ? inline.text : '';
};

describe('persistencia editorial del Diario', () => {
  it('guarda también la revisión escrita mientras la primera persistencia estaba en curso', async () => {
    const first: DiaryEditing = {
      id: 'entrada-1' as CardId, title: 'Día', document: document('Primera revisión'),
      initialTitle: 'Día', initialDocument: document('Original'),
    };
    const second = { ...first, document: document('Revisión más reciente') };
    let latest = first;
    const saved: string[] = [];

    const ok = await persistLatestDiaryRevision(first, () => latest, async (revision) => {
      saved.push(firstText(revision.document));
      if (saved.length === 1) latest = second;
      return true;
    });

    expect(ok).toBe(true);
    expect(saved).toEqual(['Primera revisión', 'Revisión más reciente']);
  });

  it('conserva el resultado fallido para impedir cerrar o navegar', async () => {
    const revision: DiaryEditing = {
      id: 'entrada-1' as CardId, title: 'Día', document: document('Pendiente'),
      initialTitle: 'Día', initialDocument: document('Original'),
    };

    await expect(persistLatestDiaryRevision(revision, () => revision, async () => false)).resolves.toBe(false);
  });
});
