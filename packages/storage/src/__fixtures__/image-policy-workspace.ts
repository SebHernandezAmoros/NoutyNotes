import type { AssetRef, RichTextDocument, Workspace } from '@noutynotes/domain';

import { htmlWorkspace } from './html-workspace';

export const imagePolicyDocument: RichTextDocument = { schemaVersion: 2, blocks: [
  { type: 'image', assetRef: 'assets/images/a.png' as AssetRef, alt: 'Histórico' },
  { type: 'image', assetRef: 'assets/images/a.png' as AssetRef, alt: 'Anterior', caption: [], captionPolicy: 'explicit', accessibilityIntent: 'pending', size: 'medium', alignment: 'right' },
] };

export function imagePolicyWorkspace(): Workspace {
  const source = htmlWorkspace();
  return { ...source, cards: source.cards.map((card) => card.id === 'idea-a' ? { ...card, contentDocument: imagePolicyDocument } : card) };
}
