/**
 * Fecha visible (ADR 0029). Día y hora locales con el desfase del dispositivo (`localDay`/`localTime`,
 * ADR 0024) y meses abreviados propios: sin `Intl`, cuyos datos cambian entre navegadores y Hermes.
 * Idioma de interfaz (ADR 0032/ADR 0040): el orden día/mes cambia con el idioma, no solo las palabras.
 */
import { localDay, localTime } from '@noutynotes/application';
import type { Locale } from '@noutynotes/ui';

import { t } from '../i18n';

const MONTHS: Readonly<Record<Locale, readonly string[]>> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** «26 sep 2026» (es) / «Sep 26, 2026» (en). `offsetMinutes` es `Date.getTimezoneOffset()`. */
export function formatDay(iso: string, offsetMinutes: number, locale: Locale): string {
  const [year, month, day] = localDay(iso, offsetMinutes).split('-').map(Number) as [number, number, number];
  const monthName = MONTHS[locale][month - 1] ?? '';
  return locale === 'es' ? `${day} ${monthName} ${year}` : `${monthName} ${day}, ${year}`;
}

/** Línea del editor: la fecha de creación o, sin ella, por qué no la hay. */
export function formatCreated(iso: string | undefined, offsetMinutes: number, locale: Locale): string {
  if (iso === undefined) return t('inspector.created.none', locale);
  return t('inspector.created.label', locale, { day: formatDay(iso, offsetMinutes, locale), time: localTime(iso, offsetMinutes) });
}
