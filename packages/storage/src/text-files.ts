import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { collectPortablePathIssues } from './paths';

/** Paquete de archivos de texto en memoria: ruta relativa portable → contenido UTF-8 lógico. */
export type TextFiles = Readonly<Record<string, string>>;

export const MAX_FILES = 10_000;
export const MAX_TEXT_LENGTH = 2_000_000;
export const MAX_DATA_DEPTH = 64;

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Valida el contenedor sin ejecutar getters: límites, rutas portables, contenidos de texto y
 * colisiones ignorando mayúsculas. Devuelve una copia con las rutas en orden determinista.
 */
export function validateTextFiles(files: unknown): StorageResult<TextFiles> {
  if (!isPlainObject(files)) return fail([storageIssue('invalid-files', 'files', 'Debe ser un objeto de ruta → texto.')]);
  if (Object.getOwnPropertySymbols(files).length > 0) {
    return fail([storageIssue('invalid-files', 'files', 'No admite claves de símbolo.')]);
  }
  const paths = Object.getOwnPropertyNames(files);
  if (paths.length > MAX_FILES) return fail([storageIssue('limit-exceeded', 'files', `Supera ${MAX_FILES} archivos.`)]);

  const issues: StorageIssue[] = [];
  const entries: [string, string][] = [];
  const seen = new Map<string, string>();
  for (const path of [...paths].sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(files, path);
    const text: unknown = descriptor?.value;
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof text !== 'string') {
      issues.push(storageIssue('invalid-files', path, 'El contenido debe ser un texto almacenado, no calculado.'));
      continue;
    }
    collectPortablePathIssues(path, path, issues);
    if (text.length > MAX_TEXT_LENGTH) issues.push(storageIssue('limit-exceeded', path, `Supera ${MAX_TEXT_LENGTH} caracteres.`));
    const key = path.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push(storageIssue('path-collision', path, `Colisiona con "${previous}" en sistemas que no distinguen mayúsculas.`));
    }
    seen.set(key, path);
    entries.push([path, text]);
  }
  // Object.fromEntries crea propiedades propias incluso para rutas como "__proto__".
  return issues.length > 0 ? fail(issues) : succeed(Object.fromEntries(entries));
}
