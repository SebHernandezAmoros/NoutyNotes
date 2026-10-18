import { describe, expect, it } from 'vitest';

import { ideaA, noteType, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import { DESKTOP_GRID } from '../layouts/grid';
import { archiveCard, restoreArchivedCard } from './archive';
import { imageFits, resolveCardImageFit, supportsCardImageFit, validateCard } from './card';
import type { Card } from './card';
import type { CardTypeDefinition } from './card-type';
import { restoreTrashedCard, trashCard } from './trash';

const fallbackBoardId = validWorkspace().boards[0]!.id;
const restoreOptions = { fallbackBoardId, config: DESKTOP_GRID };

describe('ajuste durable de la imagen principal (OBS-N2-IMAGE-FIT-F1)', () => {
  it('mantiene un catalogo cerrado y rechaza valores o tipos no elegibles', () => {
    expect(imageFits).toEqual(['contain', 'cover']);
    expect(validateCard({ ...ideaA, imageFit: 'contain' }, noteType).ok).toBe(true);
    expect(validateCard({ ...ideaA, imageFit: 'cover' }, noteType).ok).toBe(true);
    expect(problems(validateCard(unsafe<Card>({ ...ideaA, imageFit: 'stretch' }), noteType)))
      .toContain('invalid-value@card.imageFit');

    const fileType: CardTypeDefinition = { ...noteType, base: 'file' };
    expect(problems(validateCard({ ...ideaA, imageFit: 'cover' }, fileType)))
      .toContain('invalid-value@card.imageFit');
  });

  it('resuelve compatibilidad historica y valores explicitos sin mutar la tarjeta', () => {
    const historicalImage: Readonly<Pick<Card, 'content' | 'contentLayout' | 'imageFit'>> = Object.freeze({});
    expect(supportsCardImageFit(historicalImage, 'image')).toBe(true);
    expect(resolveCardImageFit(historicalImage, 'image')).toBe('contain');
    expect(historicalImage).toEqual({});

    expect(resolveCardImageFit({ contentLayout: 'banner' }, 'note')).toBe('cover');
    expect(resolveCardImageFit({ contentLayout: 'document' }, 'note')).toBe('contain');
    expect(resolveCardImageFit({ contentLayout: 'banner', imageFit: 'contain' }, 'note')).toBe('contain');
    expect(resolveCardImageFit({ imageFit: 'cover' }, 'image')).toBe('cover');
    expect(resolveCardImageFit({ imageFit: 'cover' }, 'file')).toBe('contain');
    expect(resolveCardImageFit({ contentLayout: 'document', imageFit: 'cover' }, 'note')).toBe('contain');
  });

  it('conserva el ajuste al archivar, restaurar, enviar a Papelera y restaurar', () => {
    const source = validWorkspace();
    const fitted = {
      ...source,
      cards: source.cards.map((card, index) => index === 0
        ? { ...card, contentLayout: 'banner' as const, imageFit: 'contain' as const }
        : card),
    };
    const cardId = fitted.cards[0]!.id;
    const archived = assertValid(archiveCard(fitted, cardId, '2026-10-17T12:00:00.000Z'));
    expect(archived.archive?.[0]?.card.imageFit).toBe('contain');

    const restoredArchive = assertValid(restoreArchivedCard(archived, cardId, restoreOptions)).workspace;
    expect(restoredArchive.cards.find((card) => card.id === cardId)).toMatchObject({
      imageFit: 'contain', contentLayout: 'banner', assetRefs: ideaA.assetRefs,
    });
    expect(restoredArchive.relations).toEqual(source.relations);

    const trashed = assertValid(trashCard(restoredArchive, cardId));
    expect(trashed.trash?.[0]?.card.imageFit).toBe('contain');
    const restoredTrash = assertValid(restoreTrashedCard(trashed, cardId, restoreOptions)).workspace;
    expect(restoredTrash.cards.find((card) => card.id === cardId)?.imageFit).toBe('contain');
  });
});
