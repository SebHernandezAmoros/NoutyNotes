/** Etiquetas `#` de tarjetas (ADR 0019). Puro: normalización, validación y listas ordenadas. */
import { failure, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';

export const MAX_TAG_LENGTH = 40;
/** Letras y números de cualquier idioma, `-`, `_` y `/` interior (jerarquías como `viaje/japón`). */
const TAG_PATTERN = /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u;

/** Convierte lo que escribe la persona (`#Idea `) en el nombre normalizado (`idea`), o explica el problema. */
export function normalizeTag(input: string): ValidationResult<string> {
  const name = input.normalize('NFC').trim().replace(/^#+/, '').toLowerCase();
  if (name === '') return failure([issue('invalid-value', 'tag', 'Escribe un nombre para la etiqueta.')]);
  if ([...name].length > MAX_TAG_LENGTH) return failure([issue('invalid-value', 'tag', `Una etiqueta tiene como máximo ${MAX_TAG_LENGTH} caracteres.`)]);
  if (!TAG_PATTERN.test(name)) {
    return failure([issue('invalid-value', 'tag', 'Usa letras, números, «-», «_» o «/» entre palabras, sin espacios.')]);
  }
  return resultOf(name, []);
}

/** El nombre ya está normalizado (así se guarda en la tarjeta). */
export function isNormalizedTag(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeTag(value);
  return normalized.ok && normalized.value === value;
}

const sorted = (tags: Iterable<string>): string[] => [...new Set(tags)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Añade una etiqueta ya normalizada: sin duplicados y en orden. */
export function withTag(tags: readonly string[], tag: string): string[] {
  return sorted([...tags, tag]);
}

export function withoutTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((candidate) => candidate !== tag);
}

/** Etiquetas de una tarjeta: lista de nombres normalizados, únicos y ordenados. */
export function collectTagIssues(tags: unknown, path: string, issues: DomainIssue[]): void {
  if (tags === undefined) return;
  if (!Array.isArray(tags)) {
    issues.push(issue('invalid-value', path, 'Debe ser una lista de etiquetas.'));
    return;
  }
  const before = issues.length;
  tags.forEach((tag, index) => {
    if (!isNormalizedTag(tag)) issues.push(issue('invalid-value', `${path}[${index}]`, 'Etiqueta no normalizada: minúsculas, sin «#» ni espacios.'));
  });
  if (issues.length > before) return;
  const canonical = sorted(tags as string[]);
  if (canonical.length !== tags.length || canonical.some((tag, index) => tag !== tags[index])) {
    issues.push(issue('invalid-value', path, 'Las etiquetas deben ser únicas y estar en orden alfabético.'));
  }
}
