import type { WorkspaceSummary } from '@noutynotes/application';
import type { WorkspaceId } from '@noutynotes/domain';

import type { RecentProjectBackend, RecentProjectEntry } from '../session/recentItems';

export interface HomeProjectEntry {
  readonly key: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly backend: RecentProjectBackend;
  readonly folderId: string | null;
  readonly recent: RecentProjectEntry | null;
  readonly inCurrentSession: boolean;
  readonly canForget: boolean;
  readonly unexported: boolean;
}

interface MergeHomeProjectsInput {
  readonly recentProjects: readonly RecentProjectEntry[];
  readonly sessionProjects: readonly WorkspaceSummary[];
  readonly currentBackend: RecentProjectBackend;
  readonly currentFolderId: string | null;
  readonly unexported: readonly WorkspaceId[];
}

function durableKey(backend: RecentProjectBackend, folderId: string | null, workspaceId: string): string {
  return `${backend}:${folderId ?? 'memory'}:${workspaceId}`;
}

/**
 * Construye la lista de Inicio sin confundir proyectos homónimos de carpetas distintas.
 * La sesión viva completa o actualiza sus propias entradas recientes, pero no reordena
 * ni reescribe el historial persistido.
 */
export function mergeHomeProjects(input: MergeHomeProjectsInput): readonly HomeProjectEntry[] {
  const sessionById = new Map(input.sessionProjects.map((summary) => [summary.id, summary]));
  const consumed = new Set<string>();
  const unexported = new Set<string>(input.unexported);

  const merged = input.recentProjects.map((recent): HomeProjectEntry => {
    const belongsToCurrentSession = recent.backend === input.currentBackend
      && recent.folderId === input.currentFolderId;
    const summary = belongsToCurrentSession ? sessionById.get(recent.workspaceId as WorkspaceId) : undefined;
    if (summary) consumed.add(summary.id);
    return {
      key: recent.id,
      workspaceId: recent.workspaceId,
      name: summary?.name ?? recent.name,
      backend: recent.backend,
      folderId: recent.folderId,
      recent,
      inCurrentSession: summary !== undefined,
      canForget: true,
      unexported: summary !== undefined && unexported.has(summary.id),
    };
  });

  for (const summary of input.sessionProjects) {
    if (consumed.has(summary.id)) continue;
    merged.push({
      key: durableKey(input.currentBackend, input.currentFolderId, summary.id),
      workspaceId: summary.id,
      name: summary.name,
      backend: input.currentBackend,
      folderId: input.currentFolderId,
      recent: null,
      inCurrentSession: true,
      canForget: false,
      unexported: unexported.has(summary.id),
    });
  }

  return merged;
}
