import type { Locale } from '@noutynotes/ui';
import { t } from '../i18n';

export interface FolderOpenDiagnostic {
  readonly version: 1;
  readonly stage: 'picker' | 'validation';
  readonly outcome: 'aborted' | 'denied' | 'security' | 'invalid' | 'technical';
  readonly exception: string | null;
  readonly handleObtained: boolean;
  readonly mode: 'readwrite';
  readonly secureContext: boolean | null;
  readonly topLevel: boolean | null;
  readonly userActivation: boolean | null;
  readonly site: 'localhost' | 'pages' | 'other';
}
export type FolderOpenFailure = { readonly ok: false; readonly message: string; readonly diagnostic?: FolderOpenDiagnostic };

/** No nombres/rutas, mensajes nativos, stack, contenido ni handles en el diagnóstico. */
export function captureFolderContext(): Omit<FolderOpenDiagnostic, 'stage' | 'outcome' | 'exception' | 'handleObtained'> {
  return { version: 1, mode: 'readwrite', secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
    topLevel: typeof window === 'undefined' ? null : window === window.top,
    userActivation: typeof navigator === 'undefined' ? null : navigator.userActivation?.isActive ?? null,
    site: typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'localhost'
      : typeof location !== 'undefined' && location.hostname === 'sebhernandezamoros.github.io' ? 'pages' : 'other' };
}

export function folderDiagnostic(context: ReturnType<typeof captureFolderContext>, stage: FolderOpenDiagnostic['stage'], cause: unknown, code?: string): FolderOpenDiagnostic {
  const rawName = typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : null;
  const exception = typeof rawName === 'string' && ['AbortError', 'SecurityError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'TypeError'].includes(rawName) ? rawName : rawName === null ? null : 'Other';
  const outcome = exception === 'SecurityError' ? 'security' : exception === 'NotAllowedError' || code === 'permission-denied' ? 'denied'
    : exception === 'AbortError' && stage === 'picker' ? 'aborted' : code === 'invalid-stored-data' ? 'invalid' : 'technical';
  return { ...context, stage, outcome, exception, handleObtained: stage === 'validation' };
}

export class FolderPickerError extends Error {
  constructor(readonly diagnostic: FolderOpenDiagnostic) { super('Folder picker did not complete.'); this.name = 'FolderPickerError'; }
}

const keys = { aborted: 'folder.open.aborted', denied: 'folder.open.denied', security: 'folder.open.security', invalid: 'folder.open.invalid', technical: 'folder.open.technical' } as const;
export function describeFolderOpenFailure(failure: { readonly message: string; readonly diagnostic?: FolderOpenDiagnostic }, locale: Locale): string {
  return failure.diagnostic ? t(keys[failure.diagnostic.outcome], locale) : failure.message;
}
