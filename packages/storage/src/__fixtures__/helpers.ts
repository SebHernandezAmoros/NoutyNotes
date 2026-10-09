// Utilidades de prueba del paquete storage; no se exportan.
import type { IssueLike, ValidationResult } from '@noutynotes/domain';

/** Incidencias como `código@ruta`, legibles en las expectativas. */
export function problems(result: ValidationResult<unknown, IssueLike>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

export function valueOf<T>(result: ValidationResult<T, IssueLike>): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result.issues)}`);
  return result.value;
}

/** Datos que el tipo no admitiría, como llegarían desde fuera. */
export function unsafe<T>(value: unknown): T {
  return value as T;
}
