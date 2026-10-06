import {
  WORLD_GRID, addCard, archiveCard, archivedToTrash, createRelation, deleteRelation, findFreeSpace, moveCard, moveCards, purgeTrashedCard, resizeCard, restoreArchivedCard, restoreTrashedCard, setDisplay, trashCard,
  isArchiveInstant, isValidAssetRef, linkDisplay, linkUrlField, normalizeLinkUrl, updateCard, updateCardAppearance, validateWorkspace,
} from '@noutynotes/domain';
import type {
  AssetRef, BoardId, BoardLayout, Card, CardAppearanceChanges, CardContentChanges, CardDisplayMode, CardId, CardTypeDefinition, CardTypeId, GridConfig, GridPoint, GridSize, RestoreReport,
  RelationArrow, RelationId, RelationTypeDefinition, RelationTypeId, ValidationResult, Workspace, WorkspaceId,
} from '@noutynotes/domain';

import { nextSequentialId, workspaceIdFromName } from './ids';
import { resolveRelationType } from './relations';
import { LINK_CARD_TYPE, linkCardTypeFor } from './links';
import { syncNoteAssetRefs } from './note-blocks';
import type { WorkspaceAssets } from './workspace-assets';
import { describeUntrustedValue, storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { createEmptyWorkspace, modifyWorkspace } from './workspace-use-cases';

/**
 * Casos de uso del prototipo de UI (fase 7, ADR 0009). Cada uno abre, aplica una operación pura
 * del dominio y guarda mediante `modifyWorkspace`; si algo falla, no se guarda nada.
 */

/** El layout editable usa coordenadas del mundo; las grillas acotadas siguen disponibles para plantillas. */
export const CANONICAL_GRID: GridConfig = WORLD_GRID;
export const DEFAULT_CARD_SIZE: GridSize = { w: 4, h: 3 };
/** Board que se crea con la primera tarjeta si el workspace aún no tiene ninguno. */
export const PROTOTYPE_BOARD = { id: 'principal' as BoardId, title: 'Tablero principal' } as const;
export const RELATED_RELATION_TYPE: RelationTypeDefinition = { id: 'relacionada' as RelationTypeId, label: 'Relacionada con' };

export type PrototypeCardKind = 'note' | 'image' | 'title' | 'link';

interface CardPreset {
  readonly type: CardTypeDefinition;
  readonly title: string;
  readonly content?: string;
  readonly size?: GridSize;
  /** Apariencia y navegación portable (ADR 0046). */
  readonly icon?: Card['icon'];
  readonly boardTargetId?: BoardId;
}

/** Tipos mínimos que el prototipo añade a demanda. La imagen es un marcador de posición sin asset. */
export const PROTOTYPE_CARD_PRESETS: Readonly<Record<PrototypeCardKind, CardPreset>> = {
  note: { type: { id: 'nota' as CardTypeId, label: 'Nota', base: 'note', fields: [] }, title: 'Nueva nota', content: '' },
  image: { type: { id: 'imagen' as CardTypeId, label: 'Imagen', base: 'image', fields: [] }, title: 'Imagen de ejemplo' },
  title: { type: { id: 'titulo-flotante' as CardTypeId, label: 'Título', base: 'section', fields: [] }, title: 'Nuevo título', size: { w: 6, h: 2 } },
  // El tipo real se elige por proyecto (`linkCardTypeFor`, ADR 0020); este es el que se añade si no hay ninguno.
  link: { type: LINK_CARD_TYPE, title: 'Enlace' },
};

export interface AddCardInput {
  readonly kind: PrototypeCardKind;
  /** Título inicial; por defecto, el del preset (en un enlace, su dominio). */
  readonly title?: string;
  /** Solo para `link`: la dirección tal como la escribe la persona; se normaliza (ADR 0020). */
  readonly url?: string;
  /** Solo para `image`: un asset que ya existe (biblioteca, ADR 0022); sin él, es la imagen de ejemplo. */
  readonly assetRef?: string;
  /** Creación real (ADR 0024): la pone la interfaz; application no usa el reloj. */
  readonly createdAt?: string;
  /** Tablero destino; por defecto, el primero (o el del prototipo si no hay ninguno). */
  readonly boardId?: BoardId;
  /**
   * Zona visible del mundo (P2): la tarjeta va al primer hueco libre que empieza en `x,y` dentro de una
   * banda de `columns` celdas. Sin ella, primer hueco desde el origen en la banda de 12 columnas.
   */
  readonly near?: { readonly x: number; readonly y: number; readonly columns: number };
  /** Tamaño inicial en celdas; por defecto, el del preset (una nota dentro de un marco estrecho, ADR 0027). */
  readonly size?: GridSize;
  /** Apariencia y navegación portable (ADR 0046). */
  readonly icon?: Card['icon'];
  readonly boardTargetId?: BoardId;
}

export interface AddBoardInput {
  /** Título visible; en blanco o ausente, «Tablero N». */
  readonly title?: string;
}

export interface BoardCardTarget {
  readonly boardId: BoardId;
  readonly cardId: CardId;
}

export interface ConnectCardsInput {
  readonly from: CardId;
  readonly to: CardId;
  /** Nombre del tipo (ADR 0034): uno existente se reutiliza; uno nuevo se crea. Sin él, «Relacionada con». */
  readonly typeLabel?: string;
  readonly label?: string;
  readonly arrow?: RelationArrow;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue(input: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(input, key)?.value;
}

/** Reenvía un fallo del puerto con otro tipo de valor. */
function failed<T>(result: { readonly issues: readonly WorkspaceStorageIssue[] }): WorkspaceStorageResult<T> {
  return { ok: false, issues: result.issues };
}

/** Crea un workspace vacío con un ID legible derivado del nombre y libre en este almacenamiento. */
export async function createEmptyWorkspaceNamed(storage: WorkspaceStorage, name: string): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  const listed = await storage.list();
  if (!listed.ok) return failed(listed);
  const id = workspaceIdFromName(name, listed.value.map((summary) => summary.id));
  return createEmptyWorkspace(storage, { id, name });
}

/** IDs de tarjeta ocupados: los activos y los reservados por la Papelera (ADR 0015). */
export function takenCardIds(workspace: Workspace): string[] {
  return [
    ...workspace.cards.map((card) => card.id),
    ...(workspace.trash ?? []).map((entry) => entry.card.id),
    ...(workspace.archive ?? []).map((entry) => entry.card.id),
  ];
}

export function takenRelationIds(workspace: Workspace): string[] {
  return [...workspace.relations.map((relation) => relation.id), ...(workspace.trash ?? []).flatMap((entry) => entry.relations.map((relation) => relation.id))];
}

function withCardType(workspace: Workspace, type: CardTypeDefinition): Workspace {
  return workspace.cardTypes.some((existing) => existing.id === type.id) ? workspace : { ...workspace, cardTypes: [...workspace.cardTypes, type] };
}

/** Primer board del workspace; si no hay ninguno, añade el board del prototipo. */
function withBoard(workspace: Workspace): { readonly workspace: Workspace; readonly boardId: BoardId } {
  const [first] = workspace.boards;
  if (first) return { workspace, boardId: first.id };
  return { workspace: { ...workspace, boards: [{ ...PROTOTYPE_BOARD, cardIds: [] }] }, boardId: PROTOTYPE_BOARD.id };
}

/**
 * Añade una nota, imagen de ejemplo o título flotante al board indicado, en el primer
 * hueco libre. Un board inexistente es un error y no guarda nada. Devuelve su ID.
 */
export async function addCardToBoard(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: AddCardInput): Promise<WorkspaceStorageResult<CardId>> {
  const kind = isObject(input) ? ownValue(input, 'kind') : undefined;
  const title = isObject(input) ? ownValue(input, 'title') : undefined;
  const requestedBoard = isObject(input) ? ownValue(input, 'boardId') : undefined;
  const near = isObject(input) ? ownValue(input, 'near') : undefined;
  const rawUrl = isObject(input) ? ownValue(input, 'url') : undefined;
  const assetRef = isObject(input) ? ownValue(input, 'assetRef') : undefined;
  const createdAt = isObject(input) ? ownValue(input, 'createdAt') : undefined;
  const size = isObject(input) ? ownValue(input, 'size') : undefined;
  const icon = isObject(input) ? ownValue(input, 'icon') : undefined;
  const boardTargetId = isObject(input) ? ownValue(input, 'boardTargetId') : undefined;
  if (size !== undefined && !(isObject(size) && [ownValue(size, 'w'), ownValue(size, 'h')].every((side) => Number.isSafeInteger(side) && (side as number) >= 1))) {
    return storageFailure('invalid-workspace', 'size', 'El tamaño debe ser de enteros mayores o iguales que 1.');
  }
  if (createdAt !== undefined && !isArchiveInstant(createdAt)) return storageFailure('invalid-workspace', 'createdAt', 'La fecha de creación debe ser ISO 8601 en UTC.');
  const validNear = near === undefined || (isObject(near) && Number.isSafeInteger(ownValue(near, 'x')) && Number.isSafeInteger(ownValue(near, 'y'))
    && Number.isSafeInteger(ownValue(near, 'columns')) && (ownValue(near, 'columns') as number) >= 1);
  if ((kind !== 'note' && kind !== 'image' && kind !== 'title' && kind !== 'link') || (title !== undefined && typeof title !== 'string')
    || (requestedBoard !== undefined && typeof requestedBoard !== 'string') || !validNear) {
    return storageFailure('invalid-workspace', 'input', 'Indica el tipo de tarjeta (nota, imagen, título o enlace) y, opcionalmente, un título, un tablero de texto y una zona con enteros.');
  }
  const zone = near === undefined ? undefined : near as NonNullable<AddCardInput['near']>;
  const url = kind === 'link' ? normalizeLinkUrl(typeof rawUrl === 'string' ? rawUrl : '') : undefined;
  if (url && !url.ok) return storageFailure('invalid-workspace', 'input', 'El enlace no es válido.', url.issues);
  if (assetRef !== undefined && (kind !== 'image' || typeof assetRef !== 'string' || !isValidAssetRef(assetRef) || !assetRef.startsWith('assets/'))) {
    return storageFailure('invalid-asset', 'assetRef', 'Solo una imagen del proyecto (bajo assets/) puede añadirse como tarjeta de imagen.');
  }
  const preset = PROTOTYPE_CARD_PRESETS[kind];
  const cardSize = size === undefined ? preset.size ?? DEFAULT_CARD_SIZE : { w: ownValue(size, 'w') as number, h: ownValue(size, 'h') as number };
  let created: CardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    if (boardTargetId !== undefined && (typeof boardTargetId !== 'string' || !workspace.boards.some((board) => board.id === boardTargetId))) {
      return { ok: false, issues: [{ code: 'missing-reference', path: 'input.boardTargetId', message: 'El tablero destino no existe.' }] };
    }
    const type = kind === 'link' ? linkCardTypeFor(workspace) : preset.type;
    const typed = withCardType(workspace, type);
    // Con tablero indicado, addCard comprueba que existe; sin él, se usa el primero o se crea el del prototipo.
    const { workspace: target, boardId } = requestedBoard === undefined ? withBoard(typed) : { workspace: typed, boardId: requestedBoard as BoardId };
    const cardId = nextSequentialId('tarjeta', takenCardIds(workspace)) as CardId;
    const card: Card = {
      id: cardId, typeId: type.id,
      title: title ?? (url?.ok ? linkDisplay(url.value).host : preset.title),
      fields: url?.ok ? { [linkUrlField(type) ?? 'url']: url.value } : {},
      // Imagen de la biblioteca: la tarjeta referencia el mismo archivo, sin copiarlo (ADR 0022).
      ...(typeof assetRef === 'string' ? { assetRefs: [assetRef as AssetRef] } : {}),
      ...(typeof createdAt === 'string' ? { createdAt } : {}),
      ...(typeof icon === 'string' ? { icon: icon as NonNullable<Card['icon']> } : {}),
      ...(typeof boardTargetId === 'string' ? { boardTargetId: boardTargetId as BoardId } : {}),
      ...(preset.content === undefined ? {} : { content: preset.content }),
    };
    const result = addCard(target, card, { boardId, size: cardSize, config: CANONICAL_GRID });
    if (result.ok) created = cardId;
    if (result.ok && (kind !== 'title' || zone)) {
      // La primera tarjeta crea el layout: antes, el tablero está vacío.
      const before = target.layouts.find((layout) => layout.boardId === boardId) ?? { boardId, placements: [] };
      const heading = kind === 'title' ? undefined : before?.placements.find((placement) => placement.rect.x === 0 && placement.rect.y === 0
        && target.cards.some((candidate) => candidate.id === placement.cardId && candidate.typeId === PROTOTYPE_CARD_PRESETS.title.type.id));
      const after = result.value.layouts.find((layout) => layout.boardId === boardId);
      if (before && after && (heading || zone)) {
        // El título al origen funciona como encabezado del tablero: la primera fila de tarjetas
        // comienza debajo. Solo es una pista de auto-colocación; el usuario puede mover todo después.
        // Con zona visible, se busca dentro de ella: la tarjeta aparece donde se está mirando.
        const free = findFreeSpace({ ...before, placements: before.placements.map((placement) => placement === heading
          ? { ...placement, rect: { ...placement.rect, w: CANONICAL_GRID.columns } } : placement) }, cardSize, CANONICAL_GRID,
        zone ? { from: { x: zone.x, y: zone.y }, columns: zone.columns } : {});
        if (free.ok) {
          const moved = moveCard(after, cardId, free.value, CANONICAL_GRID);
          if (moved.ok) return validateWorkspace({ ...result.value, layouts: result.value.layouts.map((layout) => layout === after ? moved.value : layout) });
        }
      }
    }
    return result;
  });
  if (!saved.ok) return failed(saved);
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la tarjeta.') : { ok: true, value: created };
}

export interface PlaceCardInput extends BoardCardTarget {
  /** Zona visible, como en `AddCardInput`: el hueco se busca donde se está mirando. */
  readonly near?: AddCardInput['near'];
}

/**
 * Coloca en el primer hueco libre una tarjeta que está en el tablero pero no tiene posición (p. ej. un
 * archivo editado a mano). Si ya tiene posición o no pertenece al tablero, no cambia nada. Devuelve dónde quedó.
 */
export async function placeCardOnBoard(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: PlaceCardInput): Promise<WorkspaceStorageResult<GridPoint>> {
  let placed: GridPoint | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const board = workspace.boards.find((candidate) => candidate.id === input.boardId);
    if (!board || !board.cardIds.includes(input.cardId)) {
      return { ok: false, issues: [{ code: 'missing-reference', path: 'cardId', message: 'La tarjeta no está en ese tablero.' }] };
    }
    const layout = workspace.layouts.find((candidate) => candidate.boardId === board.id) ?? { boardId: board.id, placements: [] };
    if (layout.placements.some((placement) => placement.cardId === input.cardId)) {
      return { ok: false, issues: [{ code: 'invalid-value', path: 'cardId', message: 'La tarjeta ya tiene posición en este tablero.' }] };
    }
    const zone = input.near;
    const free = findFreeSpace(layout, DEFAULT_CARD_SIZE, CANONICAL_GRID, zone ? { from: { x: zone.x, y: zone.y }, columns: zone.columns } : {});
    if (!free.ok) return free;
    placed = free.value;
    const next: BoardLayout = { ...layout, placements: [...layout.placements, { cardId: input.cardId, rect: { ...free.value, ...DEFAULT_CARD_SIZE }, display: 'expanded' }] };
    const exists = workspace.layouts.some((candidate) => candidate.boardId === board.id);
    return validateWorkspace({ ...workspace, layouts: exists ? workspace.layouts.map((candidate) => (candidate.boardId === board.id ? next : candidate)) : [...workspace.layouts, next] });
  });
  if (!saved.ok) return failed(saved);
  return placed === undefined ? storageFailure('invalid-workspace', 'transform', 'No se colocó la tarjeta.') : { ok: true, value: placed };
}

/** Añade un tablero vacío (con su layout) al final. ID secuencial `tablero-N`. Devuelve su ID. */
export async function addBoardToWorkspace(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: AddBoardInput): Promise<WorkspaceStorageResult<BoardId>> {
  const title = isObject(input) ? ownValue(input, 'title') : undefined;
  if (!isObject(input) || (title !== undefined && typeof title !== 'string')) {
    return storageFailure('invalid-workspace', 'input', 'El título del tablero debe ser texto.');
  }
  let created: BoardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const boardId = nextSequentialId('tablero', workspace.boards.map((board) => board.id)) as BoardId;
    const trimmed = typeof title === 'string' ? title.trim() : '';
    const result = validateWorkspace({
      ...workspace,
      boards: [...workspace.boards, { id: boardId, title: trimmed === '' ? `Tablero ${workspace.boards.length + 1}` : trimmed, cardIds: [] }],
      layouts: [...workspace.layouts, { boardId, placements: [] }],
    });
    if (result.ok) created = boardId;
    return result;
  });
  if (!saved.ok) return failed(saved);
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó el tablero.') : { ok: true, value: created };
}

/** Edita título y Markdown de una tarjeta. */
/** Cambia solo el título visible de un tablero; identidad, tarjetas y layout se conservan. */
export function renameBoardInWorkspace(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, boardId: BoardId, title: string,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  if (typeof title !== 'string' || title.trim() === '') {
    return Promise.resolve(storageFailure('invalid-workspace', 'title', 'El nombre del tablero no puede estar vacío.'));
  }
  return modifyWorkspace(storage, workspaceId, (workspace) => {
    if (!workspace.boards.some((board) => board.id === boardId)) {
      return { ok: false, issues: [{ code: 'missing-reference', path: 'boardId', message: 'El tablero no existe en el workspace.' }] };
    }
    const trimmed = title.trim();
    return validateWorkspace({
      ...workspace,
      boards: workspace.boards.map((board) => (board.id === boardId ? { ...board, title: trimmed } : board)),
    });
  });
}

export function editCardContent(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, changes: CardContentChanges,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => {
    const updated = updateCard(workspace, cardId, changes);
    const before = workspace.cards.find((card) => card.id === cardId);
    const content = typeof changes?.content === 'string' ? changes.content : undefined;
    const base = workspace.cardTypes.find((type) => type.id === before?.typeId)?.base;
    if (!updated.ok || !before || content === undefined || base === 'image') return updated;
    // Imágenes de la nota (ADR 0021): assetRefs sigue al Markdown sin tocar las referencias ajenas.
    const refs = syncNoteAssetRefs(before.assetRefs, before.content ?? '', content);
    return validateWorkspace({ ...updated.value, cards: updated.value.cards.map((card) => {
      if (card.id !== cardId) return card;
      const { assetRefs: _previous, ...rest } = card;
      return refs.length > 0 ? { ...rest, assetRefs: refs } : rest;
    }) });
  });
}

export function editCardAppearance(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, changes: CardAppearanceChanges,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => updateCardAppearance(workspace, cardId, changes));
}

/** Crea una ficha navegable al tablero destino; no duplica el tablero ni sus tarjetas. */
export async function addBoardShortcut(
  storage: WorkspaceStorage, workspaceId: WorkspaceId,
  input: { readonly boardId: BoardId; readonly targetBoardId: BoardId; readonly near?: AddCardInput['near']; readonly createdAt?: string },
): Promise<WorkspaceStorageResult<CardId>> {
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return failed(opened);
  const target = opened.value.boards.find((board) => board.id === input.targetBoardId);
  if (!target) return storageFailure('invalid-workspace', 'targetBoardId', 'El tablero destino no existe.');
  return addCardToBoard(storage, workspaceId, {
    kind: 'note', boardId: input.boardId, title: target.title, icon: 'folder', boardTargetId: input.targetBoardId,
    ...(input.near ? { near: input.near } : {}), ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

/** Aplica una operación del motor de grilla al layout canónico de un board. */
function changeBoardLayout(
  workspace: Workspace, boardId: BoardId, change: (layout: BoardLayout) => ValidationResult<BoardLayout>,
): ValidationResult<Workspace> {
  const layout = workspace.layouts.find((candidate) => candidate.boardId === boardId);
  if (!layout) {
    return { ok: false, issues: [{ code: 'missing-reference', path: 'boardId', message: `No hay layout para el board ${describeUntrustedValue(boardId)}.` }] };
  }
  const changed = change(layout);
  if (!changed.ok) return { ok: false, issues: changed.issues };
  return validateWorkspace({ ...workspace, layouts: workspace.layouts.map((candidate) => (candidate === layout ? changed.value : candidate)) });
}

/** Mueve la esquina de una tarjeta. Fuera de límites o con colisión, devuelve el error del motor. */
export function moveCardOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardId, to }: BoardCardTarget & { readonly to: GridPoint },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) =>
    changeBoardLayout(workspace, boardId, (layout) => moveCard(layout, cardId, to, CANONICAL_GRID)));
}

/**
 * Desplaza una tarjeta desde la posición guardada más reciente. Sirve para acciones discretas
 * encoladas por la interfaz: dos pulsaciones rápidas acumulan ambos pasos aunque el componente
 * todavía conserve la geometría del render anterior.
 */
export function nudgeCardOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardId, delta }: BoardCardTarget & { readonly delta: GridPoint },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) =>
    changeBoardLayout(workspace, boardId, (layout) => {
      const placement = layout.placements.find((candidate) => candidate.cardId === cardId);
      if (!placement) return moveCard(layout, cardId, delta, CANONICAL_GRID);
      return moveCard(layout, cardId, {
        x: placement.rect.x + delta.x,
        y: placement.rect.y + delta.y,
      }, CANONICAL_GRID);
    }));
}

/** Mueve un conjunto de tarjetas con el mismo desplazamiento (ADR 0025): o todas o ninguna, un guardado. */
export function moveCardsOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardIds, delta }: { readonly boardId: BoardId; readonly cardIds: readonly CardId[]; readonly delta: GridPoint },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) =>
    changeBoardLayout(workspace, boardId, (layout) => moveCards(layout, cardIds, delta, CANONICAL_GRID)));
}

/** Cambia el tamaño expandido de una tarjeta con las mismas reglas del motor. */
export function resizeCardOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardId, size }: BoardCardTarget & { readonly size: GridSize },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) =>
    changeBoardLayout(workspace, boardId, (layout) => resizeCard(layout, cardId, size, CANONICAL_GRID)));
}

/** Conecta dos tarjetas con el tipo «Relacionada con», que se añade si no existe. Devuelve el ID. */
export async function connectCards(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { from, to, typeLabel, label, arrow }: ConnectCardsInput,
): Promise<WorkspaceStorageResult<RelationId>> {
  let created: RelationId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const { workspace: typed, typeId } = typeLabel === undefined
      ? {
        workspace: workspace.relationTypes.some((type) => type.id === RELATED_RELATION_TYPE.id)
          ? workspace : { ...workspace, relationTypes: [...workspace.relationTypes, RELATED_RELATION_TYPE] },
        typeId: RELATED_RELATION_TYPE.id,
      }
      : resolveRelationType(workspace, typeLabel);
    const relationId = nextSequentialId('relacion', takenRelationIds(workspace)) as RelationId;
    const result = createRelation(typed, {
      id: relationId, typeId, from, to, ...(label === undefined ? {} : { label }), ...(arrow === undefined ? {} : { arrow }),
    });
    if (result.ok) created = relationId;
    return result;
  });
  if (!saved.ok) return failed(saved);
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la relación.') : { ok: true, value: created };
}

/** Elimina una relación; las tarjetas y su representación no cambian. */
export function disconnectCards(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, relationId: RelationId,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => deleteRelation(workspace, relationId));
}

export interface SetCardDisplayInput extends BoardCardTarget {
  readonly display: CardDisplayMode;
  /** Solo al expandir con el sitio ocupado: colocar en el primer hueco libre (ADR 0014). */
  readonly relocate?: boolean;
}

/**
 * Minimiza, contrae o expande una tarjeta en un tablero con `setDisplay` del dominio. Conserva
 * identidad, contenido, tamaño expandido y relaciones. Expandir con colisión falla salvo `relocate`.
 */
export function setCardDisplay(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardId, display, relocate }: SetCardDisplayInput,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => changeBoardLayout(workspace, boardId,
    (layout) => setDisplay(layout, cardId, display, CANONICAL_GRID, { ifOccupied: relocate === true ? 'relocate' : 'fail' })));
}

/** Envía una tarjeta a la Papelera (ADR 0015): una sola transformación y un solo guardado. */
export function moveCardToTrash(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => trashCard(workspace, cardId));
}

/** Aplica una operación a cada tarjeta del conjunto sobre el mismo workspace: si una falla, no se guarda ninguna. */
function eachCard(workspace: Workspace, cardIds: readonly CardId[], apply: (current: Workspace, cardId: CardId) => ValidationResult<Workspace>): ValidationResult<Workspace> {
  if (cardIds.length === 0) return { ok: false, issues: [{ code: 'invalid-value', path: 'cardIds', message: 'Debe haber al menos una tarjeta.' }] };
  let current = workspace;
  for (const cardId of new Set(cardIds)) {
    const next = apply(current, cardId);
    if (!next.ok) return next;
    current = next.value;
  }
  return { ok: true, value: current };
}

/** Envía un conjunto a la Papelera (ADR 0025): cada tarjeta con su instantánea, una sola escritura. */
export function moveCardsToTrash(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardIds: readonly CardId[]): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => eachCard(workspace, cardIds, trashCard));
}

/** Archiva un conjunto (ADR 0025) con la misma hora, puesta por la interfaz. */
export function moveCardsToArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, cardIds: readonly CardId[], archivedAt: string,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => eachCard(workspace, cardIds, (current, cardId) => archiveCard(current, cardId, archivedAt)));
}

/** Restaura una tarjeta de la Papelera y devuelve qué no pudo quedar igual. */
export function restoreCardFromTrash(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, input: { readonly cardId: CardId; readonly fallbackBoardId: BoardId },
): Promise<WorkspaceStorageResult<RestoreReport>> {
  return restoreSetAside(storage, workspaceId, input, restoreTrashedCard);
}

/** Archiva una tarjeta (ADR 0023). `archivedAt` (ISO 8601 en UTC) lo pone la interfaz: application no usa el reloj. */
export function moveCardToArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, archivedAt: string,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => archiveCard(workspace, cardId, archivedAt));
}

/** Restaura una tarjeta archivada y devuelve qué no pudo quedar igual. */
export function restoreCardFromArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, input: { readonly cardId: CardId; readonly fallbackBoardId: BoardId },
): Promise<WorkspaceStorageResult<RestoreReport>> {
  return restoreSetAside(storage, workspaceId, input, restoreArchivedCard);
}

/** Restaura un conjunto de tarjetas archivadas en una sola escritura (ADR 0039, selección múltiple del Archivo). */
export function restoreCardsFromArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, input: { readonly cardIds: readonly CardId[]; readonly fallbackBoardId: BoardId },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => {
    if (input.cardIds.length === 0) return { ok: false, issues: [{ code: 'invalid-value', path: 'cardIds', message: 'Debe haber al menos una tarjeta.' }] };
    const { workspace: target, boardId } = workspace.boards.some((board) => board.id === input.fallbackBoardId)
      ? { workspace, boardId: input.fallbackBoardId } : withBoard(workspace);
    let current = target;
    for (const cardId of new Set(input.cardIds)) {
      const restored = restoreArchivedCard(current, cardId, { fallbackBoardId: boardId, config: CANONICAL_GRID });
      if (!restored.ok) return restored;
      current = restored.value.workspace;
    }
    return { ok: true, value: current };
  });
}

/** Envía un conjunto de tarjetas archivadas a la Papelera en una sola escritura (ADR 0039). */
export function sendArchivedCardsToTrash(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardIds: readonly CardId[]): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => eachCard(workspace, cardIds, archivedToTrash));
}

/** «Eliminar» desde el Archivo: la tarjeta pasa a la Papelera; solo la Papelera borra (ADR 0023). */
export function sendArchivedToTrash(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => archivedToTrash(workspace, cardId));
}

async function restoreSetAside(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { cardId, fallbackBoardId }: { readonly cardId: CardId; readonly fallbackBoardId: BoardId },
  restore: typeof restoreTrashedCard,
): Promise<WorkspaceStorageResult<RestoreReport>> {
  let report: RestoreReport | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    // Sin tableros se crea el del prototipo para que la tarjeta restaurada sea visible.
    const { workspace: target, boardId } = workspace.boards.some((board) => board.id === fallbackBoardId)
      ? { workspace, boardId: fallbackBoardId } : withBoard(workspace);
    const restored = restore(target, cardId, { fallbackBoardId: boardId, config: CANONICAL_GRID });
    if (!restored.ok) return restored;
    report = restored.value.report;
    return { ok: true, value: restored.value.workspace };
  });
  if (!saved.ok) return failed(saved);
  return report === undefined ? storageFailure('invalid-workspace', 'transform', 'No se restauró la tarjeta.') : { ok: true, value: report };
}

export interface PurgeResult {
  /** Assets que ya no usa nada tras eliminar la tarjeta. */
  readonly releasedAssets: readonly AssetRef[];
  readonly removedAssets: readonly AssetRef[];
  /** No se pudieron borrar: quedan como archivos sin referencias (inofensivos) y se avisa. */
  readonly failedAssets: readonly AssetRef[];
}

/**
 * Elimina definitivamente una tarjeta de la Papelera. Primero guarda el workspace sin ella; después
 * borra solo los assets liberados. Nunca borra un asset que algo siga usando (ADR 0015).
 */
export async function purgeCardFromTrash(
  storage: WorkspaceStorage, assets: WorkspaceAssets | null, workspaceId: WorkspaceId, cardId: CardId,
): Promise<WorkspaceStorageResult<PurgeResult>> {
  let released: readonly AssetRef[] = [];
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const purged = purgeTrashedCard(workspace, cardId);
    if (!purged.ok) return purged;
    released = purged.value.releasedAssets;
    return { ok: true, value: purged.value.workspace };
  });
  if (!saved.ok) return failed(saved);
  const removedAssets: AssetRef[] = [];
  const failedAssets: AssetRef[] = [];
  for (const ref of released) {
    if (!assets) {
      failedAssets.push(ref);
      continue;
    }
    const removed = await assets.removeAsset(workspaceId, ref);
    (removed.ok ? removedAssets : failedAssets).push(ref);
  }
  return { ok: true, value: { releasedAssets: released, removedAssets, failedAssets } };
}
