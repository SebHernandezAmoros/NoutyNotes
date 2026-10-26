import type { Card, CardId, CardTypeId, Workspace, WorkspaceId } from '../../packages/domain/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { detachmentPdfRef, detachmentRef } from './asset-detachment';

export function canvasCardsWorkspace(): Workspace {
  const source = validWorkspace();
  const imageType = 'image' as CardTypeId;
  const pdfType = 'pdf' as CardTypeId;
  const note = (id: string, title: string): Card => ({ id: id as CardId, typeId: source.cardTypes[0]!.id, title, fields: { summary: 'Conservar' } });
  const cards: readonly Card[] = [
    { ...note('idea-a', 'Documento extenso'), contentDocument: { schemaVersion: 2,
      blocks: Array.from({ length: 80 }, (_, index) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text: `Párrafo ${index + 1}: contenido del laboratorio para desplazarse sin mover la Nota.` }] })) } },
    { ...note('idea-b', 'Nota con imagen'), assetRefs: [detachmentRef], contentDocument: { schemaVersion: 2, blocks: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Antes de la imagen' }] },
      { type: 'image', assetRef: detachmentRef, alt: 'Mapa', captionPolicy: 'explicit', caption: [{ type: 'text', text: 'Leyenda conservada' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Después de la imagen' }] },
    ] } },
    { id: 'picture' as CardId, typeId: imageType, title: 'Imagen', fields: {}, assetRefs: [detachmentRef] },
    { id: 'pdf' as CardId, typeId: pdfType, title: 'PDF', fields: {}, assetRefs: [detachmentPdfRef] },
    { id: 'retired' as CardId, typeId: imageType, title: 'Recurso retirado', fields: {}, primaryResourceState: { kind: 'retired', resourceKind: 'image' } },
    { ...note('tiny', 'Nota mínima con título largo conservado'), content: 'Texto íntegro de la Nota mínima.' },
    { ...note('transparent', 'Identificador transparente'), frameOverride: 'hidden', titleVisibility: 'hidden', bodyVisibility: 'visible', content: 'Texto transparente conservado.' },
  ];
  const rects = [ { x: 0, y: 0, w: 8, h: 7 }, { x: 0, y: 9, w: 8, h: 5 }, { x: 10, y: 0, w: 4, h: 4 },
    { x: 10, y: 6, w: 4, h: 3 }, { x: 10, y: 11, w: 4, h: 3 }, { x: 0, y: 16, w: 1, h: 1 }, { x: 0, y: 19, w: 8, h: 5 } ];
  return { ...source, id: 'canvas-lab' as WorkspaceId, metadata: { name: 'Laboratorio Canvas' }, cards,
    cardTypes: [...source.cardTypes, { id: imageType, label: 'Imagen', base: 'image', fields: [] }, { id: pdfType, label: 'PDF', base: 'file', fields: [] }],
    boards: source.boards.map((board, index) => ({ ...board, cardIds: index === 0 ? cards.map((card) => card.id) : [cards[0]!.id] })),
    layouts: [{ boardId: source.boards[0]!.id, placements: cards.map((card, index) => ({ cardId: card.id, rect: rects[index]!, display: 'expanded' })) },
      { boardId: source.boards[1]!.id, placements: [{ cardId: cards[0]!.id, rect: { x: 20, y: 20, w: 8, h: 7 }, display: 'expanded' }] }],
    relations: source.relations,
  };
}
