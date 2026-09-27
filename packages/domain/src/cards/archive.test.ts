import { describe, expect, it } from 'vitest';

import { DESKTOP_GRID } from '../layouts/grid';
import { id, ideaA, problems, validWorkspace } from '../__fixtures__/workspace';
import type { BoardId, CardId } from '../ids';
import type { Workspace } from '../workspace/workspace';
import { validateWorkspace } from '../workspace/workspace';
import { archiveCard, archivedToTrash, restoreArchivedCard } from './archive';

const overview = id<BoardId>('overview');
const at = '2026-09-26T10:00:00.000Z';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const sortCards = (workspace: Workspace) => ({
  ...workspace,
  cards: [...workspace.cards].sort((a, b) => a.id.localeCompare(b.id)),
  layouts: workspace.layouts.map((layout) => ({ ...layout, placements: [...layout.placements].sort((a, b) => a.cardId.localeCompare(b.cardId)) })),
});

describe('Archivo de tarjetas (ADR 0023)', () => {
  it('archivar aparta la tarjeta con su sitio, relaciones y fecha; restaurar la devuelve tal cual', () => {
    const source = validWorkspace();
    const archived = ok(archiveCard(source, ideaA.id, at));
    expect(archived.cards.map((card) => card.id)).toEqual(['idea-b']);
    expect(archived.relations).toEqual([]);
    expect(archived.archive).toHaveLength(1);
    expect(archived.archive?.[0]).toMatchObject({ card: ideaA, archivedAt: at, relations: source.relations });
    expect(archived.trash ?? []).toEqual([]);
    expect(problems(validateWorkspace(archived))).toEqual([]);

    const restored = ok(restoreArchivedCard(archived, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    const { archive: _archive, ...rest } = restored.workspace;
    expect(sortCards(rest as Workspace)).toEqual(sortCards(source));
  });

  it('eliminar desde el Archivo la envía a la Papelera (no la borra) y el ID sigue reservado', () => {
    const archived = ok(archiveCard(validWorkspace(), ideaA.id, at));
    const trashed = ok(archivedToTrash(archived, ideaA.id));
    expect(trashed.archive ?? []).toEqual([]);
    expect(trashed.trash?.map((entry) => entry.card.id)).toEqual([ideaA.id]);
    expect(problems(validateWorkspace(trashed))).toEqual([]);
    // Una tarjeta nueva no puede reutilizar el ID de una archivada.
    const clash = { ...archived, cards: [...archived.cards, { ...ideaA, title: 'Otra' }] };
    expect(problems(validateWorkspace(clash)).length).toBeGreaterThan(0);
  });

  it('errores claros: tarjeta inexistente, no archivada o fecha no válida', () => {
    const source = validWorkspace();
    expect(archiveCard(source, 'no-existe' as CardId, at).ok).toBe(false);
    expect(archiveCard(source, ideaA.id, 'ayer').ok).toBe(false);
    expect(restoreArchivedCard(source, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }).ok).toBe(false);
    expect(archivedToTrash(source, ideaA.id).ok).toBe(false);
  });
});
