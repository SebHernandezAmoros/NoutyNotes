import { issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';

declare const assetRefKind: unique symbol;

/**
 * Ruta relativa a la raíz del workspace, con `/` como separador (`assets/images/hero.png`).
 * El dominio solo valida su forma: no comprueba que el archivo exista ni lo lee. Convertirla
 * en enlaces relativos a cada archivo Markdown corresponde a la serialización (fase 5).
 */
export type AssetRef = string & { readonly [assetRefKind]: true };

export const ASSET_REF_MAX_LENGTH = 512;

function assetRefProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Debe ser una ruta relativa no vacía.';
  if (value.length > ASSET_REF_MAX_LENGTH) return `Supera ${ASSET_REF_MAX_LENGTH} caracteres.`;
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'Contiene caracteres de control.';
  if (value.includes('\\')) return 'Usa "/" como separador.';
  if (value.startsWith('/')) return 'Debe ser relativa, no absoluta.';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return 'No admite esquemas, URLs ni letras de unidad.';
  const segments = value.split('/');
  if (segments.some((segment) => segment === '')) return 'Contiene segmentos vacíos.';
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'No admite "." ni ".."; debe permanecer dentro del workspace sin ambigüedad.';
  }
  if (segments.some((segment) => segment.trim() !== segment)) return 'Los segmentos no pueden empezar ni terminar con espacios.';
  return null;
}

export function isValidAssetRef(value: unknown): value is AssetRef {
  return assetRefProblem(value) === null;
}

export function checkAssetRef(value: unknown, path: string, issues: DomainIssue[]): void {
  const problem = assetRefProblem(value);
  if (problem) issues.push(issue('invalid-asset-ref', path, problem));
}

export function parseAssetRef(value: unknown, path = 'assetRef'): ValidationResult<AssetRef> {
  const issues: DomainIssue[] = [];
  checkAssetRef(value, path, issues);
  return resultOf(value as AssetRef, issues);
}
