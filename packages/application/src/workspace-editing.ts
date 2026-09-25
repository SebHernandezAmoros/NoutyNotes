import { DESKTOP_GRID, addCard, createRelation, deleteRelation, moveCard, resizeCard, updateCard, validateWorkspace } from '@noutynotes/domain';
import type {
  BoardId, BoardLayout, Card, CardContentChanges, CardId, CardTypeDefinition, CardTypeId, GridConfig, GridPoint, GridSize,
  RelationId, RelationTypeDefinition, RelationTypeId, ValidationResult, Workspace, WorkspaceId,
} from '@noutynotes/domain';

import { nextSequentialId, workspaceIdFromName } from './ids';
import { describeUntrustedValue, storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { createEmptyWorkspace, modifyWorkspace } from './workspace-use-cases';

/**
 * Casos de uso del prototipo de UI (fase 7, ADR 0009). Cada uno abre, aplica una operación pura
 * del dominio y guarda mediante `modifyWorkspace`; si algo falla, no se guarda nada.
 */

/** El layout persistido es el canónico de escritorio (ADR 0004); las vistas se derivan. */
export const CANONICAL_GRID: GridConfig = DESKTOP_GRID;
export const DEFAULT_CARD_SIZE: GridSize = { w: 4, h: 3 };
/** Board que se crea con la primera tarjeta si el workspace aún no tiene ninguno. */
export const PROTOTYPE_BOARD = { id: 'principal' as BoardId, title: 'Tablero principal' } as const;
export const RELATED_RELATION_TYPE: RelationTypeDefinition = { id: 'relacionada' as RelationTypeId, label: 'Relacionada con' };

export type PrototypeCardKind = 'note' | 'image';

interface CardPreset {
  readonly type: CardTypeDefinition;
  readonly title: string;
  readonly content?: string;
}

/** Tipos mínimos que el prototipo añade a demanda. La imagen es un marcador de posición sin asset. */
export const PROTOTYPE_CARD_PRESETS: Readonly<Record<PrototypeCardKind, CardPreset>> = {
  note: { type: { id: 'nota' as CardTypeId, label: 'Nota', base: 'note', fields: [] }, title: 'Nueva nota', content: '' },
  image: { type: { id: 'imagen' as CardTypeId, label: 'Imagen', base: 'image', fields: [] }, title: 'Imagen de ejemplo' },
};

export interface AddCardInput {
  readonly kind: PrototypeCardKind;
  /** Título inicial; por defecto, el del preset. */
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

function withCardType(workspace: Workspace, type: CardTypeDefinition): Workspace {
  return workspace.cardTypes.some((existing) => existing.id === type.id) ? workspace : { ...workspace, cardTypes: [...workspace.cardTypes, type] };
}

/** Primer board del workspace; si no hay ninguno, añade el board del prototipo. */
function withBoard(workspace: Workspace): { readonly workspace: Workspace; readonly boardId: BoardId } {
  const [first] = workspace.boards;
  if (first) return { workspace, boardId: first.id };
  return { workspace: { ...workspace, boards: [{ ...PROTOTYPE_BOARD, cardIds: [] }] }, boardId: PROTOTYPE_BOARD.id };
}

/** Añade una nota o una imagen de ejemplo al primer board, en el primer hueco libre. Devuelve su ID. */
export async function addCardToBoard(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: AddCardInput): Promise<WorkspaceStorageResult<CardId>> {
  const kind = isObject(input) ? ownValue(input, 'kind') : undefined;
  const title = isObject(input) ? ownValue(input, 'title') : undefined;
  if ((kind !== 'note' && kind !== 'image') || (title !== undefined && typeof title !== 'string')) {
    return storageFailure('invalid-workspace', 'input', 'Indica el tipo de tarjeta (nota o imagen) y, opcionalmente, un título de texto.');
  }
  const preset = PROTOTYPE_CARD_PRESETS[kind];
  let created: CardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const { workspace: target, boardId } = withBoard(withCardType(workspace, preset.type));
    const cardId = nextSequentialId('tarjeta', workspace.cards.map((card) => card.id)) as CardId;
    const card: Card = {
      id: cardId, typeId: preset.type.id, title: title ?? preset.title, fields: {},
      ...(preset.content === undefined ? {} : { content: preset.content }),
    };
    const result = addCard(target, card, { boardId, size: DEFAULT_CARD_SIZE, config: CANONICAL_GRID });
    if (result.ok) created = cardId;
    return result;
  });
  if (!saved.ok) return failed(saved);
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la tarjeta.') : { ok: true, value: created };
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
    const relationId = nextSequentialId('relacion', workspace.relations.map((relation) => relation.id)) as RelationId;
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
