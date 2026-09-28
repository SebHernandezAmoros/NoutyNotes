/** Archivar y restaurar un tablero completo como unidad (ADR 0039). */
import { WORLD_GRID, archiveBoard, restoreArchivedBoard } from '@noutynotes/domain';
import type { BoardId, RestoreBoardReport, WorkspaceId } from '@noutynotes/domain';

import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

function failed<T>(result: { readonly issues: readonly WorkspaceStorageIssue[] }): WorkspaceStorageResult<T> {
  return { ok: false, issues: result.issues };
}

/** Archiva un tablero entero: cada una de sus tarjetas y luego el tablero mismo, en una transacción. */
export function moveBoardToArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, boardId: BoardId, archivedAt: string,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => archiveBoard(workspace, boardId, archivedAt));
}

/** Restaura un tablero archivado y devuelve cuántas de sus tarjetas volvieron (o se omitieron). */
export async function restoreBoardFromArchive(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, boardId: BoardId,
): Promise<WorkspaceStorageResult<RestoreBoardReport>> {
  let report: RestoreBoardReport | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const restored = restoreArchivedBoard(workspace, boardId, WORLD_GRID);
    if (!restored.ok) return restored;
    report = restored.value.report;
    return { ok: true, value: restored.value.workspace };
  });
  if (!saved.ok) return failed(saved);
  return report === undefined ? storageFailure('invalid-workspace', 'transform', 'No se restauró el tablero.') : { ok: true, value: report };
}
