import { expect, it } from 'vitest';
import { ideaA, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { updateCardAppearance } from '../../domain/src/cards/operations';
import { archiveCard, restoreArchivedCard } from '../../domain/src/cards/archive';
import { trashCard, restoreTrashedCard } from '../../domain/src/cards/trash';
import { WORLD_GRID } from '../../domain/src/layouts/grid';
import { removedImageWorkspace } from '../../../tests/fixtures/removed-image-blocks';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it('persiste el fondo explícito sin cambiar las propiedades históricas', () => {
  const source = validWorkspace();
  const changed = value(updateCardAppearance(source, ideaA.id, { noteBackground: 'transparent' }));
  const reopened = value(parseWorkspace(value(serializeWorkspace(changed))));
  expect(reopened.cards[0]).toEqual(changed.cards[0]);
});

it.each([validWorkspace, removedImageWorkspace])('guarda versiones selectivas en Archivo/Papelera y restaura identidad, cuerpo y fondo (%#)', (fixture) => {
  const source = value(updateCardAppearance(fixture(), ideaA.id, { noteBackground: 'paper', frameOverride: 'hidden' }));
  const options = { fallbackBoardId: source.boards[0]!.id, config: WORLD_GRID };
  const archivedFiles = value(serializeWorkspace(value(archiveCard(source, ideaA.id, '2026-10-25T12:00:00.000Z'))));
  expect(archivedFiles['.nouty/archive.yaml']).toContain('schemaVersion: 8');
  const archived = value(parseWorkspace(archivedFiles));
  const restored = value(restoreArchivedCard(archived, ideaA.id, options)).workspace;
  expect(restored.cards.find((card) => card.id === ideaA.id)).toEqual(source.cards[0]);
  const trashFiles = value(serializeWorkspace(value(trashCard(restored, ideaA.id))));
  expect(trashFiles['.nouty/trash.yaml']).toContain('schemaVersion: 7');
  const trashed = value(parseWorkspace(trashFiles));
  expect(value(restoreTrashedCard(trashed, ideaA.id, options)).workspace.cards.find((card) => card.id === ideaA.id)).toEqual(source.cards[0]);
  expect(parseWorkspace({ ...archivedFiles, '.nouty/archive.yaml': archivedFiles['.nouty/archive.yaml']!.replace('schemaVersion: 8', 'schemaVersion: 7') }).ok).toBe(false);
  expect(parseWorkspace({ ...trashFiles, '.nouty/trash.yaml': trashFiles['.nouty/trash.yaml']!.replace('schemaVersion: 7', 'schemaVersion: 6') }).ok).toBe(false);
});

it('no cambia versiones o bytes de Notas históricas ni acepta el campo en versiones antiguas', () => {
  const legacy = value(serializeWorkspace(validWorkspace()));
  expect(value(serializeWorkspace(value(parseWorkspace(legacy))))).toEqual(legacy);
  const explicit = value(serializeWorkspace(value(updateCardAppearance(validWorkspace(), ideaA.id, { noteBackground: 'transparent' }))));
  expect(explicit['cards/idea-a.md']).toContain('schemaVersion: 17');
  expect(explicit['cards/idea-b.md']).toBe(legacy['cards/idea-b.md']);
  expect(parseWorkspace({ ...explicit, 'cards/idea-a.md': explicit['cards/idea-a.md']!.replace('schemaVersion: 17', 'schemaVersion: 16') }).ok).toBe(false);
});
