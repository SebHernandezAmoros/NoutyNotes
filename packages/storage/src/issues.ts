import type { DomainIssue, DomainIssueCode, ValidationResult } from '@noutynotes/domain';

/** Códigos propios de la frontera de archivos; se suman a los del dominio. */
export type StorageIssueCode =
  | 'invalid-files'
  | 'invalid-path'
  | 'path-collision'
  | 'limit-exceeded'
  | 'invalid-yaml'
  | 'invalid-document'
  | 'missing-file'
  | 'unexpected-file'
  | 'identity-mismatch'
  | 'invalid-link'
  | 'invalid-archive';

export interface StorageIssue {
  readonly code: StorageIssueCode | DomainIssueCode;
  /** Archivo afectado y, tras `#`, la ruta dentro de su contenido cuando aplica. */
  readonly path: string;
  readonly message: string;
}

export type StorageResult<T> = ValidationResult<T, StorageIssue>;

export function storageIssue(code: StorageIssueCode | DomainIssueCode, path: string, message: string): StorageIssue {
  return { code, path, message };
}

export function succeed<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

export function fail<T>(issues: readonly StorageIssue[]): StorageResult<T> {
  return { ok: false, issues };
}

/** Sitúa incidencias de un documento o del dominio bajo una ruta de archivo. */
export function located(issues: readonly (StorageIssue | DomainIssue)[], file: string): StorageIssue[] {
  return issues.map((found) => ({ ...found, path: found.path ? `${file}#${found.path}` : file }));
}
