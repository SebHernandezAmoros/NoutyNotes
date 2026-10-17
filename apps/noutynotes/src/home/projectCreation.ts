import { createEmptyWorkspaceNamed } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceSummary } from '@noutynotes/application';

import type { BrowserDirectory } from '../session/folderAccess';
import type { RecentProjectBackend } from '../session/recentItems';

export type ProjectCreationTarget = {
  readonly kind: 'current';
  readonly storage: WorkspaceStorage;
  readonly backend: RecentProjectBackend;
  readonly folderId: string | null;
  readonly folderName: string;
} | {
  readonly kind: 'selected-web-folder';
  readonly storage: WorkspaceStorage;
  readonly handle: BrowserDirectory;
  readonly folderName: string;
};

type ActivateSelectedFolder = (
  handle: BrowserDirectory,
  name: string,
) => Promise<{ readonly ok: true; readonly folderId: string } | { readonly ok: false; readonly message: string }>;

export type CreateProjectResult =
  | { readonly ok: true; readonly summary: WorkspaceSummary; readonly backend: RecentProjectBackend; readonly folderId: string | null }
  | { readonly ok: false; readonly stage: 'validation'; readonly reason: 'required' | 'invalid' }
  | { readonly ok: false; readonly stage: 'create'; readonly issues: readonly WorkspaceStorageIssue[] }
  | { readonly ok: false; readonly stage: 'activate'; readonly created: WorkspaceSummary; readonly message: string };

interface CreateProjectAtTargetInput {
  readonly name: string;
  readonly target: ProjectCreationTarget;
  readonly activate: ActivateSelectedFolder;
  /** Punto de observación para pruebas: la escritura ya terminó y la sesión aún no cambió. */
  readonly beforeActivate?: () => void;
}

export async function createProjectAtTarget(input: CreateProjectAtTargetInput): Promise<CreateProjectResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, stage: 'validation', reason: 'required' };
  if (/\p{Cc}/u.test(name)) return { ok: false, stage: 'validation', reason: 'invalid' };

  const created = await createEmptyWorkspaceNamed(input.target.storage, name);
  if (!created.ok) return { ok: false, stage: 'create', issues: created.issues };
  input.beforeActivate?.();

  if (input.target.kind === 'current') {
    return { ok: true, summary: created.value, backend: input.target.backend, folderId: input.target.folderId };
  }

  const activated = await input.activate(input.target.handle, input.target.folderName);
  if (!activated.ok) {
    return { ok: false, stage: 'activate', created: created.value, message: activated.message };
  }
  return { ok: true, summary: created.value, backend: 'web', folderId: activated.folderId };
}
