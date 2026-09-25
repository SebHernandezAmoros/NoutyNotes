import type { WorkspaceStorage } from '@noutynotes/application';

// Transiciones de la sesión al elegir o reabrir una carpeta, sin React ni plataforma (ADR 0012).

export type FolderResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface FolderState<F> {
  readonly storage: WorkspaceStorage;
  readonly mode: 'memory' | 'folder';
  readonly saved: F | null;
}

/** Guarda o borra la carpeta que se ofrecerá reabrir tras reiniciar (Android: archivo privado de la app). */
export interface RememberedFolder<F> {
  remember(folder: F): void;
  forget(): void;
}

/** Carpeta elegida: su almacenamiento y, en Android, lo que se recordará si se abre bien; null sin soporte. */
export type ChosenFolder<F> = { readonly storage: WorkspaceStorage; readonly folder: F | null } | null;

/**
 * Elegir carpeta (ADR 0012): la sesión solo cambia, y la carpeta solo se recuerda, cuando `list()` de la
 * nueva carpeta funciona. Si falla, siguen la sesión y la carpeta recordada anteriores.
 */
export async function chooseFolderInto<F>(
  state: FolderState<F>,
  choose: () => Promise<ChosenFolder<F>>,
  memory: RememberedFolder<F>,
): Promise<{ readonly state: FolderState<F>; readonly result: FolderResult }> {
  try {
    const chosen = await choose();
    if (!chosen) return { state, result: { ok: false, message: 'Este navegador no admite el acceso a carpetas.' } };
    const listed = await chosen.storage.list();
    if (!listed.ok) return { state, result: { ok: false, message: listed.issues[0]?.message ?? 'No se pudo leer la carpeta.' } };
    if (chosen.folder) memory.remember(chosen.folder);
    return { state: { storage: chosen.storage, mode: 'folder', saved: chosen.folder ?? state.saved }, result: { ok: true } };
  } catch (cause) {
    if ((cause as { name?: string }).name === 'AbortError') return { state, result: { ok: false, message: 'No se seleccionó ninguna carpeta.' } };
    return { state, result: { ok: false, message: 'No se pudo abrir la carpeta. Revisa los permisos y vuelve a intentarlo.' } };
  }
}

/**
 * Reabrir la carpeta recordada. Solo se olvida cuando se confirma la pérdida de acceso: `reopen` devuelve
 * null (el árbol ya no existe o no es accesible) o el puerto responde `permission-denied`. Datos inválidos,
 * fallos de lectura o excepciones informan del error y conservan la carpeta para reintentar.
 */
export async function reopenRememberedInto<F extends { readonly name: string }>(
  state: FolderState<F>,
  reopen: (folder: F) => WorkspaceStorage | null,
  memory: RememberedFolder<F>,
): Promise<{ readonly state: FolderState<F>; readonly result: FolderResult }> {
  const saved = state.saved;
  if (!saved) return { state, result: { ok: false, message: 'No hay una carpeta anterior que reabrir.' } };
  const lost = () => {
    memory.forget();
    return { state: { ...state, saved: null }, result: { ok: false, message: `Ya no hay acceso a «${saved.name}». Vuelve a elegir la carpeta con «Abrir una carpeta».` } } as const;
  };
  const failed = (detail: string) => ({
    state,
    result: { ok: false, message: `No se pudo abrir «${saved.name}». ${detail} La carpeta sigue recordada: corrige los archivos o vuelve a intentarlo.` },
  }) as const;
  let reopened: WorkspaceStorage | null;
  try {
    reopened = reopen(saved);
  } catch {
    return failed('El sistema no respondió al abrirla.');
  }
  if (!reopened) return lost();
  let listed: Awaited<ReturnType<WorkspaceStorage['list']>>;
  try {
    listed = await reopened.list();
  } catch {
    return failed('No se pudo leer la carpeta.');
  }
  if (!listed.ok) {
    if (listed.issues.some((issue) => issue.code === 'permission-denied')) return lost();
    return failed(listed.issues[0]?.message ?? 'No se pudo leer la carpeta.');
  }
  return { state: { storage: reopened, mode: 'folder', saved }, result: { ok: true } };
}
