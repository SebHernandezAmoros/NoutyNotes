// Utilidades de prueba del paquete storage; no se exportan.
import type { StorageResult } from '../issues';

/** Incidencias como `código@ruta`, legibles en las expectativas. */
export function problems(result: StorageResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

export function valueOf<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result.issues)}`);
  return result.value;
}

/** Datos que el tipo no admitiría, como llegarían desde fuera. */
export function unsafe<T>(value: unknown): T {
  return value as T;
}
