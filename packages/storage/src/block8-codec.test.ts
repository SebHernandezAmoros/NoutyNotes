import { expect, it } from 'vitest';
import { block8Document, block8Workspace } from '../../../tests/fixtures/block8-content';
import { parseRichTextHtml, serializeRichTextHtml } from './rich-text-html-codec';
import { serializeRichTextMarkdown } from './rich-text-codec';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { archiveCard, trashCard } from '@noutynotes/domain';

function value<T>(r: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; }
it('HTML4 conserva PDF, texto y retirada y rechaza elementos activos; Markdown deniega antes de perder contenido', () => {
  const html = value(serializeRichTextHtml(block8Document));
  expect(html).toContain('data-nouty-pdf-ref=');
  expect(html).toContain('Manual &lt;local&gt;');
  expect(value(parseRichTextHtml(html, 4))).toEqual(block8Document);
  expect(parseRichTextHtml(html, 3).ok).toBe(false);
  expect(parseRichTextHtml('<iframe src="https://example.com"></iframe>', 4).ok).toBe(false);
  expect(serializeRichTextMarkdown(block8Document).ok).toBe(false);
});
it('escribe Card18 selectiva y snapshots Archivo9/Papelera8, preservando fuente, texto y referencia', () => {
  const source = block8Workspace();
  const files = value(serializeWorkspace(source));
  expect(files['cards/idea-a.md']).toContain('schemaVersion: 18');
  expect(value(parseWorkspace(files)).cards).toEqual(source.cards);
  const archived = value(archiveCard(source, source.cards[0]!.id, '2026-10-26T12:00:00.000Z'));
  const af = value(serializeWorkspace(archived));
  expect(af['.nouty/archive.yaml']).toContain('schemaVersion: 9');
  expect(value(parseWorkspace(af)).archive).toEqual(archived.archive);
  const trashed = value(trashCard(source, source.cards[0]!.id));
  const tf = value(serializeWorkspace(trashed));
  expect(tf['.nouty/trash.yaml']).toContain('schemaVersion: 8');
  expect(value(parseWorkspace(tf)).trash).toEqual(trashed.trash);
  expect(parseWorkspace({ ...files, 'cards/idea-a.md': files['cards/idea-a.md']!.replace('schemaVersion: 18', 'schemaVersion: 17') }).ok).toBe(false);
});
