import { collectPlainDataIssues, isSupportedSchemaVersion } from '@noutynotes/domain';
import type { DomainIssue } from '@noutynotes/domain';
import type { z } from 'zod';

import { fail, located, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { validateTextFiles } from './text-files';
import type { TextFiles } from './text-files';
import { parseYaml, stringifyYaml } from './yaml';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(prefix: string, segments: readonly PropertyKey[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number') return `${path}[${segment}]`;
    return path ? `${path}.${String(segment)}` : String(segment);
  }, prefix);
}

/** Traduce incidencias de Zod: claves desconocidas por separado, el resto como valor inválido. */
export function zodIssues(error: z.ZodError, prefix = ''): StorageIssue[] {
  return error.issues.flatMap((found) => {
    const path = joinPath(prefix, found.path);
    if (found.code === 'unrecognized_keys') {
      return found.keys.map((key) => storageIssue('unknown-property', path ? `${path}.${key}` : key, `Propiedad no admitida: "${key}".`));
    }
    return [storageIssue('invalid-value', path, found.message)];
  });
}

/** Aplica un esquema cerrado a datos ya comprobados como inertes. */
export function checkShape<T>(schema: z.ZodType<T>, data: unknown, prefix = ''): StorageResult<T> {
  const parsed = schema.safeParse(data);
  return parsed.success ? succeed(parsed.data) : fail(zodIssues(parsed.error, prefix));
}

/**
 * Primera barrera de toda entrada en memoria: solo datos equivalentes a JSON/YAML, sin ejecutar
 * getters, sin funciones, ciclos ni arrays dispersos y con profundidad máxima 64.
 */
export function plainDataIssues(value: unknown, path: string): DomainIssue[] {
  const issues: DomainIssue[] = [];
  collectPlainDataIssues(value, path, issues);
  return issues;
}

/**
 * Lee un documento YAML versionado: YAML estricto, objeto raíz, `schemaVersion` admitida y forma
 * cerrada. Las incidencias quedan situadas en `file#ruta`.
 */
export function readVersionedYaml<T>(text: string, file: string, schema: z.ZodType<T>, allowedVersions: readonly number[] = [1]): StorageResult<T> {
  const parsed = parseYaml(text, file);
  if (!parsed.ok) return parsed;
  return checkVersionedData(parsed.value, file, schema, allowedVersions);
}

export function checkVersionedData<T>(data: unknown, file: string, schema: z.ZodType<T>, allowedVersions: readonly number[] = [1]): StorageResult<T> {
  if (!isObject(data)) return fail([storageIssue('invalid-document', file, 'El documento debe ser un objeto YAML.')]);
  if (!(allowedVersions.length === 1 && allowedVersions[0] === 1 ? isSupportedSchemaVersion(data.schemaVersion) : allowedVersions.includes(data.schemaVersion as number))) {
    return fail([storageIssue('unsupported-schema-version', `${file}#schemaVersion`,
      `Versión de esquema no admitida: ${JSON.stringify(data.schemaVersion) ?? 'ausente'}. Versiones admitidas: ${allowedVersions.join(', ')}.`)]);
  }
  const shaped = checkShape(schema, data);
  return shaped.ok ? shaped : fail(located(shaped.issues, file));
}

/** Copia de datos ya validados sin propiedades `undefined` (equivalen a ausencia). */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => compact(item)) as T;
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, compact(child)])) as T;
  }
  return value;
}

/** Documento generado y su clave semántica, que decide si se reutilizan los bytes anteriores. */
export interface GeneratedDocument {
  readonly text: string;
  readonly key: string;
}

/** Documento YAML canónico: su propio texto es la clave semántica. */
export function yamlDocument(data: unknown): GeneratedDocument {
  const text = stringifyYaml(data);
  return { text, key: text };
}

/** Paquete anterior ya validado: archivos, extras admitidos y sus documentos regenerados. */
export interface PreviousPackage {
  readonly files: TextFiles;
  readonly extras: ReadonlyMap<string, string>;
  readonly documents: ReadonlyMap<string, GeneratedDocument>;
}

/**
 * Une los documentos nuevos con el paquete anterior: reutiliza los bytes de cada documento cuya
 * clave semántica no cambió, omite los que ya no existen y conserva los extras admitidos. Valida
 * límites y rutas del resultado.
 */
export function mergeWithPrevious(documents: ReadonlyMap<string, GeneratedDocument>, previous?: PreviousPackage): StorageResult<TextFiles> {
  const entries: [string, string][] = [];
  for (const [path, generated] of documents) {
    const reused = previous?.files[path];
    entries.push([path, reused !== undefined && previous?.documents.get(path)?.key === generated.key ? reused : generated.text]);
  }
  for (const [path, text] of previous?.extras ?? []) entries.push([path, text]);
  return validateTextFiles(Object.fromEntries(entries));
}

/** Sitúa las incidencias de un paquete anterior inválido. */
export function previousFilesIssues(issues: readonly StorageIssue[]): StorageIssue[] {
  return issues.map((found) => ({ ...found, path: `previousFiles:${found.path}` }));
}

/** Informa IDs repetidos dentro de una lista de un documento. */
export function duplicateIdIssues(ids: readonly string[], path: string, scope: string): StorageIssue[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    const repeated = seen.has(id);
    seen.add(id);
    return repeated ? [storageIssue('duplicate-id', `${path}[${index}]`, `"${id}" está repetido en ${scope}.`)] : [];
  });
}

/** Sustituye el prefijo que usan los validadores individuales del dominio (`relation.x`). */
export function reprefix(issues: readonly DomainIssue[], from: string, to: string): DomainIssue[] {
  return issues.map((found) => ({
    ...found,
    path: found.path === from ? to : found.path.startsWith(`${from}.`) ? `${to}${found.path.slice(from.length)}` : found.path,
  }));
}
