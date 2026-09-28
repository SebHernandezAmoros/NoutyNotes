import { describe, expect, it } from 'vitest';

import type { Card, CardTypeDefinition, Workspace } from '@noutynotes/domain';

import { DIARY_CARD_TYPE, activeDays, dailyLog, dailyLogRange, isDay, localDay, shiftDay } from './daily-log';

const card = (id: string, extra: Record<string, unknown>): Card => ({ id, typeId: 'nota', title: id, fields: {}, ...extra }) as unknown as Card;
const entry = (id: string, fecha: string, extra: Record<string, unknown> = {}): Card => card(id, { typeId: 'diario', fields: { fecha }, ...extra });
// Madrid en verano: UTC+2 (getTimezoneOffset = -120).
const madrid = -120;

const workspace = {
  id: 'w', schemaVersion: 1, metadata: { name: 'W' }, relationTypes: [], relations: [], layouts: [],
  cardTypes: [{ id: 'nota', label: 'Nota', base: 'note', fields: [] } as unknown as CardTypeDefinition, DIARY_CARD_TYPE],
  boards: [{ id: 'principal', title: 'Principal', cardIds: ['a', 'b'] }],
  cards: [
    card('a', { createdAt: '2026-09-26T08:30:00.000Z', tags: ['viaje'], content: 'Salida temprano.' }),
    // 23:30 UTC del 25 son las 01:30 del 26 en Madrid: cuenta como el 26.
    card('b', { createdAt: '2026-09-25T23:30:00.000Z', tags: ['viaje', 'tren'] }),
    card('antigua', {}),
    entry('d1', '2026-09-26', { title: 'Hoy', content: 'Buen día.', createdAt: '2026-09-26T18:00:00.000Z' }),
    entry('d2', '2026-09-27'),
  ],
  archive: [{ card: card('vieja', { tags: ['viaje'] }), boards: [], placements: [], relations: [], archivedAt: '2026-09-26T12:00:00.000Z' }],
} as unknown as Workspace;

describe('Daily Log (ADR 0024)', () => {
  it('el día local sale de la zona horaria del dispositivo', () => {
    expect(localDay('2026-09-25T23:30:00.000Z', madrid)).toBe('2026-09-26');
    expect(localDay('2026-09-25T23:30:00.000Z', 0)).toBe('2026-09-25');
    // Calendario sin Date: bisiestos, fin de año y fechas imposibles.
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect([isDay('2024-02-29'), isDay('2026-02-29'), isDay('2026-13-01'), isDay('26/09/2026')]).toEqual([true, false, false, false]);
  });

  it('entradas, tarjetas creadas y archivadas del día, en orden, y resumen solo con datos reales', () => {
    const log = dailyLog(workspace, '2026-09-26', madrid);
    expect(log.entries.map((item) => item.id)).toEqual(['d1']);
    // Las entradas del diario no se repiten como «creadas»; una tarjeta sin fecha nunca aparece.
    expect(log.created.map((item) => [item.card.id, item.time])).toEqual([['b', '01:30'], ['a', '10:30']]);
    expect(log.archived.map((item) => [item.card.id, item.time])).toEqual([['vieja', '14:00']]);
    expect(log.summary).toEqual({ entries: 1, created: 2, archived: 1, tags: [{ tag: 'viaje', count: 3 }, { tag: 'tren', count: 1 }] });
    const empty = dailyLog(workspace, '2026-01-01', madrid);
    expect(empty.summary).toEqual({ entries: 0, created: 0, archived: 0, tags: [] });
  });

  it('el calendario marca solo los días con datos del mes', () => {
    expect([...activeDays(workspace, '2026-09', madrid)].sort()).toEqual(['2026-09-26', '2026-09-27']);
    expect([...activeDays(workspace, '2026-10', madrid)]).toEqual([]);
  });

  it('rango de días (ADR 0037): agrupa varios días en orden cronológico y rechaza rangos inválidos', () => {
    const range = dailyLogRange(workspace, '2026-09-25', '2026-09-27', madrid);
    if (!range.ok) throw new Error('se esperaba un rango válido');
    expect(range.items.map((item) => [item.day, item.time, item.kind, item.card.id, item.boardIds])).toEqual([
      ['2026-09-26', '01:30', 'created', 'b', ['principal']],
      ['2026-09-26', '10:30', 'created', 'a', ['principal']],
      ['2026-09-26', '14:00', 'archived', 'vieja', []],
      ['2026-09-26', '20:00', 'entry', 'd1', []],
      ['2026-09-27', '00:00', 'entry', 'd2', []],
    ]);
    // Un solo día es un rango de un elemento; fuera de rango da una lista vacía, no un error.
    const single = dailyLogRange(workspace, '2026-01-01', '2026-01-01', madrid);
    expect(single.ok && single.items).toEqual([]);
    expect(dailyLogRange(workspace, '2026-09-27', '2026-09-25', madrid)).toMatchObject({ ok: false });
    expect(dailyLogRange(workspace, '2026-01-01', '2027-01-02', madrid)).toMatchObject({ ok: false });
    expect(dailyLogRange(workspace, 'no-es-fecha', '2026-09-27', madrid)).toMatchObject({ ok: false });
  });
});
