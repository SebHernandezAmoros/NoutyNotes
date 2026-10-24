import { isValidId } from '@noutynotes/domain';
import type { BoardId } from '@noutynotes/domain';

export interface ResumeIntent {
  readonly version: 1;
  readonly backend: 'web';
  readonly folderId: string;
  readonly workspaceId: string;
  readonly activeBoardId?: string;
}

export function parseResumeIntent(serialized: string | null): ResumeIntent | null {
  try {
    const value: unknown = JSON.parse(serialized ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1 || entry.backend !== 'web' || typeof entry.folderId !== 'string'
      || !/^[a-zA-Z0-9:._-]{1,180}$/.test(entry.folderId)
      || typeof entry.workspaceId !== 'string' || !isValidId(entry.workspaceId)) return null;
    return { version: 1, backend: 'web', folderId: entry.folderId, workspaceId: entry.workspaceId,
      ...(typeof entry.activeBoardId === 'string' && isValidId(entry.activeBoardId) ? { activeBoardId: entry.activeBoardId } : {}) };
  } catch { return null; }
}

/** Solo sobre el proyecto ya abierto: una pista nunca acredita pertenencia ni recupera archivados. */
export function resolveResumeBoard(intent: ResumeIntent | null, owner: Pick<ResumeIntent, 'backend' | 'folderId' | 'workspaceId'>,
  boards: readonly { readonly id: BoardId }[]): BoardId | null {
  const matches = intent?.backend === owner.backend && intent.folderId === owner.folderId && intent.workspaceId === owner.workspaceId;
  return (matches ? boards.find((board) => board.id === intent.activeBoardId)?.id : undefined) ?? boards[0]?.id ?? null;
}

export type ResumeState = 'idle' | 'resolving' | 'permission' | 'unavailable' | 'recovery' | 'ready';
export type PreparedResume<C> = { readonly state: 'ready'; readonly candidate: C } | { readonly state: 'unavailable' | 'recovery' };
export interface ResumeServices<H, C> {
  loadHandle(id: string): Promise<H | null>;
  queryPermission(handle: H): Promise<string>;
  prepare(handle: H, intent: ResumeIntent): Promise<PreparedResume<C>>;
  activate(candidate: C, intent: ResumeIntent): void;
}

/** Una operación de arranque vigente. No modifica borradores, no abre selectores y no solicita permisos. */
export class SessionResume<H, C> {
  private epoch = 0;
  private target: { handle: H; intent: ResumeIntent } | null = null;
  private bootTarget: ResumeIntent | null | undefined;
  private bootCompleted = false;
  constructor(private readonly services: ResumeServices<H, C>) {}
  cancel(): void { this.epoch++; this.target = null; }
  abandon(): void { this.cancel(); this.bootCompleted = true; this.bootTarget = null; }

  claimReload(intent: ResumeIntent | null, id: string | undefined, reload: boolean, known: boolean): { target: ResumeIntent | null; discard: boolean } {
    if (this.bootCompleted) return { target: null, discard: false };
    if (this.bootTarget === undefined) {
      if (!reload || !known || !intent || intent.workspaceId !== id) {
        this.abandon();
        return { target: null, discard: true };
      }
      this.bootTarget = intent;
    }
    if (this.bootTarget?.workspaceId !== id) {
      this.abandon();
      return { target: null, discard: false };
    }
    return { target: this.bootTarget, discard: false };
  }

  async start(intent: ResumeIntent): Promise<ResumeState> {
    const epoch = ++this.epoch;
    this.target = null;
    try {
      const handle = await this.services.loadHandle(intent.folderId);
      if (epoch !== this.epoch) return 'idle';
      if (!handle) return 'unavailable';
      this.target = { handle, intent };
      const permission = await this.services.queryPermission(handle);
      if (epoch !== this.epoch) return 'idle';
      if (permission !== 'granted') return 'permission';
      return await this.finish(epoch, handle, intent);
    } catch { return epoch === this.epoch ? 'unavailable' : 'idle'; }
  }

  /** request se invoca antes del primer await: únicamente desde el botón y con handle ya precargado. */
  async reconnect(request: (handle: H) => Promise<string>): Promise<ResumeState> {
    const target = this.target;
    if (!target) return 'unavailable';
    const epoch = ++this.epoch;
    try {
      const permission = await request(target.handle);
      if (epoch !== this.epoch) return 'idle';
      if (permission !== 'granted') return 'permission';
      return await this.finish(epoch, target.handle, target.intent);
    } catch { return epoch === this.epoch ? 'permission' : 'idle'; }
  }

  private async finish(epoch: number, handle: H, intent: ResumeIntent): Promise<ResumeState> {
    const prepared = await this.services.prepare(handle, intent);
    if (epoch !== this.epoch) return 'idle';
    if (prepared.state !== 'ready') return prepared.state;
    this.bootCompleted = true;
    this.services.activate(prepared.candidate, intent);
    return 'ready';
  }
}
