import type { RichTextDocument, Workspace } from '../../packages/domain/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';

/** Synthetic state only; no resource was retired or copied to make this fixture. */
export const removedImageDocument: RichTextDocument = {
  schemaVersion: 3,
  blocks: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Texto anterior conservado' }] },
    { type: 'retired-image', alt: 'Mapa del río', caption: [{ type: 'text', text: 'Leyenda conservada', marks: ['bold'] }],
      captionPolicy: 'explicit', accessibilityIntent: 'informative', size: 'medium', alignment: 'center' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Texto posterior conservado' }] },
  ],
};

export function removedImageWorkspace(): Workspace {
  const source = validWorkspace();
  return { ...source, cards: source.cards.map((card, index) => index === 0 ? {
    id: card.id, typeId: card.typeId, title: 'Nota con imagen retirada', fields: { summary: 'Resumen independiente' },
    contentDocument: removedImageDocument,
  } : card) };
}
