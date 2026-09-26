import {
  WORLD_GRID, addCard, createRelation, deleteRelation, findFreeSpace, moveCard, purgeTrashedCard, resizeCard, restoreTrashedCard, setDisplay, trashCard,
  updateCard, validateWorkspace,
} from '@noutynotes/domain';
import type {
  AssetRef, BoardId, BoardLayout, Card, CardContentChanges, CardDisplayMode, CardId, CardTypeDefinition, CardTypeId, GridConfig, GridPoint, GridSize, RestoreReport,
  RelationId, RelationTypeDefinition, RelationTypeId, ValidationResult, Workspace, WorkspaceId,
} from '@noutynotes/domain';

import { nextSequentialId, workspaceIdFromName } from './ids';
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

export type PrototypeCardKind = 'note' | 'image' | 'title';

interface CardPreset {
  readonly type: CardTypeDefinition;
  readonly title: string;
  readonly content?: string;
  readonly size?: GridSize;
}

/** Tipos mínimos que el prototipo añade a demanda. La imagen es un marcador de posición sin asset. */
export const PROTOTYPE_CARD_PRESETS: Readonly<Record<PrototypeCardKind, CardPreset>> = {
  note: { type: { id: 'nota' as CardTypeId, label: 'Nota', base: 'note', fields: [] }, title: 'Nueva nota', content: '' },
  image: { type: { id: 'imagen' as CardTypeId, label: 'Imagen', base: 'image', fields: [] }, title: 'Imagen de ejemplo' },
  title: { type: { id: 'titulo-flotante' as CardTypeId, label: 'Título', base: 'section', fields: [] }, title: 'Nuevo título', size: { w: 6, h: 2 } },
};

export interface AddCardInput {
  readonly kind: PrototypeCardKind;
  /** Título inicial; por defecto, el del preset. */
  readonly title?: string;
  /** Tablero destino; por defecto, el primero (o el del prototipo si no hay ninguno). */
  readonly boardId?: BoardId;
  /**
   * Zona visible del mundo (P2): la tarjeta va al primer hueco libre que empieza en `x,y` dentro de una
   * banda de `columns` celdas. Sin ella, primer hueco desde el origen en la banda de 12 columnas.
   */
  readonly near?: { readonly x: number; readonly y: number; readonly columns: number };
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
  return [...workspace.cards.map((card) => card.id), ...(workspace.trash ?? []).map((entry) => entry.card.id)];
}

function takenRelationIds(workspace: Workspace): string[] {
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
  const validNear = near === undefined || (isObject(near) && Number.isSafeInteger(ownValue(near, 'x')) && Number.isSafeInteger(ownValue(near, 'y'))
    && Number.isSafeInteger(ownValue(near, 'columns')) && (ownValue(near, 'columns') as number) >= 1);
  if ((kind !== 'note' && kind !== 'image' && kind !== 'title') || (title !== undefined && typeof title !== 'string')
    || (requestedBoard !== undefined && typeof requestedBoard !== 'string') || !validNear) {
    return storageFailure('invalid-workspace', 'input', 'Indica el tipo de tarjeta (nota, imagen o título) y, opcionalmente, un título, un tablero de texto y una zona con enteros.');
  }
  const zone = near === undefined ? undefined : near as NonNullable<AddCardInput['near']>;
  const preset = PROTOTYPE_CARD_PRESETS[kind];
  let created: CardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const typed = withCardType(workspace, preset.type);
    // Con tablero indicado, addCard comprueba que existe; sin él, se usa el primero o se crea el del prototipo.
    const { workspace: target, boardId } = requestedBoard === undefined ? withBoard(typed) : { workspace: typed, boardId: requestedBoard as BoardId };
    const cardId = nextSequentialId('tarjeta', takenCardIds(workspace)) as CardId;
    const card: Card = {
      id: cardId, typeId: preset.type.id, title: title ?? preset.title, fields: {},
      ...(preset.content === undefined ? {} : { content: preset.content }),
    };
    const result = addCard(target, card, { boardId, size: preset.size ?? DEFAULT_CARD_SIZE, config: CANONICAL_GRID });
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
          ? { ...placement, rect: { ...placement.rect, w: CANONICAL_GRID.columns } } : placement) }, preset.size ?? DEFAULT_CARD_SIZE, CANONICAL_GRID,
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
export function editCardContent(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, changes: CardContentChanges,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => updateCard(workspace, cardId, changes));
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

/** Cambia el tamaño expandido de una tarjeta con las mismas reglas del motor. */
export function resizeCardOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardId, size }: BoardCardTarget & { readonly size: GridSize },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) =>
    changeBoardLayout(workspace, boardId, (layout) => resizeCard(layout, cardId, size, CANONICAL_GRID)));
}

/** Conecta dos tarjetas con el tipo «Relacionada con», que se añade si no existe. Devuelve el ID. */
export async function connectCards(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { from, to }: ConnectCardsInput,
): Promise<WorkspaceStorageResult<RelationId>> {
  let created: RelationId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const typed = workspace.relationTypes.some((type) => type.id === RELATED_RELATION_TYPE.id)
      ? workspace : { ...workspace, relationTypes: [...workspace.relationTypes, RELATED_RELATION_TYPE] };
    const relationId = nextSequentialId('relacion', takenRelationIds(workspace)) as RelationId;
    const result = createRelation(typed, { id: relationId, typeId: RELATED_RELATION_TYPE.id, from, to });
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

/** Restaura una tarjeta de la Papelera y devuelve qué no pudo quedar igual. */
export async function restoreCardFromTrash(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { cardId, fallbackBoardId }: { readonly cardId: CardId; readonly fallbackBoardId: BoardId },
): Promise<WorkspaceStorageResult<RestoreReport>> {
  let report: RestoreReport | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    // Sin tableros se crea el del prototipo para que la tarjeta restaurada sea visible.
    const { workspace: target, boardId } = workspace.boards.some((board) => board.id === fallbackBoardId)
      ? { workspace, boardId: fallbackBoardId } : withBoard(workspace);
    const restored = restoreTrashedCard(target, cardId, { fallbackBoardId: boardId, config: CANONICAL_GRID });
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
