/**
 * Historial local de carpetas y proyectos recientes (UX7-E1). Puro: sin React, DOM ni filesystem —
 * la lectura/escritura real vive en `recentItemsStore.ts`/`.android.ts`, igual que `preferences.ts`
 * frente a `viewPreferencesStore.ts`. Nunca sincroniza con la nube ni guarda contenido de proyectos;
 * solo nombre de presentación, backend y última apertura (ver `Docs/knowledge/UX7-PROJECTS.md`).
 */

export type RecentFolderBackend = 'web' | 'android';
export type RecentProjectBackend = RecentFolderBackend | 'memory';

export interface RecentFolderEntry {
  readonly id: string;
  readonly backend: RecentFolderBackend;
  /** Nombre de la carpeta (web) o URI SAF (Android) — única señal de identidad disponible sin
   * persistir handles (reservado a UX7-E2). En web dos carpetas con el mismo nombre comparten
   * entrada: limitación conocida y documentada, no un intento de huella de ruta. */
  readonly key: string;
  readonly name: string;
  readonly lastUsedAt: number;
}

export interface RecentProjectEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly backend: RecentProjectBackend;
  /** Carpeta a la que pertenece (`RecentFolderEntry.key`); `null` solo para memoria/ZIP, que no
   * tiene carpeta. Combinado con `workspaceId` evita confundir proyectos homónimos en carpetas
   * distintas (dos carpetas pueden tener cada una un proyecto "demo"). */
  readonly folderKey: string | null;
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

function isValidFolderEntry(value: unknown): value is RecentFolderEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && (value.backend === 'web' || value.backend === 'android')
    && typeof value.key === 'string' && typeof value.name === 'string' && typeof value.lastUsedAt === 'number';
}

function isValidProjectEntry(value: unknown): value is RecentProjectEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.workspaceId === 'string' && typeof value.name === 'string'
    && (value.backend === 'web' || value.backend === 'android' || value.backend === 'memory')
    && (value.folderKey === null || typeof value.folderKey === 'string')
    && typeof value.lastUsedAt === 'number';
}

/** Lee lo guardado (JSON) sin confiar en él: datos ausentes, corruptos o con forma inválida caen al vacío. */
export function parseRegistry(stored: string | null): RecentRegistry {
  let data: unknown = null;
  try {
    data = stored === null ? null : JSON.parse(stored);
  } catch {
    data = null;
  }
  const record = isRecord(data) ? data : {};
  const folders = Array.isArray(record.folders) ? record.folders.filter(isValidFolderEntry) : [];
  const projects = Array.isArray(record.projects) ? record.projects.filter(isValidProjectEntry) : [];
  return { version: 1, folders, projects };
}

export function serializeRegistry(registry: RecentRegistry): string {
  return JSON.stringify(registry);
}

/**
 * Registra el uso de una carpeta. El identificador es determinista (`backend:key`): reabrir la misma
 * carpeta actualiza su entrada en vez de duplicarla; nunca se genera al azar, así que no hace falta
 * un generador de IDs ni una fuente de aleatoriedad para mantener la identidad estable.
 */
export function upsertFolder(registry: RecentRegistry, input: { readonly backend: RecentFolderBackend; readonly key: string; readonly name: string }, now: number): RecentRegistry {
  const id = `${input.backend}:${input.key}`;
  const entry: RecentFolderEntry = { id, backend: input.backend, key: input.key, name: input.name, lastUsedAt: now };
  const folders = [entry, ...registry.folders.filter((existing) => existing.id !== id)].slice(0, MAX_ENTRIES);
  return { ...registry, folders };
}

/** Igual que `upsertFolder`, combinando backend + carpeta + `workspaceId` para no confundir homónimos. */
export function upsertProject(registry: RecentRegistry, input: { readonly workspaceId: string; readonly name: string; readonly backend: RecentProjectBackend; readonly folderKey: string | null }, now: number): RecentRegistry {
  const id = `${input.backend}:${input.folderKey ?? 'memory'}:${input.workspaceId}`;
  const entry: RecentProjectEntry = { id, workspaceId: input.workspaceId, name: input.name, backend: input.backend, folderKey: input.folderKey, lastUsedAt: now };
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

/** Más reciente primero; el orden de guardado no es el de presentación (ADR de este módulo). */
export function orderedFolders(registry: RecentRegistry): readonly RecentFolderEntry[] {
  return [...registry.folders].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function orderedProjects(registry: RecentRegistry): readonly RecentProjectEntry[] {
  return [...registry.projects].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}
