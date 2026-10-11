import { addCard, isValidAssetRef, validateWorkspace } from '@noutynotes/domain';
import type { AssetRef, BoardId, Card, CardId, RichTextDocument, RichTextImage, WorkspaceId } from '@noutynotes/domain';

import { nextSequentialId } from './ids';
import { insertImageBlock, replaceNoteImage, syncNoteAssetRefs } from './note-blocks';
import type { WorkspaceAssets } from './workspace-assets';
import { CANONICAL_GRID, DEFAULT_CARD_SIZE, PROTOTYPE_BOARD, PROTOTYPE_CARD_PRESETS, takenCardIds } from './workspace-editing';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

/** Tamaño máximo de una imagen importada (ADR 0015): 5 MiB, con margen para el ZIP y la vista previa. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageKind {
  readonly extension: 'png' | 'jpg' | 'gif' | 'webp';
  readonly mimeType: string;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) => prefix.every((value, index) => bytes[offset + index] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Formato por firma binaria, nunca por la extensión del nombre. */
export function inspectImage(bytes: Uint8Array): WorkspaceStorageResult<ImageKind> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return storageFailure('invalid-asset', 'archivo', 'El archivo está vacío.');
  if (bytes.length > MAX_IMAGE_BYTES) return storageFailure('invalid-asset', 'archivo', 'La imagen supera 5 MB.');
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, value: { extension: 'png', mimeType: 'image/png' } };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, value: { extension: 'jpg', mimeType: 'image/jpeg' } };
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return { ok: true, value: { extension: 'gif', mimeType: 'image/gif' } };
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { ok: true, value: { extension: 'webp', mimeType: 'image/webp' } };
  return storageFailure('invalid-asset', 'archivo', 'Formato no admitido. Usa una imagen PNG, JPEG, GIF o WebP.');
}

/**
 * Escribe la imagen en `assets/images/` con el primer nombre libre (`name(1)`, `name(2)`…): nunca
 * sobrescribe un archivo existente (ADR 0015).
 */
export async function writeImageAsset(
  assets: WorkspaceAssets, workspaceId: WorkspaceId, bytes: Uint8Array, kind: ImageKind, name: (attempt: number) => string,
): Promise<WorkspaceStorageResult<AssetRef>> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = `assets/images/${name(attempt)}.${kind.extension}`;
    if (!isValidAssetRef(candidate)) break;
    const written = await assets.writeAsset(workspaceId, candidate, bytes);
    if (written.ok) return { ok: true, value: candidate as AssetRef };
    if (written.issues[0]?.code !== 'asset-conflict') return { ok: false, issues: written.issues };
  }
  return storageFailure('asset-conflict', 'archivo', 'No hay un nombre libre para la imagen en assets/images.');
}

/** Retira un asset recién escrito cuando no se pudo guardar lo que lo usaba; si falla, lo dice. */
export async function withdraw<T>(assets: WorkspaceAssets, workspaceId: WorkspaceId, ref: AssetRef, issues: WorkspaceStorageResult<unknown> & { ok: false }): Promise<WorkspaceStorageResult<T>> {
  const removed = await assets.removeAsset(workspaceId, ref);
  if (removed.ok) return { ok: false, issues: issues.issues };
  return { ok: false, issues: [...issues.issues, { code: 'io-failure', path: ref, message: `No se pudo retirar ${ref}; queda un archivo sin uso.` }] };
}

/** Título legible a partir del nombre del archivo, sin extensión. */
export function titleFrom(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '').trim().slice(0, 80);
  return base === '' ? 'Imagen' : base;
}

export interface ImportImageInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Tablero destino; por defecto, el primero (o el del prototipo si no hay ninguno). */
  readonly boardId?: BoardId;
  /** Creación real (ADR 0024), puesta por la interfaz. */
  readonly createdAt?: string;
}

/**
 * Importa una imagen real como tarjeta (ADR 0015): valida, escribe el asset sin sobrescribir nada y
 * crea la tarjeta que lo referencia. Si la tarjeta no se guarda, retira el asset recién escrito: ni
 * tarjeta sin archivo ni asset huérfano. Devuelve el ID de la tarjeta.
 */
export async function importImageCard(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, input: ImportImageInput,
): Promise<WorkspaceStorageResult<CardId>> {
  const kind = inspectImage(input.bytes);
  if (!kind.ok) return { ok: false, issues: kind.issues };
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const cardId = nextSequentialId('tarjeta', takenCardIds(opened.value)) as CardId;

  const written = await writeImageAsset(assets, workspaceId, input.bytes, kind.value, (attempt) => `${cardId}${attempt === 1 ? '' : `-${attempt}`}`);
  if (!written.ok) return { ok: false, issues: written.issues };
  const ref = written.value;

  const preset = PROTOTYPE_CARD_PRESETS.image;
  const assetRef = ref;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const typed = workspace.cardTypes.some((type) => type.id === preset.type.id) ? workspace : { ...workspace, cardTypes: [...workspace.cardTypes, preset.type] };
    const [first] = typed.boards;
    const withBoard = input.boardId !== undefined || first ? typed : { ...typed, boards: [{ ...PROTOTYPE_BOARD, cardIds: [] }] };
    const boardId = input.boardId ?? first?.id ?? PROTOTYPE_BOARD.id;
    const title = titleFrom(input.fileName);
    const card: Card = {
      id: cardId, typeId: preset.type.id, title, fields: {}, assetRefs: [assetRef],
      content: insertImageBlock('', undefined, assetRef, title), contentLayout: 'banner',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    };
    return addCard(withBoard, card, { boardId, size: preset.size ?? DEFAULT_CARD_SIZE, config: CANONICAL_GRID });
  });
  if (saved.ok) return { ok: true, value: cardId };
  return withdraw(assets, workspaceId, assetRef, saved);
}

export interface AddNoteImageInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Contenido actual del editor (puede tener cambios sin guardar): se guarda con la imagen. */
  readonly content: string;
  /** Insertar tras el párrafo del cursor (al final sin cursor) o reemplazar la imagen del bloque `index`. */
  readonly place: { readonly kind: 'insert'; readonly caret?: number } | { readonly kind: 'replace'; readonly index: number };
}

/**
 * Imagen dentro de una nota (ADR 0021): valida y escribe el asset (`assets/images/<tarjeta>-<n>`), coloca
 * su línea en el Markdown y guarda contenido y `assetRefs` a la vez. Si la nota no se guarda, retira el
 * asset recién escrito. Reemplazar deja el archivo anterior sin tocar. Devuelve el contenido guardado.
 */
/**
 * Escribe el archivo de una imagen nueva de nota con el siguiente nombre libre (`tarjeta-N`, sin
 * extensión): nunca «tarjeta-1-1.png» y «tarjeta-1-1.jpg» a la vez. Comparte numeración entre el
 * cuerpo Markdown (`addNoteImage`) y el cuerpo HTML seguro (`addNoteImageDocument`, ADR 0066).
 */
async function writeNextNoteImageAsset(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, cardId: CardId, bytes: Uint8Array,
): Promise<WorkspaceStorageResult<AssetRef>> {
  const kind = inspectImage(bytes);
  if (!kind.ok) return { ok: false, issues: kind.issues };
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const used = new Set([...opened.value.cards, ...(opened.value.trash ?? []).map((entry) => entry.card)]
    .flatMap((card) => card.assetRefs ?? []).map((ref) => ref.replace(/\.[^./]+$/, '')));
  const free: number[] = [];
  const nth = (attempt: number) => {
    for (let candidate = (free.at(-1) ?? 0) + 1; free.length < attempt; candidate += 1) {
      if (!used.has(`assets/images/${cardId}-${candidate}`)) free.push(candidate);
    }
    return free[attempt - 1];
  };
  return writeImageAsset(assets, workspaceId, bytes, kind.value, (attempt) => `${cardId}-${nth(attempt)}`);
}

export async function addNoteImage(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, cardId: CardId, input: AddNoteImageInput,
): Promise<WorkspaceStorageResult<{ readonly content: string; readonly ref: AssetRef }>> {
  if (typeof input.content !== 'string') return storageFailure('invalid-workspace', 'input', 'Falta el contenido de la nota.');
  const written = await writeNextNoteImageAsset(storage, assets, workspaceId, cardId, input.bytes);
  if (!written.ok) return written;
  const ref = written.value;
  const content = input.place.kind === 'insert'
    ? insertImageBlock(input.content, input.place.caret, ref, titleFrom(input.fileName))
    : replaceNoteImage(input.content, input.place.index, ref);
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const card = workspace.cards.find((candidate) => candidate.id === cardId);
    if (!card) return { ok: false, issues: [{ code: 'missing-reference', path: 'cardId', message: 'La tarjeta no existe en este proyecto.' }] };
    if (content === input.content) return { ok: false, issues: [{ code: 'invalid-value', path: 'place', message: 'Ese bloque no es una imagen de la nota.' }] };
    const refs = syncNoteAssetRefs(card.assetRefs, card.content ?? '', content);
    const { assetRefs: _previous, ...rest } = card;
    const next = { ...rest, content, ...(refs.length > 0 ? { assetRefs: refs } : {}) };
    return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => (candidate === card ? next : candidate)) });
  });
  if (saved.ok) return { ok: true, value: { content, ref } };
  return withdraw(assets, workspaceId, ref, saved);
}

export interface AddNoteImageDocumentInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Documento HTML seguro actual del editor (puede tener cambios sin guardar): se guarda con la imagen. */
  readonly contentDocument: RichTextDocument;
  /** Insertar tras el bloque `afterBlock` (al final sin él) o reemplazar la imagen del bloque `blockIndex`. */
  readonly place: { readonly kind: 'insert'; readonly afterBlock?: number } | { readonly kind: 'replace'; readonly blockIndex: number };
}

/**
 * Imagen dentro de una nota con cuerpo HTML seguro (ADR 0066): mismo contrato y numeración de archivo
 * que `addNoteImage`, pero inserta el bloque de imagen directamente en el documento estructurado — el
 * cuerpo nunca pasa por `content`/Markdown (regla de seguridad: nunca convertir HTML nuevo a Markdown).
 * Reemplazar conserva el texto alternativo y la leyenda de la imagen anterior, igual que `addNoteImage`.
 */
export async function addNoteImageDocument(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, cardId: CardId, input: AddNoteImageDocumentInput,
): Promise<WorkspaceStorageResult<{ readonly contentDocument: RichTextDocument; readonly ref: AssetRef }>> {
  const written = await writeNextNoteImageAsset(storage, assets, workspaceId, cardId, input.bytes);
  if (!written.ok) return written;
  const ref = written.value;
  const blocks = [...input.contentDocument.blocks];
  if (input.place.kind === 'replace') {
    const existing = blocks[input.place.blockIndex];
    if (existing?.type !== 'image') return withdraw(assets, workspaceId, ref, { ok: false, issues: [{ code: 'invalid-workspace', path: 'place', message: 'Ese bloque no es una imagen de la nota.' }] });
    blocks[input.place.blockIndex] = { ...existing, assetRef: ref };
  } else {
    const image: RichTextImage = { type: 'image', assetRef: ref, alt: titleFrom(input.fileName) };
    blocks.splice(Math.min(blocks.length, (input.place.afterBlock ?? blocks.length - 1) + 1), 0, image);
  }
  const contentDocument = { ...input.contentDocument, blocks };
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const card = workspace.cards.find((candidate) => candidate.id === cardId);
    if (!card) return { ok: false, issues: [{ code: 'missing-reference', path: 'cardId', message: 'La tarjeta no existe en este proyecto.' }] };
    const refs = [...new Set(blocks.filter((block): block is RichTextImage => block.type === 'image').map((block) => block.assetRef))];
    const next = { ...card, contentDocument, ...(refs.length > 0 ? { assetRefs: refs } : {}) };
    return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => (candidate === card ? next : candidate)) });
  });
  if (saved.ok) return { ok: true, value: { contentDocument, ref } };
  return withdraw(assets, workspaceId, ref, saved);
}
