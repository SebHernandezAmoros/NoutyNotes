/** Inert U2-A fixture only. No retirement operation or binary file is created. */
import type { Card, CardTypeId, FieldKey, Workspace } from '../../packages/domain/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';

export function removedCardsWorkspace(): Workspace {
  const source = validWorkspace();
  const imageType = 'retired-image' as CardTypeId;
  const pdfType = 'retired-pdf' as CardTypeId;
  const fields = [{ key: 'description' as FieldKey, kind: 'text' as const }];
  return { ...source,
    cardTypes: [{ id: imageType, label: 'Imagen', base: 'image', fields }, { id: pdfType, label: 'PDF', base: 'file', fields }],
    cards: source.cards.map((card, index): Card => ({ id: card.id, typeId: index === 0 ? imageType : pdfType,
      title: index === 0 ? 'Mapa conservado' : 'Informe conservado', content: 'Texto independiente conservado',
      fields: { description: 'Metadato independiente' }, tags: ['prueba'],
      primaryResourceState: { kind: 'retired', resourceKind: index === 0 ? 'image' : 'pdf' },
    })),
  };
}
