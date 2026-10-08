import { describe, expect, it } from 'vitest';

import { ideaA, problems, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { assertValid } from '../errors';
import { cardContentPresentation, cardTitleText, validateCard } from './card';
import { updateCard, updateCardAppearance } from './operations';

describe('modelo unificado de contenido (UX7 P18-C)', () => {
  it('usa un titulo enriquecido inline como unica fuente visible y accesible', () => {
    const richTitle = [
      { type: 'text' as const, text: 'Mapa ', marks: ['bold' as const] },
      { type: 'link' as const, href: 'https://example.com', content: [{ type: 'text' as const, text: 'vivo' }] },
    ];
    const edited = assertValid(updateCard(validWorkspace(), ideaA.id, { titleRichText: richTitle }));
    const card = edited.cards.find((candidate) => candidate.id === ideaA.id)!;
    expect(card.title).toBeUndefined();
    expect(card.titleRichText).toEqual(richTitle);
    expect(cardTitleText(card)).toBe('Mapa vivo');
    expect(validateCard(card, edited.cardTypes[0]!).ok).toBe(true);
  });

  it('impide dos fuentes de titulo y valida la presentacion cerrada', () => {
    const type = validWorkspace().cardTypes[0]!;
    expect(problems(validateCard(unsafe({ ...ideaA, titleRichText: [{ type: 'text', text: 'Otra' }] }), type)))
      .toContain('invalid-value@card.titleRichText');
    expect(problems(validateCard(unsafe({ ...ideaA, titleVisibility: 'collapsed' }), type)))
      .toContain('invalid-value@card.titleVisibility');
  });

  it('resuelve tipos historicos sin migrarlos y permite excepciones portables', () => {
    expect(cardContentPresentation({}, 'text')).toEqual({ title: 'hidden', body: 'visible', layout: 'document' });
    expect(cardContentPresentation({}, 'section')).toEqual({ title: 'visible', body: 'hidden', layout: 'document' });
    expect(cardContentPresentation({}, 'image')).toEqual({ title: 'visible', body: 'visible', layout: 'banner' });
    expect(cardContentPresentation({ titleVisibility: 'hidden', bodyVisibility: 'visible', contentLayout: 'banner' }, 'note'))
      .toEqual({ title: 'hidden', body: 'visible', layout: 'banner' });

    const changed = assertValid(updateCardAppearance(validWorkspace(), ideaA.id, {
      titleVisibility: 'hidden', bodyVisibility: 'visible', contentLayout: 'banner',
    }));
    expect(changed.cards.find((candidate) => candidate.id === ideaA.id)).toMatchObject({
      titleVisibility: 'hidden', bodyVisibility: 'visible', contentLayout: 'banner',
    });
  });
});
