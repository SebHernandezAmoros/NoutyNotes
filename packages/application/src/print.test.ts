import { describe, expect, it } from 'vitest';

import type { BoardId, Card, CardId, CardTypeDefinition, RelationId, RelationTypeId, Workspace } from '@noutynotes/domain';

import { printableDocument } from './print';

const board = 'principal' as BoardId;
const card = (id: string, extra: Record<string, unknown> = {}): Card => ({ id, typeId: 'nota', title: id, fields: {}, content: '', ...extra }) as unknown as Card;
const place = (cardId: string, x: number, y: number, w = 4, h = 3, display: 'expanded' | 'minimized' | 'collapsed' = 'expanded') =>
  ({ cardId: cardId as CardId, rect: { x, y, w, h }, display });

const workspace: Workspace = {
  id: 'w', schemaVersion: 1, metadata: { name: 'W' },
  cardTypes: [
    { id: 'nota', label: 'Nota', base: 'note', fields: [] } as unknown as CardTypeDefinition,
    { id: 'imagen', label: 'Imagen', base: 'image', fields: [] } as unknown as CardTypeDefinition,
  ],
  relationTypes: [{ id: 'relacionada' as RelationTypeId, label: 'Relacionada con' }],
  relations: [{ id: 'r1' as RelationId, typeId: 'relacionada' as RelationTypeId, from: 'b' as CardId, to: 'a' as CardId }],
  boards: [{ id: board, title: 'Principal', cardIds: ['a', 'b', 'sin-sitio', 'imagen-1'] }],
  layouts: [{
    boardId: board,
    // b está más abajo que a pero en la misma columna; c está en la fila de a pero a la derecha: orden esperado a, c, b.
    placements: [place('a', 0, 0), place('c', 8, 0), place('b', 0, 3), place('minimizada', 4, 6, 4, 3, 'minimized'), place('imagen-1', 0, 10, 4, 3)],
  }],
  cards: [
    // assetRefs ya trae la misma imagen (así la mantiene sincronizada la edición, ADR 0021): no debe duplicarse.
    card('a', { title: 'A', content: 'Texto de A.\n\n![foto](assets/images/x.png)\n\nMás texto.', tags: ['viaje'], assetRefs: ['assets/images/x.png'], titleSize: 'large', bodySize: 'small', captionPosition: 'left' }),
    card('c', { title: 'C' }),
    card('b', { title: 'B' }),
    card('minimizada', { title: 'Minimizada' }),
    card('sin-sitio', { title: 'Sin sitio' }),
    card('imagen-1', { typeId: 'imagen', title: 'Foto', assetRefs: ['assets/images/foto.png'] }),
  ],
} as unknown as Workspace;

describe('Imprimir y presentar (ADR 0031)', () => {
  it('el orden de lectura es por fila y columna; lo minimizado cuenta por su huella y lo sin sitio no aparece', () => {
    const doc = printableDocument(workspace, board);
    expect(doc.map((entry) => entry.id)).toEqual(['a', 'c', 'b', 'minimizada', 'imagen-1']);
    expect(doc.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('cada entrada lleva tipo, contenido completo, etiquetas, sus imágenes en orden y sus conexiones en texto', () => {
    const [a, , b, , imagen] = printableDocument(workspace, board);
    expect(a).toMatchObject({ id: 'a', title: 'A', typeLabel: 'Nota', tags: ['viaje'], imageRefs: ['assets/images/x.png'] });
    expect(a?.content).toContain('Texto de A');
    // La relación va de B a A: A la recibe («from», llega de B) y B la envía («to», va hacia A).
    expect(a?.connections).toEqual([{ direction: 'from', label: 'Relacionada con', otherTitle: 'B' }]);
    expect(b?.connections).toEqual([{ direction: 'to', label: 'Relacionada con', otherTitle: 'A' }]);
    expect(imagen).toMatchObject({ typeLabel: 'Imagen', imageRefs: ['assets/images/foto.png'] });
  });

  it('lleva el tamaño de título/cuerpo de la tarjeta (ADR 0050); ausente cuando la tarjeta no lo tiene', () => {
    const [a, c] = printableDocument(workspace, board);
    expect(a).toMatchObject({ titleSize: 'large', bodySize: 'small' });
    expect(c && 'titleSize' in c).toBe(false);
    expect(c && 'bodySize' in c).toBe(false);
  });

  it('lleva la posición de leyenda de la tarjeta (ADR 0051); ausente cuando la tarjeta no la tiene', () => {
    const [a, c] = printableDocument(workspace, board);
    expect(a).toMatchObject({ captionPosition: 'left' });
    expect(c && 'captionPosition' in c).toBe(false);
  });

  it('un tablero sin layout o sin tarjetas da una lista vacía, no un error', () => {
    expect(printableDocument(workspace, 'no-existe' as BoardId)).toEqual([]);
  });
});
