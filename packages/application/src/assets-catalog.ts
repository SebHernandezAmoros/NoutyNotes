/**
 * Catálogo de assets del proyecto (ADR 0022). Puro: se deriva de los archivos que hay bajo `assets/` y
 * de las referencias de las tarjetas (activas y de la Papelera). No hay registro aparte que pueda divergir.
 */
import type { AssetRef, BoardId, Card, CardId, Workspace } from '@noutynotes/domain';

import { fold } from './search';
import { noteImageRefs, parseNoteBlocks, serializeNoteBlocks } from './note-blocks';

export type AssetKind = 'image' | 'document' | 'audio' | 'other';

const KINDS: readonly [AssetKind, RegExp][] = [
  ['image', /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i],
  ['document', /\.(pdf|txt|md|markdown|docx?|odt|rtf|csv|xlsx?|ods|pptx?|odp|json|ya?ml)$/i],
  ['audio', /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i],
];

export function assetKind(ref: string): AssetKind {
  return KINDS.find(([, pattern]) => pattern.test(ref))?.[0] ?? 'other';
}

export interface AssetUse {
  readonly cardId: CardId;
  readonly title: string;
  readonly inTrash: boolean;
  /** Tarjeta archivada (ADR 0023): su asset sigue en uso. */
  readonly inArchive: boolean;
  readonly boards: readonly { readonly boardId: BoardId; readonly title: string }[];
}

export interface AssetEntry {
  readonly ref: string;
  /** Nombre del archivo, sin carpetas. */
  readonly name: string;
  readonly kind: AssetKind;
  readonly usedBy: readonly AssetUse[];
  /** Referenciado, pero no está en el almacenamiento. */
  readonly missing: boolean;
  /** Está en el almacenamiento y nada lo referencia. */
  readonly unused: boolean;
}

/** Referencias de una tarjeta: `assetRefs`, campos `asset` e imágenes intercaladas de una nota. */
export function cardAssetRefs(workspace: Workspace, card: Card): string[] {
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  const assetFields = new Set(type?.fields.filter((field) => field.kind === 'asset').map((field) => field.key as string) ?? []);
  const fromFields = Object.entries(card.fields).filter(([key, value]) => assetFields.has(key) && typeof value === 'string').map(([, value]) => value as string);
  const fromContent = type?.base === 'image' ? [] : noteImageRefs(card.content ?? '');
  return [...new Set([...(card.assetRefs ?? []), ...fromFields, ...fromContent])];
}

const byName = (a: string, b: string) => (fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0);

export function buildAssetCatalog(workspace: Workspace, onDisk: readonly string[]): AssetEntry[] {
  const uses = new Map<string, AssetUse[]>();
  const note = (card: Card, where: 'active' | 'trash' | 'archive') => {
    const boards = where !== 'active' ? [] : workspace.boards.filter((board) => board.cardIds.includes(card.id)).map((board) => ({ boardId: board.id, title: board.title }));
    for (const ref of cardAssetRefs(workspace, card)) {
      uses.set(ref, [...(uses.get(ref) ?? []), { cardId: card.id, title: card.title ?? 'Sin título', inTrash: where === 'trash', inArchive: where === 'archive', boards }]);
    }
  };
  workspace.cards.forEach((card) => note(card, 'active'));
  (workspace.trash ?? []).forEach((entry) => note(entry.card, 'trash'));
  (workspace.archive ?? []).forEach((entry) => note(entry.card, 'archive'));
  const disk = new Set(onDisk.filter((ref) => ref.startsWith('assets/')));
  return [...new Set([...disk, ...uses.keys()])].sort(byName).map((ref) => {
    const usedBy = [...(uses.get(ref) ?? [])].sort((a, b) => byName(a.title, b.title) || (a.cardId < b.cardId ? -1 : 1));
    return { ref, name: ref.split('/').pop() ?? ref, kind: assetKind(ref), usedBy, missing: !disk.has(ref), unused: disk.has(ref) && usedBy.length === 0 };
  });
}

/** La tarjeta con `from` cambiado por `to` en todas sus referencias; la misma si no lo usaba. */
function replaceInCard(workspace: Workspace, card: Card, from: string, to: string): Card {
  if (!cardAssetRefs(workspace, card).includes(from)) return card;
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  const assetFields = new Set(type?.fields.filter((field) => field.kind === 'asset').map((field) => field.key as string) ?? []);
  const fields = Object.fromEntries(Object.entries(card.fields).map(([key, value]) => [key, assetFields.has(key) && value === from ? to : value]));
  const blocks = parseNoteBlocks(card.content ?? '');
  const inContent = type?.base !== 'image' && blocks.some((block) => block.kind === 'image' && block.ref === from);
  const content = inContent
    ? serializeNoteBlocks(blocks.map((block) => (block.kind === 'image' && block.ref === from ? { ...block, ref: to as typeof block.ref } : block)))
    : card.content;
  const next: Card = { ...card, fields };
  const refs = card.assetRefs ? [...new Set(card.assetRefs.map((ref): AssetRef => (ref === from ? to as AssetRef : ref)))] : undefined;
  return { ...next, ...(refs ? { assetRefs: refs } : {}), ...(content === undefined ? {} : { content }) };
}

/** Cambia `from` por `to` en todas las tarjetas, también en la Papelera y el Archivo (ADR 0022, «Reemplazar»). */
export function replaceAssetReferences(workspace: Workspace, from: string, to: string): Workspace {
  const inEntry = <E extends { readonly card: Card }>(entry: E): E => {
    const next = replaceInCard(workspace, entry.card, from, to);
    return next === entry.card ? entry : { ...entry, card: next };
  };
  return {
    ...workspace,
    cards: workspace.cards.map((card) => replaceInCard(workspace, card, from, to)),
    ...(workspace.trash ? { trash: workspace.trash.map(inEntry) } : {}),
    ...(workspace.archive ? { archive: workspace.archive.map(inEntry) } : {}),
  };
}
