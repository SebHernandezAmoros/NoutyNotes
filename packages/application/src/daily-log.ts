/**
 * Daily Log (ADR 0024). Puro: se deriva de fechas reales (entradas del diario, `createdAt` y `archivedAt`).
 * Una tarjeta sin fecha nunca aparece; ningún recuento sale de otra cosa.
 */
import type { Card, CardTypeDefinition, CardTypeId, FieldKey, Workspace } from '@noutynotes/domain';

import { fold } from './search';

/** Tipo de las entradas del diario: nota con un campo de fecha AAAA-MM-DD. */
export const DIARY_CARD_TYPE: CardTypeDefinition = {
  id: 'diario' as CardTypeId, label: 'Entrada del diario', base: 'note',
  fields: [{ key: 'fecha' as FieldKey, kind: 'date', label: 'Fecha', required: true }],
};

const pad = (value: number) => String(value).padStart(2, '0');
const DAY_MS = 86_400_000;

// Calendario civil sin objetos Date (application no usa el reloj): algoritmo de días civiles de H. Hinnant.
function civilFromDays(days: number): { y: number; m: number; d: number } {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

function daysFromCivil(y: number, m: number, d: number): number {
  const year = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

const format = ({ y, m, d }: { y: number; m: number; d: number }) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

/**
 * Día local (AAAA-MM-DD) de un instante, con el desfase del dispositivo en minutos tal como lo da
 * `Date.getTimezoneOffset()` (positivo al oeste de UTC).
 */
export function localDay(iso: string, offsetMinutes: number): string {
  return format(civilFromDays(Math.floor((Date.parse(iso) - offsetMinutes * 60_000) / DAY_MS)));
}

/** Hora local HH:MM de un instante. */
export function localTime(iso: string, offsetMinutes: number): string {
  const local = Date.parse(iso) - offsetMinutes * 60_000;
  const minutes = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Fecha AAAA-MM-DD válida (calendario real). */
export function isDay(value: unknown): value is string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && format(civilFromDays(daysFromCivil(y, m, d))) === value;
}

/** Día anterior o siguiente. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return format(civilFromDays(daysFromCivil(y, m, d) + delta));
}

export function isDiaryEntry(card: Card): boolean {
  return card.typeId === DIARY_CARD_TYPE.id && typeof card.fields.fecha === 'string';
}

export interface TimedCard {
  readonly card: Card;
  /** HH:MM local. */
  readonly time: string;
}

export interface DailyLog {
  readonly entries: readonly Card[];
  readonly created: readonly TimedCard[];
  readonly archived: readonly TimedCard[];
  readonly summary: {
    readonly entries: number;
    readonly created: number;
    readonly archived: number;
    readonly tags: readonly { readonly tag: string; readonly count: number }[];
  };
}

const byTime = (a: TimedCard, b: TimedCard) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

export function dailyLog(workspace: Workspace, day: string, offsetMinutes: number): DailyLog {
  const entries = workspace.cards.filter((card) => isDiaryEntry(card) && card.fields.fecha === day)
    .sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : fold(a.title ?? '') < fold(b.title ?? '') ? -1 : 1));
  const created = workspace.cards
    .filter((card) => !isDiaryEntry(card) && typeof card.createdAt === 'string' && localDay(card.createdAt, offsetMinutes) === day)
    .map((card) => ({ card, time: localTime(card.createdAt as string, offsetMinutes) })).sort(byTime);
  const archived = (workspace.archive ?? [])
    .filter((entry) => localDay(entry.archivedAt, offsetMinutes) === day)
    .map((entry) => ({ card: entry.card, time: localTime(entry.archivedAt, offsetMinutes) })).sort(byTime);
  const counts = new Map<string, number>();
  for (const card of [...entries, ...created.map((item) => item.card), ...archived.map((item) => item.card)]) {
    for (const tag of card.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  return { entries, created, archived, summary: { entries: entries.length, created: created.length, archived: archived.length, tags } };
}

/** Días del mes (AAAA-MM) con entradas, tarjetas creadas o archivadas. */
export function activeDays(workspace: Workspace, month: string, offsetMinutes: number): Set<string> {
  const days = new Set<string>();
  for (const card of workspace.cards) {
    if (isDiaryEntry(card)) days.add(card.fields.fecha as string);
    else if (typeof card.createdAt === 'string') days.add(localDay(card.createdAt, offsetMinutes));
  }
  for (const entry of workspace.archive ?? []) days.add(localDay(entry.archivedAt, offsetMinutes));
  return new Set([...days].filter((day) => day.startsWith(`${month}-`)));
}
