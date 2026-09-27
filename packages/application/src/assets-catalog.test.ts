import { describe, expect, it } from 'vitest';

import type { Card, CardTypeDefinition, Workspace } from '@noutynotes/domain';

import { assetKind, buildAssetCatalog, replaceAssetReferences } from './assets-catalog';

const type = (id: string, base: CardTypeDefinition['base'], fields: CardTypeDefinition['fields'] = []): CardTypeDefinition =>
  ({ id: id as CardTypeDefinition['id'], label: id, base, fields });
const card = (id: string, typeId: string, extra: Record<string, unknown> = {}): Card => ({ id, typeId, title: id, fields: {}, ...extra }) as unknown as Card;

const workspace = {
  id: 'w', metadata: { name: 'W' }, relationTypes: [], relations: [], layouts: [],
  cardTypes: [type('imagen', 'image'), type('nota', 'note'), type('ficha', 'note', [{ key: 'adjunto', kind: 'asset' } as CardTypeDefinition['fields'][number]])],
  boards: [{ id: 'principal', title: 'Principal', cardIds: ['foto', 'diario', 'ficha'] }],
  cards: [
    card('foto', 'imagen', { assetRefs: ['assets/images/foto.png'] }),
    card('diario', 'nota', { content: 'Hoy.\n\n![foto](assets/images/foto.png)\n\n![mapa](assets/images/mapa.jpg)', assetRefs: ['assets/images/foto.png', 'assets/images/mapa.jpg'] }),
    card('ficha', 'ficha', { fields: { adjunto: 'assets/files/guion.pdf' } }),
  ],
  trash: [{ card: card('vieja', 'imagen', { assetRefs: ['assets/images/vieja.webp'] }), trashedAt: '2026-09-26T00:00:00Z', boards: [], relations: [] }],
} as unknown as Workspace;

describe('catálogo de assets del proyecto (ADR 0022)', () => {
  it('clasifica por extensión', () => {
    expect(['a.PNG', 'b.jpeg', 'c.svg', 'd.pdf', 'e.md', 'f.mp3', 'g.m4a', 'h.zip'].map((name) => assetKind(`assets/x/${name}`)))
      .toEqual(['image', 'image', 'image', 'document', 'document', 'audio', 'audio', 'other']);
  });

  it('reúne lo que hay en disco y lo referenciado: «Usado en» (también Papelera), falta y sin usar', () => {
    const catalog = buildAssetCatalog(workspace, ['assets/images/foto.png', 'assets/images/mapa.jpg', 'assets/images/huerfana.gif', 'assets/images/vieja.webp']);
    expect(catalog.map((entry) => [entry.ref, entry.kind, entry.missing, entry.unused, entry.usedBy.map((use) => `${use.cardId}${use.inTrash ? '*' : ''}`)])).toEqual([
      ['assets/files/guion.pdf', 'document', true, false, ['ficha']],
      ['assets/images/foto.png', 'image', false, false, ['diario', 'foto']],
      ['assets/images/huerfana.gif', 'image', false, true, []],
      ['assets/images/mapa.jpg', 'image', false, false, ['diario']],
      ['assets/images/vieja.webp', 'image', false, false, ['vieja*']],
    ]);
    expect(catalog.find((entry) => entry.ref === 'assets/images/foto.png')?.usedBy[0]?.boards).toEqual([{ boardId: 'principal', title: 'Principal' }]);
  });

  it('reemplazar cambia todas las referencias (assetRefs, campos, líneas de la nota y Papelera) sin tocar el resto del texto', () => {
    const next = replaceAssetReferences(workspace, 'assets/images/foto.png', 'assets/images/foto-2.png');
    const diario = next.cards.find((candidate) => candidate.id === 'diario')!;
    expect(diario.content).toBe('Hoy.\n\n![foto](assets/images/foto-2.png)\n\n![mapa](assets/images/mapa.jpg)');
    expect(diario.assetRefs).toEqual(['assets/images/foto-2.png', 'assets/images/mapa.jpg']);
    expect(next.cards.find((candidate) => candidate.id === 'foto')!.assetRefs).toEqual(['assets/images/foto-2.png']);
    const byField = replaceAssetReferences(workspace, 'assets/files/guion.pdf', 'assets/files/guion-v2.pdf');
    expect(byField.cards.find((candidate) => candidate.id === 'ficha')!.fields).toEqual({ adjunto: 'assets/files/guion-v2.pdf' });
    // Una tarjeta que no lo usa conserva exactamente el mismo objeto.
    expect(byField.cards.find((candidate) => candidate.id === 'diario')).toBe(workspace.cards[1]);
    const inTrash = replaceAssetReferences(workspace, 'assets/images/vieja.webp', 'assets/images/nueva.webp');
    expect(inTrash.trash?.[0]?.card.assetRefs).toEqual(['assets/images/nueva.webp']);
  });
});
