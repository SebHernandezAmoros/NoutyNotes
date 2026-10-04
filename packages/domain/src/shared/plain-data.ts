import { issue } from '../errors';
import type { DomainIssue } from '../errors';

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Guarda compartida para datos equivalentes a JSON/YAML. No evalúa getters y rechaza funciones,
 * símbolos, clases, ciclos, listas dispersas y propiedades que no puedan persistirse sin pérdida.
 */
export function collectPlainDataIssues(
  value: unknown,
  path: string,
  issues: DomainIssue[],
  seen = new Set<object>(),
  depth = 0,
): void {
  if (depth > 64) {
    issues.push(issue('invalid-value', path, 'La profundidad máxima de datos es 64.'));
    return;
  }
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(issue('invalid-value', path, 'Los números deben ser finitos.'));
    return;
  }
  if (typeof value !== 'object') {
    issues.push(issue('executable-content', path, `Solo se admiten datos; no se admite ${typeof value}.`));
    return;
  }
  if (seen.has(value)) {
    issues.push(issue('invalid-value', path, 'Referencia circular.'));
    return;
  }
  seen.add(value);
  if (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : !isPlainObject(value)) {
    issues.push(issue('executable-content', path, 'Solo se admiten objetos y listas simples.'));
    return;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).filter((key) => key !== 'length').length !== value.length) {
    issues.push(issue('invalid-value', path, 'No se admiten listas dispersas ni propiedades extra.'));
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    const childPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    if (descriptor.get || descriptor.set) {
      issues.push(issue('executable-content', childPath, 'No se admiten propiedades calculadas.'));
      continue;
    }
    if (!descriptor.enumerable || (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || descriptor.value === undefined))) {
      issues.push(issue('invalid-value', childPath, 'La propiedad no se puede representar sin pérdida en JSON.'));
      continue;
    }
    collectPlainDataIssues(descriptor.value, childPath, issues, seen, depth + 1);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push(issue('executable-content', path, 'No se admiten claves de símbolo.'));
  }
  seen.delete(value);
}
