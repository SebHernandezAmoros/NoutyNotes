import type { AssetRef, Card, CardId, CardTypeId, Workspace } from '../../packages/domain/src/index';
import { archiveCard, trashCard } from '../../packages/domain/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { removedImageDocument } from './removed-image-blocks';

export const detachmentRef = 'assets/images/planificador.png' as AssetRef;
export const auxiliaryRef = 'assets/images/auxiliar.png' as AssetRef;
export const detachmentPdfRef = 'assets/documents/planificador.pdf' as AssetRef;
export const detachmentPdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF';
export const detachmentPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Synthetic owners, not a transformation of any user project or resource. */
export function detachmentWorkspace(): Workspace {
  const source = validWorkspace();
  const imageType = 'image' as CardTypeId;
  const image = { type: 'image' as const, assetRef: detachmentRef, alt: 'Mapa', captionPolicy: 'explicit' as const, accessibilityIntent: 'pending' as const };
  const main: Card = { id: source.cards[0]!.id, typeId: source.cardTypes[0]!.id, title: 'Nota con dos apariciones', fields: { summary: 'Conservar' }, assetRefs: [detachmentRef],
    contentDocument: { schemaVersion: 3, blocks: [image, { ...image, alt: 'Segunda vista' }, removedImageDocument.blocks[1]!] } };
  const card = (id: string, title: string): Card => ({ id: id as CardId, typeId: main.typeId, title, fields: { summary: 'Conservar' }, contentDocument: { schemaVersion: 2, blocks: [image] } });
  const archived = card('archived-note', 'Nota en Archivo');
  const trashed = card('trashed-note', 'Nota en Papelera');
  const auxiliary: Card = { id: 'auxiliary-note' as CardId, typeId: main.typeId, title: 'Referencia auxiliar', fields: { summary: 'Conservar' }, assetRefs: [auxiliaryRef] };
  const pdfType = 'pdf' as CardTypeId;
  const cards: readonly Card[] = [main, { id: source.cards[1]!.id, typeId: imageType, title: 'Tarjeta de imagen conservada', fields: {}, assetRefs: [detachmentRef] }, archived, trashed, auxiliary,
    { id: 'pdf-card' as CardId, typeId: pdfType, title: 'Tarjeta PDF conservada', fields: {}, assetRefs: [detachmentPdfRef] }];
  const initial: Workspace = { ...source, id: 'u2-c-fixture' as Workspace['id'], metadata: { name: 'Laboratorio U2-C' }, cards,
    cardTypes: [...source.cardTypes, { id: imageType, label: 'Imagen', base: 'image', fields: [] }, { id: pdfType, label: 'PDF', base: 'file', fields: [] }],
    boards: source.boards.map((board, index) => index === 0 ? { ...board, cardIds: cards.map((item) => item.id) } : board) };
  const saved = archiveCard(initial, archived.id, '2026-10-24T00:00:00Z');
  if (!saved.ok) throw new Error(JSON.stringify(saved.issues));
  const removed = trashCard(saved.value, trashed.id);
  if (!removed.ok) throw new Error(JSON.stringify(removed.issues));
  return removed.value;
}
