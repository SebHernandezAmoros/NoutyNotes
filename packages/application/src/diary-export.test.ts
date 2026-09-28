import { describe, expect, it } from 'vitest';

import type { Card, CardTypeDefinition, Workspace } from '@noutynotes/domain';

import { diaryExportText } from './diary-export';

const card = (id: string, extra: Record<string, unknown>): Card => ({ id, typeId: 'nota', title: id, fields: {}, ...extra }) as unknown as Card;
const entry = (id: string, fecha: string, extra: Record<string, unknown> = {}): Card => card(id, { typeId: 'diario', fields: { fecha }, ...extra });
const madrid = -120;

const workspace = {
  id: 'w', schemaVersion: 1, metadata: { name: 'W' }, relationTypes: [], relations: [], layouts: [],
  cardTypes: [{ id: 'nota', label: 'Nota', base: 'note', fields: [] } as unknown as CardTypeDefinition, { id: 'diario', label: 'Entrada del diario', base: 'note', fields: [] } as unknown as CardTypeDefinition],
  boards: [{ id: 'principal', title: 'Principal', cardIds: ['a'] }],
  cards: [
    card('a', { createdAt: '2026-09-26T08:30:00.000Z', tags: ['viaje'] }),
    entry('d1', '2026-09-26', { title: 'Hoy', content: 'Buen día en Madrid.', createdAt: '2026-09-26T18:00:00.000Z' }),
  ],
  archive: [],
} as unknown as Workspace;

describe('Exportación del Diario (ADR 0037)', () => {
  it('arma un documento Markdown con lo del rango, agrupado por día', () => {
    const result = diaryExportText(workspace, '2026-09-26', '2026-09-26', madrid);
    if (!result.ok) throw new Error('se esperaba un documento válido');
    expect(result.text).toContain('## 2026-09-26');
    expect(result.text).toContain('10:30 · Creada · NOTA · a');
    expect(result.text).toContain('20:00 · Entrada · ENTRADA DEL DIARIO · Hoy');
    expect(result.text).toContain('Buen día en Madrid.');
    expect(result.text).toContain('#viaje');
  });

  it('un rango sin datos lo dice explícitamente, no una plantilla vacía ambigua', () => {
    const result = diaryExportText(workspace, '2020-01-01', '2020-01-01', madrid);
    if (!result.ok) throw new Error('se esperaba un documento válido');
    expect(result.text).toContain('Sin datos en este rango.');
  });

  it('un rango inválido falla igual que dailyLogRange', () => {
    expect(diaryExportText(workspace, '2026-09-27', '2026-09-25', madrid)).toMatchObject({ ok: false });
  });
});
