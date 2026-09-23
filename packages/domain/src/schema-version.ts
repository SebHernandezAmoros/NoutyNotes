import { issue } from './errors';
import type { DomainIssue } from './errors';

/**
 * Versión del modelo de un workspace completo (workspace, boards, cards, tipos, relaciones y
 * layouts) y, por separado, del manifiesto de plantilla. Es un entero por documento raíz, no
 * por entidad. Las versiones futuras se migrarán antes de validar; fase 1 solo admite la 1.
 */
export const CURRENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [CURRENT_SCHEMA_VERSION];

export function isSupportedSchemaVersion(value: unknown): value is number {
  return typeof value === 'number' && SUPPORTED_SCHEMA_VERSIONS.includes(value);
}

export function checkSchemaVersion(value: unknown, path: string, issues: DomainIssue[]): boolean {
  if (isSupportedSchemaVersion(value)) return true;
  issues.push(issue('unsupported-schema-version', path,
    `Versión de esquema no admitida: ${String(value)}. Admitidas: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`));
  return false;
}
