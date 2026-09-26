import { addCard, isValidAssetRef } from '@noutynotes/domain';
import type { AssetRef, BoardId, Card, CardId, WorkspaceId } from '@noutynotes/domain';

import { nextSequentialId } from './ids';
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

/** Título legible a partir del nombre del archivo, sin extensión. */
function titleFrom(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '').trim().slice(0, 80);
  return base === '' ? 'Imagen' : base;
}

export interface ImportImageInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Tablero destino; por defecto, el primero (o el del prototipo si no hay ninguno). */
  readonly boardId?: BoardId;
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

  let ref: AssetRef | undefined;
  for (let attempt = 1; attempt <= 50 && ref === undefined; attempt += 1) {
    const candidate = `assets/images/${cardId}${attempt === 1 ? '' : `-${attempt}`}.${kind.value.extension}`;
    if (!isValidAssetRef(candidate)) break;
    const written = await assets.writeAsset(workspaceId, candidate, input.bytes);
    if (written.ok) ref = candidate;
    else if (written.issues[0]?.code !== 'asset-conflict') return { ok: false, issues: written.issues };
  }
  if (ref === undefined) return storageFailure('asset-conflict', 'archivo', 'No hay un nombre libre para la imagen en assets/images.');

  const preset = PROTOTYPE_CARD_PRESETS.image;
  const assetRef = ref;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const typed = workspace.cardTypes.some((type) => type.id === preset.type.id) ? workspace : { ...workspace, cardTypes: [...workspace.cardTypes, preset.type] };
    const [first] = typed.boards;
    const withBoard = input.boardId !== undefined || first ? typed : { ...typed, boards: [{ ...PROTOTYPE_BOARD, cardIds: [] }] };
    const boardId = input.boardId ?? first?.id ?? PROTOTYPE_BOARD.id;
    const card: Card = { id: cardId, typeId: preset.type.id, title: titleFrom(input.fileName), fields: {}, assetRefs: [assetRef] };
    return addCard(withBoard, card, { boardId, size: DEFAULT_CARD_SIZE, config: CANONICAL_GRID });
  });
  if (saved.ok) return { ok: true, value: cardId };
  const removed = await assets.removeAsset(workspaceId, assetRef);
  if (removed.ok) return { ok: false, issues: saved.issues };
  return {
    ok: false,
    issues: [...saved.issues, { code: 'io-failure', path: assetRef, message: `No se pudo retirar ${assetRef}; queda un archivo sin tarjeta.` }],
  };
}
