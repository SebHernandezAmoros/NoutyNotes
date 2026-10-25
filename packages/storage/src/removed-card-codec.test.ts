import { expect, it } from 'vitest';
import { archiveCard, DESKTOP_GRID, restoreArchivedCard, restoreTrashedCard, trashCard } from '@noutynotes/domain';
import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { removedCardsWorkspace } from '../../../tests/fixtures/removed-cards';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import { checkVersionedData, readVersionedYaml } from './documents';
import { archiveFileSchema, cardFrontmatterSchema, trashFileSchema } from './schemas';
import { splitFrontmatter } from './frontmatter';
import { parseYaml } from './yaml';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it('persiste la variante retirada sin perder identidad, contenido, geometría o relaciones', () => {
  const source = removedCardsWorkspace();
  const serialized = serializeWorkspace(source);
  expect(serialized.ok).toBe(true);
  if (!serialized.ok) throw new Error(JSON.stringify(serialized.issues));
  expect(serialized.value['cards/idea-a.md']).toContain('schemaVersion: 15');
  const reopened = parseWorkspace(serialized.value);
  expect(reopened).toEqual({ ok: true, value: source });
});

it.each([0, 1])('Archivo y Papelera conservan estado, snapshots, identidad y geometría al restaurar la tarjeta %s', (index) => {
  const source = removedCardsWorkspace();
  const card = source.cards[index]!;
  const options = { fallbackBoardId: source.boards[0]!.id, config: DESKTOP_GRID };
  const archived = value(archiveCard(source, card.id, '2026-10-24T00:00:00Z'));
  const archiveFiles = value(serializeWorkspace(archived));
  expect(archiveFiles['.nouty/archive.yaml']).toContain('schemaVersion: 6');
  const archiveRead = value(parseWorkspace(archiveFiles));
  expect(archiveRead.archive).toEqual(archived.archive);
  const restored = value(restoreArchivedCard(archiveRead, card.id, options)).workspace;
  expect(restored.cards.find((candidate) => candidate.id === card.id)).toEqual(card);
  expect(restored.layouts[0]?.placements.find((placement) => placement.cardId === card.id)).toEqual(source.layouts[0]?.placements.find((placement) => placement.cardId === card.id));
  expect(restored.relations).toEqual(source.relations);
  const trashed = value(trashCard(source, card.id));
  const trashFiles = value(serializeWorkspace(trashed));
  expect(trashFiles['.nouty/trash.yaml']).toContain('schemaVersion: 5');
  const trashRead = value(parseWorkspace(trashFiles));
  expect(trashRead.trash).toEqual(trashed.trash);
  const restoredTrash = value(restoreTrashedCard(trashRead, card.id, options)).workspace;
  expect(restoredTrash.cards.find((candidate) => candidate.id === card.id)).toEqual(card);
  expect(restoredTrash.relations).toEqual(source.relations);
});

it('conserva contenido HTML compatible v2 en Card15 y snapshots sin crear otro formato de Nota', () => {
  const source = removedCardsWorkspace();
  const { content: _body, ...card } = source.cards[0]!;
  const rich = { ...source, cards: [{ ...card, contentDocument: { schemaVersion: 2 as const, blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Texto enriquecido conservado', marks: ['bold' as const] }] }] } }, source.cards[1]!] };
  const files = value(serializeWorkspace(rich));
  expect(files['cards/idea-a.md']).toContain('contentVersion: 2');
  expect(value(parseWorkspace(files))).toEqual(rich);
  for (const snapshot of [value(archiveCard(rich, card.id, '2026-10-24T00:00:00Z')), value(trashCard(rich, card.id))]) {
    expect(value(parseWorkspace(value(serializeWorkspace(snapshot))))).toEqual(snapshot);
  }
});

it('ZIP conserva las representaciones sin generar bytes ni referencias a recursos', () => {
  const source = removedCardsWorkspace();
  const files = value(serializeWorkspace(source));
  const zip = value(writeWorkspaceArchive(files, {}));
  const read = value(readWorkspaceArchive(zip));
  expect(read.workspace).toEqual(source);
  expect(read.assets).toEqual({});
});

it('lectura histórica no promueve versiones ni reescribe archivos intactos', () => {
  const source = validWorkspace();
  const files = value(serializeWorkspace(source));
  const reopened = value(parseWorkspace(files));
  expect(reopened).toEqual(source);
  expect(value(serializeWorkspace(reopened, files))).toEqual(files);
  expect(Object.values(files).join('\n')).not.toContain('primaryResourceState');
});

it('la guardia real de versiones rechaza capacidades antiguas y etiquetas degradadas sin pérdida silenciosa', () => {
  const source = removedCardsWorkspace();
  const files = value(serializeWorkspace(source));
  const front = value(parseYaml(value(splitFrontmatter(files['cards/idea-a.md']!, 'cards/idea-a.md')).frontmatter, 'cards/idea-a.md'));
  const incompatible = checkVersionedData(front, 'cards/idea-a.md', cardFrontmatterSchema, Array.from({ length: 14 }, (_, index) => index + 1));
  expect(incompatible.ok).toBe(false);
  if (!incompatible.ok) expect(incompatible.issues[0]?.code).toBe('unsupported-schema-version');
  expect(parseWorkspace({ ...files, 'cards/idea-a.md': files['cards/idea-a.md']!.replace('schemaVersion: 15', 'schemaVersion: 14') }).ok).toBe(false);
  const archived = value(serializeWorkspace(value(archiveCard(source, source.cards[0]!.id, '2026-10-24T00:00:00Z'))));
  expect(readVersionedYaml(archived['.nouty/archive.yaml']!, 'archive', archiveFileSchema, [1, 2, 3, 4, 5]).ok).toBe(false);
  expect(parseWorkspace({ ...archived, '.nouty/archive.yaml': archived['.nouty/archive.yaml']!.replace('schemaVersion: 6', 'schemaVersion: 5') }).ok).toBe(false);
  const trash = value(serializeWorkspace(value(trashCard(source, source.cards[0]!.id))));
  expect(readVersionedYaml(trash['.nouty/trash.yaml']!, 'trash', trashFileSchema, [1, 2, 3, 4]).ok).toBe(false);
  expect(parseWorkspace({ ...trash, '.nouty/trash.yaml': trash['.nouty/trash.yaml']!.replace('schemaVersion: 5', 'schemaVersion: 4') }).ok).toBe(false);
});
