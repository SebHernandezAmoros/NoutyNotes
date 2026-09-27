/**
 * Fecha visible (ADR 0029). Día y hora locales con el desfase del dispositivo (`localDay`/`localTime`,
 * ADR 0024) y meses abreviados propios: sin `Intl`, cuyos datos cambian entre navegadores y Hermes.
 */
import { localDay, localTime } from '@noutynotes/application';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

/** «26 sep 2026». `offsetMinutes` es `Date.getTimezoneOffset()`. */
export function formatDay(iso: string, offsetMinutes: number): string {
  const [year, month, day] = localDay(iso, offsetMinutes).split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ''} ${year}`;
}

/** Línea del editor: la fecha de creación o, sin ella, por qué no la hay. */
export function formatCreated(iso: string | undefined, offsetMinutes: number): string {
  if (iso === undefined) return 'Sin fecha de creación: es anterior a esta versión';
  return `Creada el ${formatDay(iso, offsetMinutes)}, ${localTime(iso, offsetMinutes)}`;
}
