import { describe, expect, it } from 'vitest';

import type { Card, CardTypeDefinition, Workspace } from '@noutynotes/domain';

import { archiveSelectionForExport } from './archive-export';

const card = (id: string, extra: Record<string, unknown>): Card => ({ id, typeId: 'nota', title: id, fields: {}, ...extra }) as unknown as Card;
const noteType: CardTypeDefinition = { id: 'nota', label: 'Nota', base: 'note', fields: [] } as unknown as CardTypeDefinition;

const workspace = {
  id: 'w', schemaVersion: 1, metadata: { name: 'Proyecto' }, relationTypes: [{ id: 'ref', label: 'Referencia' }],
  cardTypes: [noteType], relations: [], layouts: [], cards: [], boards: [],
  archive: [
    {
      card: card('a', { title: 'Una', assetRefs: ['assets/images/a.png'] }), boards: [], placements: [],
      relations: [{ id: 'r1', typeId: 'ref', from: 'a', to: 'b' }], archivedAt: '2026-09-26T10:00:00.000Z',
    },
    {
      card: card('b', { title: 'Dos' }), boards: [], placements: [],
      relations: [{ id: 'r1', typeId: 'ref', from: 'a', to: 'b' }], archivedAt: '2026-09-26T10:05:00.000Z',
    },
    { card: card('c', { title: 'Tres, fuera de la selección' }), boards: [], placements: [], relations: [], archivedAt: '2026-09-26T10:10:00.000Z' },
  ],
} as unknown as Workspace;

describe('Exportar una selección del Archivo (ADR 0039)', () => {
  it('arma un workspace autocontenido con las tarjetas elegidas, su relación mutua (sin duplicarla) y solo sus assets', () => {
    const result = archiveSelectionForExport(workspace, ['a' as never, 'b' as never]);
    if (!result.ok) throw new Error(result.reason);
    const { workspace: exported, assetRefs } = result.value;
    expect(exported.cards.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(exported.boards).toHaveLength(1);
    expect([...(exported.boards[0]?.cardIds ?? [])].sort()).toEqual(['a', 'b']);
    expect(exported.relations).toEqual([{ id: 'r1', typeId: 'ref', from: 'a', to: 'b' }]);
    expect(assetRefs).toEqual(['assets/images/a.png']);
    // No incluye lo que no se eligió.
    expect(exported.cards.some((c) => c.id === 'c')).toBe(false);
  });

  it('sin selección o con una tarjeta que ya no está en el Archivo, falla con un motivo claro', () => {
    expect(archiveSelectionForExport(workspace, [])).toMatchObject({ ok: false });
    expect(archiveSelectionForExport(workspace, ['no-existe' as never])).toMatchObject({ ok: false });
  });
});
