import { zipSync } from 'fflate';
import type { Workspace } from '@noutynotes/domain';

import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { collectPortablePathIssues } from './paths';
import type { TextFiles } from './text-files';
import { MAX_FILES } from './text-files';
import { parseWorkspace } from './workspace-codec';
import { readZip } from './zip';
import type { ArchiveLimits } from './zip';

export type { ArchiveLimits } from './zip';

const MIB = 1024 * 1024;

/** Límites del fallback ZIP (ADR 0011). */
export const ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 32 * MIB,
  maxEntries: MAX_FILES,
  maxEntryBytes: 16 * MIB,
  maxTotalBytes: 64 * MIB,
};

/** Assets como bytes: nunca se decodifican ni se interpretan. */
export type BinaryAssets = Readonly<Record<string, Uint8Array>>;

export interface WorkspaceArchive {
  readonly workspace: Workspace;
  /** Documentos v1 y README, textos exactos. */
  readonly files: TextFiles;
  readonly assets: BinaryAssets;
}

const ASSETS = 'assets/';
/** Metadatos que escriben los sistemas al comprimir; no forman parte del workspace. */
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
/** Fecha fija (hora local del lector de ZIP): la misma entrada produce los mismos bytes. */
const FIXED_TIME = '1980-01-01T00:00:00';
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function isSystemMetadata(path: string): boolean {
  if (path === '__MACOSX' || path.startsWith('__MACOSX/')) return true;
  return SYSTEM_FILES.has((path.split('/').pop() ?? '').toLowerCase());
}

/** Si todo cuelga de una única carpeta superior y el manifiesto no está en la raíz, la retira. */
function withoutWrapper(paths: readonly string[]): (path: string) => string {
  if (paths.length === 0 || paths.includes('.nouty/workspace.yaml')) return (path) => path;
  const [first] = paths;
  const top = first?.split('/')[0] ?? '';
  const prefix = `${top}/`;
  return paths.every((path) => path.startsWith(prefix)) ? (path) => path.slice(prefix.length) : (path) => path;
}

function collisionIssues(paths: readonly string[]): StorageIssue[] {
  const issues: StorageIssue[] = [];
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push(storageIssue('path-collision', path, previous === path
        ? 'La entrada está repetida en el ZIP.'
        : `Colisiona con "${previous}" en sistemas que no distinguen mayúsculas.`));
    }
    seen.set(key, path);
  }
  return issues;
}

/**
 * Importa un ZIP no confiable como paquete v1: rutas portables sin colisiones, documentos UTF-8
 * validados por el formato y el dominio, y assets como bytes. Nada se guarda: el llamador decide.
 */
export function readWorkspaceArchive(bytes: Uint8Array, limits: ArchiveLimits = ARCHIVE_LIMITS): StorageResult<WorkspaceArchive> {
  const input: unknown = bytes;
  if (!(input instanceof Uint8Array)) return fail([storageIssue('invalid-archive', 'archivo', 'Debe ser el contenido binario de un ZIP.')]);
  const zip = readZip(bytes, limits);
  if (!zip.ok) return zip;

  const issues: StorageIssue[] = [];
  for (const entry of zip.value) {
    const path = entry.directory ? entry.name.slice(0, -1) : entry.name;
    collectPortablePathIssues(path, entry.name, issues);
  }
  if (issues.length > 0) return fail(issues);

  const kept = zip.value.filter((entry) => !entry.directory && !isSystemMetadata(entry.name));
  const strip = withoutWrapper(kept.map((entry) => entry.name));
  const entries = kept.map((entry) => ({ path: strip(entry.name), bytes: entry.bytes }));
  const collisions = collisionIssues(entries.map((entry) => entry.path));
  if (collisions.length > 0) return fail(collisions);

  const texts: [string, string][] = [];
  const assets: [string, Uint8Array][] = [];
  for (const { path, bytes: content } of entries) {
    if (path.startsWith(ASSETS)) {
      assets.push([path, content]);
      continue;
    }
    try {
      texts.push([path, utf8.decode(content)]);
    } catch {
      issues.push(storageIssue('invalid-archive', path, 'El documento no es texto UTF-8 válido.'));
    }
  }
  if (issues.length > 0) return fail(issues);
  const files: TextFiles = Object.fromEntries(texts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const parsed = parseWorkspace(files);
  if (!parsed.ok) return fail(parsed.issues);
  return succeed({ workspace: parsed.value, files, assets: Object.fromEntries(assets) });
}

/**
 * Exporta un paquete v1 y sus assets binarios como ZIP determinista. Rechaza lo que después no
 * podría importarse: paquete inválido, assets fuera de `assets/`, rutas no portables, colisiones
 * o límites superados.
 */
export function writeWorkspaceArchive(files: TextFiles, assets: BinaryAssets): StorageResult<Uint8Array> {
  const parsed = parseWorkspace(files);
  if (!parsed.ok) return fail(parsed.issues);
  const issues: StorageIssue[] = [];
  const assetPaths = Object.keys(assets);
  for (const path of assetPaths) {
    collectPortablePathIssues(path, path, issues);
    if (!path.startsWith(ASSETS)) issues.push(storageIssue('unexpected-file', path, 'Los archivos binarios solo pueden estar bajo assets/.'));
    if (!(assets[path] instanceof Uint8Array)) issues.push(storageIssue('invalid-files', path, 'El asset debe ser binario.'));
  }
  if (issues.length > 0) return fail(issues);
  const collisions = collisionIssues([...Object.keys(files), ...assetPaths]);
  if (collisions.length > 0) return fail(collisions);

  const contents: [string, Uint8Array][] = [
    ...Object.entries(files).map(([path, value]): [string, Uint8Array] => [path, encoder.encode(value)]),
    ...assetPaths.map((path): [string, Uint8Array] => [path, assets[path] as Uint8Array]),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (contents.length > ARCHIVE_LIMITS.maxEntries) return fail([storageIssue('limit-exceeded', 'archivo', `Supera ${ARCHIVE_LIMITS.maxEntries} entradas.`)]);
  let total = 0;
  for (const [path, content] of contents) {
    if (content.length > ARCHIVE_LIMITS.maxEntryBytes) issues.push(storageIssue('limit-exceeded', path, `Supera ${ARCHIVE_LIMITS.maxEntryBytes} bytes.`));
    total += content.length;
  }
  if (issues.length > 0) return fail(issues);
  if (total > ARCHIVE_LIMITS.maxTotalBytes) return fail([storageIssue('limit-exceeded', 'archivo', `Supera ${ARCHIVE_LIMITS.maxTotalBytes} bytes en total.`)]);

  // Object.fromEntries conserva el orden de inserción para rutas no numéricas.
  const zipped = zipSync(Object.fromEntries(contents.map(([path, content]) => [path, content])), { level: 6, mtime: FIXED_TIME });
  if (zipped.length > ARCHIVE_LIMITS.maxArchiveBytes) return fail([storageIssue('limit-exceeded', 'archivo', `El ZIP superaría ${ARCHIVE_LIMITS.maxArchiveBytes} bytes.`)]);
  return succeed(zipped);
}
