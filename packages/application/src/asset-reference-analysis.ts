import { baseCardKinds, cardTitleText, fieldKinds, isValidAssetRef, parseNoteBlocks, validateRichTextDocument } from '@noutynotes/domain';
import type { Card, CardId, Workspace } from '@noutynotes/domain';

export type AssetReferenceStatus = 'complete-used' | 'complete-unused' | 'partial' | 'error' | 'unsupported';
export type AssetReferenceCollection = 'active' | 'archive' | 'trash';
export type AssetReferenceKind = 'rich-image' | 'markdown-image' | 'image-card' | 'document-card' | 'asset-field' | 'asset-ref' | 'unknown-field';

export interface AssetReferenceOwner {
  readonly id: string;
  readonly cardId: CardId;
  readonly title: string;
  readonly collection: AssetReferenceCollection;
  readonly restorable: boolean;
  readonly boards: readonly { readonly id: string; readonly title: string }[];
}
export interface AssetReferenceOccurrence {
  /** Identity within sourceSnapshot only; never a new durable block ID. */
  readonly id: string;
  readonly ownerId: string;
  readonly kind: AssetReferenceKind;
  readonly locator: string;
}
export interface AssetReferenceDependency {
  readonly kind: 'custom-font';
  readonly ref: string;
  readonly label: string;
}
export interface AssetReferenceAnalysis {
  readonly ref: string;
  readonly status: AssetReferenceStatus;
  readonly workspaceId: string | null;
  readonly sourceSnapshot: string | null;
  readonly owners: readonly AssetReferenceOwner[];
  readonly occurrences: readonly AssetReferenceOccurrence[];
  readonly carriers: readonly { readonly ownerId: string; readonly locator: string }[];
  readonly dependencies: readonly AssetReferenceDependency[];
  readonly ownerCount: number;
  readonly occurrenceCount: number;
  readonly issues: readonly { readonly kind: 'unverified' | 'unsupported' | 'error'; readonly detail: string }[];
}
export type AssetReferenceInput = { readonly ref: string } & (
  | { readonly workspace: Workspace; readonly unverified: readonly string[]; readonly dependencies?: readonly AssetReferenceDependency[] }
  | { readonly error: string }
);

/** Read-only query. Completeness is scoped to the supplied view, never permission to delete. */
export function analyzeAssetReferences(input: AssetReferenceInput): AssetReferenceAnalysis {
  const owners: AssetReferenceOwner[] = [];
  const occurrences: AssetReferenceOccurrence[] = [];
  const carriers: { ownerId: string; locator: string }[] = [];
  const issues: { kind: 'unverified' | 'unsupported' | 'error'; detail: string }[] = [];
  let workspaceId: string | null = null;
  let sourceSnapshot: string | null = null;
  let dependencies: readonly AssetReferenceDependency[] = [];
  const result = (): AssetReferenceAnalysis => ({
    ref: input.ref, workspaceId, sourceSnapshot, owners, occurrences, carriers, dependencies,
    ownerCount: owners.length, occurrenceCount: occurrences.length, issues,
    status: issues.some((issue) => issue.kind === 'error') ? 'error'
      : issues.some((issue) => issue.kind === 'unsupported') ? 'unsupported'
        : issues.length > 0 ? 'partial' : occurrences.length + dependencies.length > 0 ? 'complete-used' : 'complete-unused',
  });
  if (!isValidAssetRef(input.ref) || !input.ref.startsWith('assets/')) {
    issues.push({ kind: 'error', detail: 'La ruta del recurso no es válida.' });
    return result();
  }
  if ('error' in input) {
    issues.push({ kind: 'error', detail: input.error });
    return result();
  }
  try {
    const { workspace } = input;
    workspaceId = workspace.id;
    sourceSnapshot = JSON.stringify(workspace);
    dependencies = (input.dependencies ?? []).filter((dependency) => dependency.ref === input.ref);
    issues.push(...input.unverified.map((detail) => ({ kind: 'unverified' as const, detail })));
    const visit = (card: Card, collection: AssetReferenceCollection, savedBoards: readonly { readonly boardId: string }[] = []) => {
      const ownerId = JSON.stringify([workspace.id, collection, card.id]);
      const start = occurrences.length;
      const add = (kind: AssetReferenceKind, locator: string) => {
        occurrences.push({ id: JSON.stringify([ownerId, kind, locator]), ownerId, kind, locator });
      };
      const type = workspace.cardTypes.find((type) => type.id === card.typeId);
      if (!type || !baseCardKinds.includes(type.base)) {
        issues.push({ kind: 'unsupported', detail: `Tipo de tarjeta no admitido (${collection}).` });
      }
      if (card.content !== undefined && typeof card.content !== 'string') {
        issues.push({ kind: 'error', detail: 'No se pudo interpretar el contenido Markdown.' });
      } else {
        for (const block of parseNoteBlocks(card.content ?? '')) {
          if (block.kind === 'image' && block.ref === input.ref) add('markdown-image', `content:${block.start}`);
        }
      }
      if (card.content !== undefined && card.contentDocument !== undefined) {
        issues.push({ kind: 'error', detail: 'La tarjeta contiene dos fuentes de contenido incompatibles.' });
      }
      if (card.contentDocument !== undefined) {
        const doc = card.contentDocument;
        const unknown = Array.isArray(doc.blocks) && doc.blocks.some((block) =>
          !['paragraph', 'heading', 'list', 'image', 'table'].includes(block.type));
        if (unknown || ![1, 2].includes(doc.schemaVersion)) {
          issues.push({ kind: 'unsupported', detail: 'Hay contenido enriquecido no admitido; no se puede completar el análisis.' });
        }
        // Validate the document, including inlines; opaque/future blocks are never an empty success.
        const parsed = validateRichTextDocument(doc);
        if (!parsed.ok && !unknown && [1, 2].includes(doc.schemaVersion)) {
          issues.push({ kind: 'error', detail: 'No se pudo interpretar el documento enriquecido.' });
        }
        if (Array.isArray(doc.blocks)) doc.blocks.forEach((block, index) => {
          if (block.type === 'image' && block.assetRef === input.ref) add('rich-image', `contentDocument.blocks:${index}`);
        });
      }
      const editorial = occurrences.length > start;
      for (const [key, value] of Object.entries(card.fields)) {
        const field = type?.fields.find((field) => field.key === key);
        if (!field || !fieldKinds.includes(field.kind)) {
          if (value === input.ref) add('unknown-field', `fields:${key}`);
          issues.push({ kind: 'unsupported', detail: 'Hay un campo con un contrato no admitido; sus dependencias no se han podido verificar.' });
        } else if (field.kind === 'asset') {
          if (value === input.ref) add('asset-field', `fields:${key}`);
          else if (!isValidAssetRef(value)) issues.push({ kind: 'error', detail: 'Un campo de recurso no contiene una referencia válida.' });
        }
      }
      const fieldUse = occurrences.length > start && !editorial;
      (card.assetRefs ?? []).forEach((ref, index) => {
        if (ref !== input.ref) return;
        const locator = `assetRefs:${index}`;
        carriers.push({ ownerId, locator });
        // Note mirrors support the editorial occurrence, not another image. Primary cards are objects.
        if (type?.base === 'image' && index === 0) add('image-card', locator);
        else if (type?.base === 'file' && index === 0) add('document-card', locator);
        else if (!editorial && !fieldUse && !occurrences.slice(start).some((use) => ['asset-ref', 'image-card', 'document-card'].includes(use.kind))) add('asset-ref', locator);
      });
      if (occurrences.length === start) return;
      const boardIds = new Set(collection === 'active'
        ? workspace.boards.filter((board) => board.cardIds.includes(card.id)).map((board) => board.id as string)
        : savedBoards.map((board) => board.boardId));
      const boards = [...workspace.boards, ...(workspace.archivedBoards ?? []).map((entry) => entry.board)]
        .filter((board) => boardIds.has(board.id)).map((board) => ({ id: board.id as string, title: board.title }));
      for (const id of boardIds) if (!boards.some((board) => board.id === id)) boards.push({ id, title: '' });
      if (owners.some((owner) => owner.id === ownerId)) {
        issues.push({ kind: 'error', detail: 'Hay propietarios duplicados en la misma colección.' });
        occurrences.splice(start);
        return;
      }
      owners.push({ id: ownerId, cardId: card.id, title: cardTitleText(card) || '', collection,
        restorable: collection !== 'active', boards });
    };
    workspace.cards.forEach((card) => visit(card, 'active'));
    (workspace.archive ?? []).forEach((entry) => visit(entry.card, 'archive', entry.boards));
    (workspace.trash ?? []).forEach((entry) => visit(entry.card, 'trash', entry.boards));
  } catch {
    issues.push({ kind: 'error', detail: 'No se pudo interpretar la vista del proyecto. Las referencias conocidas no demuestran ausencia de otros usos.' });
  }
  return result();
}
