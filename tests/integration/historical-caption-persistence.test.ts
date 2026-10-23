import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { duplicateSelection } from '../../packages/application/src/index';
import { ArchiveStorage, markdownRichTextCodec, readWorkspaceArchive } from '../../packages/storage/src/index';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error('Se esperaba resultado válido');
  return result.value;
}
it('FIX12 lectura, guardado, copia y reapertura conservan cuerpo Markdown exacto, caption y Asset compartido', async () => {
  const bytes = readFileSync('tests/smoke/fixtures/historical-caption-marker.zip');
  const source = value(readWorkspaceArchive(bytes));
  const storage = new ArchiveStorage();
  const { summary } = value(await storage.importArchive(bytes));
  const original = value(await storage.open(summary.id));
  const content = original.cards[0]!.content!;
  expect(markdownRichTextCodec.projectLegacyNotePreview?.(content)).not.toContain('nouty-caption:v1');
  value(await storage.save(original));
  value(await duplicateSelection(storage, summary.id, original.boards[0]!.id, [original.cards[0]!.id]));
  const exported = value(storage.exportArchive(summary.id));
  const reopened = new ArchiveStorage();
  value(await reopened.importArchive(exported.bytes));
  const workspace = value(await reopened.open(summary.id));
  expect(workspace.cards).toHaveLength(2);
  for (const card of workspace.cards) {
    expect(card.content).toBe(content);
    expect(card.contentDocument).toBeUndefined();
    expect(value(markdownRichTextCodec.parse(card.content!))).toEqual(value(markdownRichTextCodec.parse(content)));
  }
  const result = value(readWorkspaceArchive(exported.bytes));
  for (const [path, text] of Object.entries(source.files)) {
    if (text.includes('nouty-caption:v1')) expect(result.files[path]).toBe(text);
  }
  expect(Object.keys(result.assets)).toEqual(Object.keys(source.assets));
  for (const path of Object.keys(source.assets)) expect(result.assets[path]).toEqual(source.assets[path]);
});
