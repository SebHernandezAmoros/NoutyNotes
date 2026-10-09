import type { AssetRef, Card, Workspace } from '@noutynotes/domain';

import { ideaA, validWorkspace } from '../../../domain/src/__fixtures__/workspace';

export function htmlWorkspace(): Workspace {
  const source = validWorkspace();
  const card = source.cards.find((candidate) => candidate.id === ideaA.id) as Card;
  const { content: _legacy, ...withoutLegacy } = card;
  return {
    ...source,
    cards: source.cards.map((candidate) => candidate.id === ideaA.id ? {
      ...withoutLegacy,
      contentDocument: {
        schemaVersion: 1,
        blocks: [
          { type: 'heading', level: 2, content: [{ type: 'text', text: 'Documento HTML', marks: ['bold'] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Portable entre adaptadores.' }] },
          { type: 'image', assetRef: 'assets/images/a.png' as AssetRef, alt: 'Mapa local' },
        ],
      },
    } : candidate),
  };
}
