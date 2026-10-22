import { describe, expect, it } from 'vitest';

import { DESKTOP_GRID } from '../layouts/grid';
import { asset, id, ideaA, ideaB, noteType, problems, validWorkspace } from '../__fixtures__/workspace';
import type { BoardId, CardId, CardTypeId, FieldKey, WorkspaceId } from '../ids';
import type { Workspace } from '../workspace/workspace';
import { validateWorkspace } from '../workspace/workspace';
import type { Card } from './card';
import { purgeTrashedCard, restoreTrashedCard, trashCard } from './trash';

const overview = id<BoardId>('overview');
const research = id<BoardId>('research');

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

// El orden de los arrays no es posición: la tarjeta vuelve al final de las listas de tarjetas y colocaciones.
const sortCards = (workspace: Omit<Workspace, 'trash'>) => ({
  ...workspace,
  cards: [...workspace.cards].sort((a, b) => a.id.localeCompare(b.id)),
  layouts: workspace.layouts.map((layout) => ({ ...layout, placements: [...layout.placements].sort((a, b) => a.cardId.localeCompare(b.cardId)) })),
});

describe('Papelera de tarjetas (ADR 0015)', () => {
  it('enviar a la Papelera retira la tarjeta con sus relaciones y restaurar la devuelve tal cual', () => {
    const source = validWorkspace();
    const trashed = ok(trashCard(source, ideaA.id));
    expect(trashed.cards.map((card) => card.id)).toEqual(['idea-b']);
    expect(trashed.relations).toEqual([]);
    expect(trashed.boards.map((board) => board.cardIds)).toEqual([['idea-b'], []]);
    expect(trashed.trash).toEqual([{
      card: ideaA,
      boards: [{ boardId: overview, index: 0 }, { boardId: research, index: 0 }],
      placements: [{ boardId: overview, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }],
      relations: source.relations,
    }]);
    expect(problems(validateWorkspace(trashed))).toEqual([]);

    const restored = ok(restoreTrashedCard(trashed, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    const { trash: _restoredTrash, ...restoredRest } = restored.workspace;
    expect(sortCards(restoredRest)).toEqual(sortCards(source));
    expect(restored.workspace.trash).toEqual([]);
  });

  it('un ID de la Papelera no puede coincidir con una tarjeta activa', () => {
    const trashed = ok(trashCard(validWorkspace(), ideaA.id));
    const clash: Workspace = { ...trashed, cards: [...trashed.cards, { ...ideaA, content: 'otra' }] };
    expect(problems(validateWorkspace(clash))).toContain('duplicate-id@trash[0].card.id');
  });

  it('al restaurar con el sitio ocupado se reubica; sin tablero, va al tablero indicado; omite relaciones rotas', () => {
    const trashed = ok(trashCard(ok(trashCard(validWorkspace(), ideaA.id)), ideaB.id));
    // Algo ocupa ahora el sitio de idea-a y ya no existe el tablero research.
    const occupied: Workspace = {
      ...trashed,
      cards: [{ id: id<CardId>('nueva'), typeId: ideaA.typeId, fields: { summary: 'x' } }],
      boards: [{ id: overview, title: 'Resumen', cardIds: [id<CardId>('nueva')] }],
      layouts: [{ boardId: overview, placements: [{ cardId: id<CardId>('nueva'), rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' }] }],
    };
    const restored = ok(restoreTrashedCard(occupied, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: ['overview'], addedToFallback: false, skippedRelations: 1 });
    const placement = restored.workspace.layouts[0]?.placements.find((candidate) => candidate.cardId === ideaA.id);
    expect(placement?.rect).toEqual({ x: 4, y: 0, w: 4, h: 3 });
    expect(restored.workspace.relations).toEqual([]);
    expect(problems(validateWorkspace(restored.workspace))).toEqual([]);

    // idea-b solo estaba en overview; con otro tablero visible y overview borrado, va al indicado
    // conservando sus coordenadas si están libres.
    const other = id<BoardId>('otro');
    const withoutOverview: Workspace = { ...trashed, boards: [{ id: other, title: 'Otro', cardIds: [] }], layouts: [] };
    const fallback = ok(restoreTrashedCard(withoutOverview, ideaB.id, { fallbackBoardId: other, config: DESKTOP_GRID }));
    expect(fallback.report.addedToFallback).toBe(true);
    expect(fallback.workspace.boards[0]?.cardIds).toEqual(['idea-b']);
    expect(fallback.workspace.layouts[0]?.placements[0]).toEqual({ cardId: 'idea-b', rect: { x: 4, y: 0, w: 4, h: 2 }, display: 'minimized' });
  });

  it('restaura una tarjeta que originalmente vivía fuera de los tableros sin asignarla al tablero de reserva', () => {
    const source = validWorkspace();
    const { content: _legacyContent, ...ideaWithoutLegacyContent } = ideaA;
    const diaryType = {
      id: id<CardTypeId>('diario'), label: 'Entrada del diario', base: 'note' as const,
      fields: [{ key: id<FieldKey>('fecha'), kind: 'date' as const, label: 'Fecha', required: true }],
    };
    const diary = {
      ...ideaWithoutLegacyContent,
      id: id<CardId>('diario-1'),
      typeId: diaryType.id,
      title: '16 de octubre',
      fields: { fecha: '2026-10-16' },
      contentDocument: {
        schemaVersion: 1 as const,
        blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Entrada enriquecida' }] }],
      },
      assetRefs: [asset('assets/images/a.png')],
    };
    const withDiary: Workspace = { ...source, cardTypes: [...source.cardTypes, diaryType], cards: [...source.cards, diary] };

    const trashed = ok(trashCard(withDiary, diary.id));
    expect(trashed.trash?.[0]).toMatchObject({ card: diary, boards: [], placements: [] });

    const restored = ok(restoreTrashedCard(trashed, diary.id, { fallbackBoardId: overview, config: DESKTOP_GRID }));
    expect(restored.report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    expect(restored.workspace.cards.find((card) => card.id === diary.id)).toEqual(diary);
    expect(restored.workspace.boards.every((board) => !board.cardIds.includes(diary.id))).toBe(true);
    expect(restored.workspace.layouts.every((layout) => layout.placements.every((placement) => placement.cardId !== diary.id))).toBe(true);
  });

  it('eliminar definitivamente libera solo los assets que nadie más usa', () => {
    const shared = { ...ideaB, assetRefs: [asset('assets/images/a.png')] };
    const source: Workspace = { ...validWorkspace(), cards: [ideaA, shared] };
    const trashed = ok(trashCard(source, ideaA.id));
    const kept = ok(purgeTrashedCard(trashed, ideaA.id));
    expect(kept.workspace.trash).toEqual([]);
    expect(kept.releasedAssets).toEqual([]);

    const alone = ok(trashCard(validWorkspace(), ideaA.id));
    const purged = ok(purgeTrashedCard(alone, ideaA.id));
    expect(purged.releasedAssets).toEqual(['assets/images/a.png']);
    expect(problems(purgeTrashedCard(alone, id<CardId>('no-existe')))).toEqual(['missing-reference@cardId']);
  });
});

// OBS-N2-02/26, unidad U0: `purgeTrashedCard` debe considerar en uso un asset incrustado en el
// cuerpo de otra tarjeta (Markdown heredado o documento enriquecido), no solo en `assetRefs`/campos
// de tipo asset — mismo criterio que `cardAssetRefs` ya aplicaba en aplicación (`assets-catalog.ts`).
describe('U0 — referencias incrustadas protegen la purga (OBS-N2-02/26)', () => {
  const imageType = { id: id<CardTypeId>('image'), label: 'Imagen', base: 'image' as const, fields: [] };
  const shared = asset('assets/images/compartida.png');

  const sharedImageCard: Card = {
    id: id<CardId>('shared-image'),
    typeId: imageType.id,
    assetRefs: [shared],
    fields: {},
  };

  const noteWithEmbeddedRichImage: Card = {
    id: id<CardId>('note-rich'),
    typeId: id<CardTypeId>('note'),
    contentDocument: { schemaVersion: 1, blocks: [{ type: 'image', assetRef: shared, alt: 'Compartida' }] },
    fields: { summary: 'Nota con imagen enriquecida' },
  };

  const noteWithEmbeddedMarkdownImage: Card = {
    id: id<CardId>('note-markdown'),
    typeId: id<CardTypeId>('note'),
    content: `Texto antes.\n\n![Compartida](${shared})\n\nTexto después.`,
    fields: { summary: 'Nota con imagen Markdown' },
  };

  function baseWorkspace(cards: readonly Card[]): Workspace {
    return {
      schemaVersion: 1,
      id: id<WorkspaceId>('u0'),
      metadata: { name: 'U0' },
      cardTypes: [noteType, imageType],
      relationTypes: [],
      cards,
      boards: [],
      layouts: [],
      relations: [],
    };
  }

  it('U0-01: una imagen enriquecida en una Nota activa impide liberar el asset de otra tarjeta en Papelera', () => {
    const source = baseWorkspace([noteWithEmbeddedRichImage]);
    const trashed = ok(trashCard({ ...source, cards: [...source.cards, sharedImageCard] }, sharedImageCard.id));
    const purged = ok(purgeTrashedCard(trashed, sharedImageCard.id));
    expect(purged.releasedAssets).toEqual([]);
  });

  it('U0-02: una imagen Markdown heredada en una Nota activa impide liberar el asset de otra tarjeta en Papelera', () => {
    const source = baseWorkspace([noteWithEmbeddedMarkdownImage]);
    const trashed = ok(trashCard({ ...source, cards: [...source.cards, sharedImageCard] }, sharedImageCard.id));
    const purged = ok(purgeTrashedCard(trashed, sharedImageCard.id));
    expect(purged.releasedAssets).toEqual([]);
  });

  it('U0-03: la única referencia restante en una Nota archivada impide liberar el asset', () => {
    const source = baseWorkspace([sharedImageCard]);
    const trashed = ok(trashCard(source, sharedImageCard.id));
    const archived: Workspace = {
      ...trashed,
      archive: [{ card: noteWithEmbeddedRichImage, boards: [], placements: [], relations: [], archivedAt: '2026-10-17T00:00:00Z' }],
    };
    const purged = ok(purgeTrashedCard(archived, sharedImageCard.id));
    expect(purged.releasedAssets).toEqual([]);
  });

  it('U0-04: la referencia incrustada en otra tarjeta que permanece en Papelera impide liberar el asset', () => {
    const bothInTrash: Workspace = {
      ...baseWorkspace([]),
      trash: [
        { card: sharedImageCard, boards: [], placements: [], relations: [] },
        { card: noteWithEmbeddedRichImage, boards: [], placements: [], relations: [] },
      ],
    };
    const purged = ok(purgeTrashedCard(bothInTrash, sharedImageCard.id));
    expect(purged.releasedAssets).toEqual([]);
    expect(purged.workspace.trash).toEqual([{ card: noteWithEmbeddedRichImage, boards: [], placements: [], relations: [] }]);
  });

  it('U0-05: sin ninguna otra referencia, el asset realmente huérfano sigue liberándose (no se vuelve permanente)', () => {
    const source = baseWorkspace([]);
    const trashed: Workspace = { ...source, trash: [{ card: noteWithEmbeddedRichImage, boards: [], placements: [], relations: [] }] };
    const purged = ok(purgeTrashedCard(trashed, noteWithEmbeddedRichImage.id));
    expect(purged.releasedAssets).toEqual([shared]);
  });

  it('U0-06: las referencias directas (assetRefs/campos) y compartidas entre tarjetas siguen sin regresión', () => {
    const otherImageCard: Card = { id: id<CardId>('other-image'), typeId: imageType.id, assetRefs: [shared], fields: {} };
    const noteWithAssetField: Card = {
      id: id<CardId>('note-asset-field'),
      typeId: noteType.id,
      fields: { summary: 'Nota con campo Asset', cover: shared },
    };
    const source = baseWorkspace([noteWithAssetField, otherImageCard]);
    const trashed = ok(trashCard(source, otherImageCard.id));
    const purged = ok(purgeTrashedCard(trashed, otherImageCard.id));
    expect(purged.releasedAssets).toEqual([]);
    expect(purged.workspace.cards).toContainEqual(noteWithAssetField);
  });
});
