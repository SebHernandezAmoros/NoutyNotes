import { expect, it } from 'vitest';
import { removedImageDocument, removedImageWorkspace } from '../../../tests/fixtures/removed-image-blocks';
import { parseRichTextHtml, serializeRichTextHtml } from './rich-text-html-codec';
import { parseRichTextMarkdown, serializeRichTextMarkdown } from './rich-text-codec';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { archiveCard, DESKTOP_GRID, restoreArchivedCard, restoreTrashedCard, trashCard } from '@noutynotes/domain';
import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import { checkVersionedData, readVersionedYaml } from './documents';
import { archiveFileSchema, cardFrontmatterSchema, trashFileSchema } from './schemas';
import { splitFrontmatter } from './frontmatter';
import { parseYaml } from './yaml';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it('transporta el marcador por HTML seguro v3 sin generar una imagen cargable', () => {
  const html = serializeRichTextHtml(removedImageDocument);
  expect(html.ok).toBe(true);
  if (!html.ok) return;
  expect(html.value).not.toMatch(/<img|\bsrc=|\bhref=/);
  expect(parseRichTextHtml(html.value, 3)).toEqual({ ok: true, value: removedImageDocument });
});

it('rechaza imágenes activas/atributos ejecutables o referencias dentro del figure retirado', () => {
  const html = value(serializeRichTextHtml(removedImageDocument));
  for (const invalid of [html.replace('<p>Imagen retirada</p>', '<img src="assets/images/old.png" alt="Mapa">'),
    html.replace('data-nouty-resource-state="retired"', 'data-nouty-resource-state="retired" src="assets/images/old.png"'),
    html.replace('<p>Imagen retirada</p>', '<p onclick="alert(1)">Imagen retirada</p>')]) {
    expect(parseRichTextHtml(invalid, 3).ok).toBe(false);
  }
  expect(parseRichTextHtml(html, 1).ok).toBe(false);
  expect(parseRichTextHtml(html, 2).ok).toBe(false);
  expect(parseRichTextHtml(html, 5).ok).toBe(false);
});

it.each(['archive', 'trash'] as const)('snapshot %s y restauración conservan marcador, vecinos, relaciones y geometría', (kind) => {
  const source = removedImageWorkspace();
  const card = source.cards[0]!;
  const snapshot = value(kind === 'archive' ? archiveCard(source, card.id, '2026-10-24T00:00:00Z') : trashCard(source, card.id));
  const files = value(serializeWorkspace(snapshot));
  const path = kind === 'archive' ? '.nouty/archive.yaml' : '.nouty/trash.yaml';
  const version = kind === 'archive' ? 7 : 6;
  expect(files[path]).toContain(`schemaVersion: ${version}`);
  const reopened = value(parseWorkspace(files));
  expect(reopened).toEqual(snapshot);
  const options = { fallbackBoardId: source.boards[0]!.id, config: DESKTOP_GRID };
  const restored = value(kind === 'archive' ? restoreArchivedCard(reopened, card.id, options) : restoreTrashedCard(reopened, card.id, options)).workspace;
  expect(restored.cards.find((item) => item.id === card.id)).toEqual(card);
  expect(restored.relations).toEqual(source.relations);
  for (const layout of source.layouts) {
    for (const placement of layout.placements) expect(restored.layouts.find((item) => item.boardId === layout.boardId)?.placements.find((item) => item.cardId === placement.cardId)).toEqual(placement);
  }
  expect(parseWorkspace({ ...files, [path]: files[path]!.replace(`schemaVersion: ${version}`, `schemaVersion: ${version - 1}`) }).ok).toBe(false);
  expect(kind === 'archive'
    ? readVersionedYaml(files[path]!, path, archiveFileSchema, [1, 2, 3, 4, 5, 6]).ok
    : readVersionedYaml(files[path]!, path, trashFileSchema, [1, 2, 3, 4, 5]).ok).toBe(false);
});

it('ZIP real preserva el estado completo sin binarios y los datos históricos no se reescriben', () => {
  const source = removedImageWorkspace();
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(source)), {}));
  const reopened = value(readWorkspaceArchive(zip));
  expect(reopened.workspace).toEqual(source);
  expect(reopened.assets).toEqual({});
  const historical = validWorkspace();
  const files = value(serializeWorkspace(historical));
  expect(value(serializeWorkspace(value(parseWorkspace(files)), files))).toEqual(files);
});

it('la guardia real rechaza lectores incompatibles y etiquetas degradadas de la Card', () => {
  const files = value(serializeWorkspace(removedImageWorkspace()));
  const card = files['cards/idea-a.md']!;
  const front = value(parseYaml(value(splitFrontmatter(card, 'card')).frontmatter, 'card'));
  expect(checkVersionedData(front, 'card', cardFrontmatterSchema, Array.from({ length: 15 }, (_, index) => index + 1)).ok).toBe(false);
  expect(parseWorkspace({ ...files, 'cards/idea-a.md': card.replace('schemaVersion: 16', 'schemaVersion: 15') }).ok).toBe(false);
});

it('Markdown devuelve unsupported si otras propiedades del documento no caben sin pérdida', () => {
  const doc = { ...removedImageDocument, blocks: [{ type: 'paragraph' as const, alignment: 'center' as const, content: [{ type: 'text' as const, text: 'Centrado' }] }, ...removedImageDocument.blocks] };
  expect(serializeRichTextMarkdown(doc).ok).toBe(false);
});

it('persiste la Nota por codecs reales con versión Card selectiva y reapertura exacta', () => {
  const source = removedImageWorkspace();
  const files = serializeWorkspace(source);
  expect(files.ok).toBe(true);
  if (!files.ok) return;
  expect(files.value['cards/idea-a.md']).toContain('schemaVersion: 16');
  expect(parseWorkspace(files.value)).toEqual({ ok: true, value: source });
});

it('convierte Markdown mediante figure seguro visible y vuelve al mismo documento', () => {
  const markdown = serializeRichTextMarkdown(removedImageDocument);
  expect(markdown.ok).toBe(true);
  if (!markdown.ok) return;
  expect(markdown.value).toContain('Imagen retirada');
  expect(parseRichTextMarkdown(markdown.value)).toEqual({ ok: true, value: removedImageDocument });
});
