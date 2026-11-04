import type { WorkspaceStorageIssue } from '@noutynotes/application';
import type { Locale } from '@noutynotes/ui';
import { t } from '../i18n';
import { describeFailure } from './messages';

export interface FolderOpenDiagnostic {
  readonly version: 1;
  readonly stage: 'picker' | 'read' | 'authorization' | 'validation';
  /** ADR 0010, Paquete 1: `recovery` distingue una recuperación pendiente (no implica datos
   * inválidos) de `invalid` (paquete realmente inconsistente o ID repetido entre carpetas). */
  readonly outcome: 'cancelled' | 'aborted' | 'denied' | 'security' | 'recovery' | 'invalid' | 'technical';
  readonly exception: string | null;
  readonly handleObtained: boolean;
  readonly mode: 'read' | 'readwrite';
  readonly secureContext: boolean | null;
  readonly topLevel: boolean | null;
  readonly userActivation: boolean | null;
  readonly site: 'localhost' | 'pages' | 'other';
}
export type FolderOpenFailure = {
  readonly ok: false;
  readonly message: string;
  readonly diagnostic?: FolderOpenDiagnostic;
  /** ADR 0010, Paquete 1: incidencia real ya clasificada por `WorkspaceStorage` (código, ruta,
   * mensaje y `details`), cuando la causa viene de leer/validar el paquete. `describeFolderOpenFailure`
   * la usa para mostrar el detalle real en vez del texto genérico; nunca lleva bytes ni contenido. */
  readonly issue?: WorkspaceStorageIssue | null;
};

/** No nombres/rutas, mensajes nativos, stack, contenido ni handles en el diagnóstico. */
export function captureFolderContext(mode: FolderOpenDiagnostic['mode'] = 'readwrite'): Omit<FolderOpenDiagnostic, 'stage' | 'outcome' | 'exception' | 'handleObtained'> {
  return { version: 1, mode, secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
    topLevel: typeof window === 'undefined' ? null : window === window.top,
    userActivation: typeof navigator === 'undefined' ? null : navigator.userActivation?.isActive ?? null,
    site: typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'localhost'
      : typeof location !== 'undefined' && location.hostname === 'sebhernandezamoros.github.io' ? 'pages' : 'other' };
}

export function folderDiagnostic(context: ReturnType<typeof captureFolderContext>, stage: FolderOpenDiagnostic['stage'], cause: unknown, code?: string): FolderOpenDiagnostic {
  const rawName = typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : null;
  const exception = typeof rawName === 'string' && ['AbortError', 'SecurityError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'TypeError'].includes(rawName) ? rawName : rawName === null ? null : 'Other';
  const outcome = exception === 'SecurityError' ? 'security' : exception === 'NotAllowedError' || code === 'permission-denied' ? 'denied'
    : exception === 'AbortError' && stage === 'picker' ? 'aborted'
    : code === 'recovery-pending' ? 'recovery' : code === 'invalid-stored-data' || code === 'duplicate-workspace-id' ? 'invalid' : 'technical';
  return { ...context, stage, outcome, exception, handleObtained: stage !== 'picker' };
}

export class FolderPickerError extends Error {
  /** ADR 0010, Paquete 1: `issue`, cuando se conoce, es la incidencia real ya clasificada por
   * `WorkspaceStorage` (nunca contenido de Notas ni bytes) — `describeFolderOpenFailure` la usa para
   * mostrar el detalle real en vez del texto genérico asociado a `outcome`. */
  constructor(readonly diagnostic: FolderOpenDiagnostic, readonly issue: WorkspaceStorageIssue | null = null) {
    super(issue?.message ?? 'Folder picker did not complete.');
    this.name = 'FolderPickerError';
  }
}

const keys = { cancelled: 'folder.open.cancelled', aborted: 'folder.open.aborted', denied: 'folder.open.denied', security: 'folder.open.security', recovery: 'folder.open.recovery', invalid: 'folder.open.invalid', technical: 'folder.open.technical' } as const;
/**
 * ADR 0010, Paquete 1: para `recovery`/`invalid` se prefiere `failure.issue` (la incidencia real ya
 * clasificada por `WorkspaceStorage`, mostrada vía `describeFailure` — mismo mecanismo ya usado para
 * ZIP/grid/relaciones, sin un segundo sistema de mensajes) sobre el texto genérico — exactamente el
 * punto donde antes se descartaba. El resto de causas (permiso, cancelación, seguridad) conserva su
 * texto genérico de siempre: no dependen de un archivo o entidad concreta.
 */
export function describeFolderOpenFailure(failure: { readonly message: string; readonly diagnostic?: FolderOpenDiagnostic; readonly issue?: WorkspaceStorageIssue | null }, locale: Locale): string {
  const outcome = failure.diagnostic?.outcome;
  if ((outcome === 'invalid' || outcome === 'recovery') && failure.issue) return describeFailure([failure.issue], 'folder');
  return failure.diagnostic ? t(keys[outcome!], locale) : failure.message;
}
