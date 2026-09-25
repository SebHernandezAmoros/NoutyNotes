import { ID_MAX_LENGTH } from '@noutynotes/domain';
import type { WorkspaceId } from '@noutynotes/domain';

/**
 * Generación determinista de IDs fuera del dominio (ADR 0009): el dominio nunca los genera. Sin
 * reloj ni aleatoriedad, el mismo estado produce siempre el mismo ID.
 */

const FALLBACK_WORKSPACE_ID = 'espacio';

/** `prefijo-N` con el menor N ≥ 1 que no esté ocupado. */
export function nextSequentialId(prefix: string, taken: readonly string[]): string {
  const used = new Set(taken);
  let number = 1;
  while (used.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

/** Minúsculas ASCII sin diacríticos; el resto de caracteres se convierte en separadores. */
function slug(name: unknown): string {
  if (typeof name !== 'string') return FALLBACK_WORKSPACE_ID;
  // Rango de diacríticos combinantes, sin escapes de propiedades Unicode (compatibles con Hermes).
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const joined = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return joined === '' ? FALLBACK_WORKSPACE_ID : joined;
}

/**
 * ID de workspace legible derivado del nombre: `Mis ideas` → `mis-ideas`. Si está ocupado añade
 * `-2`, `-3`… sin superar la longitud máxima. Siempre es un ID válido.
 */
export function workspaceIdFromName(name: string, taken: readonly string[]): WorkspaceId {
  const base = slug(name);
  const used = new Set(taken);
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? '' : `-${number}`;
    const head = base.slice(0, ID_MAX_LENGTH - suffix.length).replace(/-+$/, '');
    const candidate = `${head}${suffix}`;
    if (!used.has(candidate)) return candidate as WorkspaceId;
  }
}
