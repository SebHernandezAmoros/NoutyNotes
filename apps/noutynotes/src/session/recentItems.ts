/**
 * Historial local de carpetas y proyectos recientes (UX7-E1, identidad corregida en UX7-E2A). Puro:
 * sin React, DOM ni filesystem — la lectura/escritura real vive en `recentItemsStore.ts`/`.android.ts`,
 * igual que `preferences.ts` frente a `viewPreferencesStore.ts`. Nunca sincroniza con la nube ni guarda
 * contenido de proyectos; solo nombre de presentación, backend y última apertura.
 *
 * UX7-E2A — identidad de carpetas: antes de esta corrección, una carpeta web se identificaba por su
 * `backend:nombre`, así que dos carpetas reales distintas con el mismo nombre («PROYECTOS») compartían
 * la misma entrada (defecto E2A-01). Ahora cada conexión real recibe un `id` opaco, generado por quien
 * llama (`recordFolderUse`/`reconnectFolderEntry` en `home/useRecentItems.ts`), nunca derivado del
 * nombre. Este módulo no decide identidad física — solo almacena lo que la capa de sesión le entrega.
 * `origin` distingue entradas creadas por este contrato (`'created'`) de las heredadas del formato
 * anterior de E1 (`'legacy'`, migradas por `parseRegistry` la primera vez que se leen), sin inventar una
 * equivalencia física que la plataforma no puede demostrar (Android sí tiene una URI SAF estable —
 * `androidUri` — web no, por diseño: persistir su handle real queda reservado a UX7-E2B).
 */

export type RecentFolderBackend = 'web' | 'android';
export type RecentProjectBackend = RecentFolderBackend | 'memory';
export type RecentFolderOrigin = 'created' | 'legacy';

export interface RecentFolderEntry {
  /** Opaco, generado una vez por conexión real reconocida; nunca derivado del nombre (E2A-01). */
  readonly id: string;
  readonly backend: RecentFolderBackend;
  readonly name: string;
  /** `'created'`: identidad asignada por el contrato de E2A. `'legacy'`: migrada del formato de E1,
   * todavía sin una reconexión que la confirme — ver `parseRegistry`. */
  readonly origin: RecentFolderOrigin;
  /** URI SAF real y estable (Android); `null` en web, donde no hay handle persistido todavía (E2B). */
  readonly androidUri: string | null;
  readonly lastUsedAt: number;
}

export interface RecentProjectEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly backend: RecentProjectBackend;
  /** `RecentFolderEntry.id` al que pertenece; `null` solo para memoria/ZIP, que no tiene carpeta. */
  readonly folderId: string | null;
  readonly lastUsedAt: number;
}

export interface RecentRegistry {
  readonly version: 1;
  readonly folders: readonly RecentFolderEntry[];
  readonly projects: readonly RecentProjectEntry[];
}

export const DEFAULT_REGISTRY: RecentRegistry = { version: 1, folders: [], projects: [] };

/** Historial acotado: suficiente para "recientes", sin crecer sin límite en el almacenamiento local. */
const MAX_ENTRIES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function migrateFolderEntry(value: unknown): RecentFolderEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.lastUsedAt !== 'number') return null;
  if (value.backend !== 'web' && value.backend !== 'android') return null;
  if (value.origin === 'created' || value.origin === 'legacy') {
    const androidUri = typeof value.androidUri === 'string' ? value.androidUri : null;
    return { id: value.id, backend: value.backend, name: value.name, origin: value.origin, androidUri, lastUsedAt: value.lastUsedAt };
  }
  // Formato E1 (sin `origin`): la identidad era `key` (nombre en web, URI SAF en Android). Se conserva
  // el mismo `id` para que las referencias de proyectos ya guardadas (`migrateProjectEntry`) sigan
  // resolviendo, pero se marca `'legacy'` — una reconexión real la confirma (UX7-E2A, sección 6).
  if (typeof value.key !== 'string') return null;
  return {
    id: value.id,
    backend: value.backend,
    name: value.name,
    origin: 'legacy',
    androidUri: value.backend === 'android' ? value.key : null,
    lastUsedAt: value.lastUsedAt,
  };
}

function migrateProjectEntry(value: unknown): RecentProjectEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.workspaceId !== 'string' || typeof value.name !== 'string' || typeof value.lastUsedAt !== 'number') return null;
  if (value.backend !== 'web' && value.backend !== 'android' && value.backend !== 'memory') return null;
  if ('folderId' in value) {
    if (value.folderId !== null && typeof value.folderId !== 'string') return null;
    return { id: value.id, workspaceId: value.workspaceId, name: value.name, backend: value.backend, folderId: value.folderId ?? null, lastUsedAt: value.lastUsedAt };
  }
  // Formato E1 (`folderKey`, no `folderId`): el `id` de la carpeta antigua era determinista
  // (`backend:key`), así que se reconstruye sin inventar una correspondencia nueva — es el mismo
  // valor que `migrateFolderEntry` conserva para esa misma entrada.
  if (value.folderKey !== null && typeof value.folderKey !== 'string') return null;
  const folderId = value.folderKey === null || value.backend === 'memory' ? null : `${value.backend}:${value.folderKey}`;
  return { id: value.id, workspaceId: value.workspaceId, name: value.name, backend: value.backend, folderId, lastUsedAt: value.lastUsedAt };
}

/** Lee lo guardado (JSON) con tolerancia y migra el formato E1 la primera vez que lo encuentra. */
export function parseRegistry(stored: string | null): RecentRegistry {
  let data: unknown = null;
  try {
    data = stored === null ? null : JSON.parse(stored);
  } catch {
    data = null;
  }
  const record = isRecord(data) ? data : {};
  const folders = Array.isArray(record.folders)
    ? record.folders.map(migrateFolderEntry).filter((entry): entry is RecentFolderEntry => entry !== null)
    : [];
  const projects = Array.isArray(record.projects)
    ? record.projects.map(migrateProjectEntry).filter((entry): entry is RecentProjectEntry => entry !== null)
    : [];
  return { version: 1, folders, projects };
}

export function serializeRegistry(registry: RecentRegistry): string {
  return JSON.stringify(registry);
}

/**
 * Registra o actualiza una carpeta por su `id` exacto — quien llama ya decidió si es una conexión
 * nueva (id recién generado) o la confirmación de una conocida (mismo id, con evidencia real:
 * coincidencia de URI en Android, o intención explícita del usuario al reconectar una entrada
 * concreta en web). Este módulo no decide esa identidad: solo la almacena (UX7-E2A, sección 4/5).
 */
export function upsertFolder(registry: RecentRegistry, entry: Omit<RecentFolderEntry, 'lastUsedAt'>, now: number): RecentRegistry {
  const next: RecentFolderEntry = { ...entry, lastUsedAt: now };
  const folders = [next, ...registry.folders.filter((existing) => existing.id !== entry.id)].slice(0, MAX_ENTRIES);
  return { ...registry, folders };
}

/** Igual que `upsertFolder`; el `id` compuesto (`backend:folderId:workspaceId`) ya usa un `folderId`
 * opaco, así que dos proyectos homónimos en carpetas distintas nunca colisionan (E2A-03). */
export function upsertProject(registry: RecentRegistry, input: { readonly workspaceId: string; readonly name: string; readonly backend: RecentProjectBackend; readonly folderId: string | null }, now: number): RecentRegistry {
  const id = `${input.backend}:${input.folderId ?? 'memory'}:${input.workspaceId}`;
  const entry: RecentProjectEntry = { id, workspaceId: input.workspaceId, name: input.name, backend: input.backend, folderId: input.folderId, lastUsedAt: now };
  const projects = [entry, ...registry.projects.filter((existing) => existing.id !== id)].slice(0, MAX_ENTRIES);
  return { ...registry, projects };
}

/** Quita una entrada del historial local. Nunca toca el disco/la carpeta/el proyecto original. */
export function forgetFolder(registry: RecentRegistry, id: string): RecentRegistry {
  return { ...registry, folders: registry.folders.filter((entry) => entry.id !== id) };
}

export function forgetProject(registry: RecentRegistry, id: string): RecentRegistry {
  return { ...registry, projects: registry.projects.filter((entry) => entry.id !== id) };
}

/** Más reciente primero; el orden de guardado no es el de presentación. */
export function orderedFolders(registry: RecentRegistry): readonly RecentFolderEntry[] {
  return [...registry.folders].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function orderedProjects(registry: RecentRegistry): readonly RecentProjectEntry[] {
  return [...registry.projects].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export type RecentProjectStatus = 'available' | 'loading' | 'missing' | 'reconnect' | 'unavailable' | 'temporary';

/**
 * UX7-E2A (defecto E2A-02): antes, un proyecto de la carpeta YA conectada podía mostrarse como
 * «Reconectar» mientras la lista de espacios del backend activo (asíncrona) todavía no había
 * respondido — una lista sin cargar no es evidencia de que el proyecto o el permiso se perdieron.
 * Esta función separa explícitamente «cargando» (`loading`) de «la carpeta correcta ya respondió y el
 * proyecto no está» (`missing`), y es pura para poder probar la carrera de forma determinista, sin
 * depender de los tiempos reales de un selector de carpetas o de Playwright.
 *
 * Memoria no sufre esta carrera (`ArchiveStorage.list()` resuelve de forma síncrona en la práctica) y
 * conserva su contrato simple de UX7-E1: disponible solo dentro de la misma sesión en memoria.
 */
export function resolveProjectStatus(entry: RecentProjectEntry, context: {
  readonly currentBackend: RecentProjectBackend;
  readonly currentFolderId: string | null;
  readonly knownWorkspaceIds: readonly string[];
  readonly workspacesLoading: boolean;
  readonly knownFolderIds: readonly string[];
}): RecentProjectStatus {
  if (entry.backend === 'memory') {
    return context.currentBackend === 'memory' && context.knownWorkspaceIds.includes(entry.workspaceId) ? 'available' : 'temporary';
  }
  const sameFolder = context.currentFolderId !== null && entry.backend === context.currentBackend && entry.folderId === context.currentFolderId;
  if (sameFolder) {
    if (context.workspacesLoading) return 'loading';
    return context.knownWorkspaceIds.includes(entry.workspaceId) ? 'available' : 'missing';
  }
  if (entry.folderId === null || !context.knownFolderIds.includes(entry.folderId)) return 'unavailable';
  return 'reconnect';
}
