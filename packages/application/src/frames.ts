/**
 * Marcos del tablero (ADR 0027): cada caso de uso es una operación pura del dominio sobre el layout
 * y un solo guardado. La pertenencia es geométrica; aquí no se guarda ninguna lista de hijas.
 */
import { findFreeSpace, frameAround, moveFrame, removeFrame, renameFrame, resizeFrame, validateWorkspace } from '@noutynotes/domain';
import type { BoardId, BoardLayout, CardId, GridPoint, GridSize, ValidationResult, Workspace, WorkspaceId } from '@noutynotes/domain';

import { nextSequentialId } from './ids';
import { CANONICAL_GRID, DEFAULT_CARD_SIZE, addCardToBoard } from './workspace-editing';
import { describeUntrustedValue, storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

export interface FrameTarget {
  readonly boardId: BoardId;
  readonly frameId: string;
}

function changeLayout(workspace: Workspace, boardId: BoardId, change: (layout: BoardLayout) => ValidationResult<BoardLayout>): ValidationResult<Workspace> {
  const layout = workspace.layouts.find((candidate) => candidate.boardId === boardId);
  if (!layout) return { ok: false, issues: [{ code: 'missing-reference', path: 'boardId', message: `No hay layout para el board ${describeUntrustedValue(boardId)}.` }] };
  const changed = change(layout);
  if (!changed.ok) return { ok: false, issues: changed.issues };
  return validateWorkspace({ ...workspace, layouts: workspace.layouts.map((candidate) => (candidate === layout ? changed.value : candidate)) });
}

/** «Agrupar»: un marco nuevo alrededor de las tarjetas, con una fila para el título. Devuelve su ID. */
export async function groupCardsInFrame(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, cardIds, title }: { readonly boardId: BoardId; readonly cardIds: readonly CardId[]; readonly title: string },
): Promise<WorkspaceStorageResult<string>> {
  let created: string | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => changeLayout(workspace, boardId, (layout) => {
    const id = nextSequentialId('marco', (layout.frames ?? []).map((frame) => frame.id));
    const result = frameAround(layout, cardIds, { id, title }, CANONICAL_GRID);
    if (result.ok) created = id;
    return result;
  }));
  if (!saved.ok) return saved;
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó el marco.') : { ok: true, value: created };
}

export function moveFrameOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, frameId, delta }: FrameTarget & { readonly delta: GridPoint },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => changeLayout(workspace, boardId, (layout) => moveFrame(layout, frameId, delta, CANONICAL_GRID)));
}

export function resizeFrameOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, frameId, size }: FrameTarget & { readonly size: GridSize },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => changeLayout(workspace, boardId, (layout) => resizeFrame(layout, frameId, size, CANONICAL_GRID)));
}

export function renameFrameOnBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, frameId, title }: FrameTarget & { readonly title: string },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => changeLayout(workspace, boardId, (layout) => renameFrame(layout, frameId, title)));
}

/** Quita el marco; las tarjetas se quedan donde están. */
export function removeFrameFromBoard(storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, frameId }: FrameTarget): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => changeLayout(workspace, boardId, (layout) => removeFrame(layout, frameId)));
}

/**
 * Una nota en el primer hueco dentro del marco, bajo su fila de título y del tamaño que quepa. Si no
 * cabe, no se crea nada: la nota no aparece fuera por sorpresa.
 */
export async function addNoteToFrame(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, { boardId, frameId, createdAt }: FrameTarget & { readonly createdAt?: string },
): Promise<WorkspaceStorageResult<CardId>> {
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return opened;
  const layout = opened.value.layouts.find((candidate) => candidate.boardId === boardId);
  const frame = layout?.frames?.find((candidate) => candidate.id === frameId);
  if (!layout || !frame) return storageFailure('invalid-workspace', 'frameId', 'Ese marco ya no existe en este tablero.');
  const size = { w: Math.min(DEFAULT_CARD_SIZE.w, frame.rect.w), h: Math.min(DEFAULT_CARD_SIZE.h, frame.rect.h - 1) };
  const spot = size.h < 1 ? null : findFreeSpace(layout, size, CANONICAL_GRID, { from: { x: frame.rect.x, y: frame.rect.y + 1 }, columns: frame.rect.w });
  const fits = spot?.ok === true && spot.value.x + size.w <= frame.rect.x + frame.rect.w && spot.value.y + size.h <= frame.rect.y + frame.rect.h;
  if (!spot || !spot.ok || !fits) {
    return storageFailure('invalid-workspace', 'frameId', 'El marco no tiene hueco para otra nota: hazlo más grande.', [{ code: 'frame-full', path: 'frameId', message: 'El marco no tiene hueco para otra nota: hazlo más grande.' }]);
  }
  return addCardToBoard(storage, workspaceId, {
    kind: 'note', boardId, size, near: { x: spot.value.x, y: spot.value.y, columns: size.w }, ...(createdAt ? { createdAt } : {}),
  });
}
