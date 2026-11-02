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
    { id: 'texto-flotante', label: 'Texto', base: 'text', fields: [] } as unknown as CardTypeDefinition,
    { id: 'forma', label: 'Forma', base: 'shape', fields: [] } as unknown as CardTypeDefinition,
  ],
  relationTypes: [{ id: 'relacionada' as RelationTypeId, label: 'Relacionada con' }],
  relations: [{ id: 'r1' as RelationId, typeId: 'relacionada' as RelationTypeId, from: 'b' as CardId, to: 'a' as CardId }],
  boards: [{ id: board, title: 'Principal', cardIds: ['a', 'b', 'sin-sitio', 'imagen-1', 'texto-1', 'forma-1'] }],
  layouts: [{
    boardId: board,
    // b está más abajo que a pero en la misma columna; c está en la fila de a pero a la derecha: orden esperado a, c, b.
    placements: [place('a', 0, 0), place('c', 8, 0), place('b', 0, 3), place('minimizada', 4, 6, 4, 3, 'minimized'), place('imagen-1', 0, 10, 4, 3), place('texto-1', 4, 10, 4, 2), place('forma-1', 8, 10, 4, 3), place('v2-con-imagen', 0, 14, 4, 3)],
  }],
  cards: [
    // assetRefs ya trae la misma imagen (así la mantiene sincronizada la edición, ADR 0021): no debe duplicarse.
    card('a', { title: 'A', content: 'Texto de A.\n\n![foto](assets/images/x.png)\n\nMás texto.', tags: ['viaje'], assetRefs: ['assets/images/x.png'], titleSize: 'large', bodySize: 'small', captionPosition: 'left' }),
    // B9-R4-01: Nota v2/HTML (`contentDocument`, `content` vacío) con una imagen intercalada — antes
    // `imageRefs` solo leía `content` (Markdown v1) y quedaba vacío para esta Nota.
    card('v2-con-imagen', { title: 'V2 con imagen', content: '', contentDocument: { schemaVersion: 2, blocks: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Antes' }] },
      { type: 'image', assetRef: 'assets/images/v2.png', alt: 'x' },
    ] } }),
    card('c', { title: 'C' }),
    card('b', { title: 'B' }),
    card('minimizada', { title: 'Minimizada' }),
    card('sin-sitio', { title: 'Sin sitio' }),
    card('imagen-1', { typeId: 'imagen', title: 'Foto', assetRefs: ['assets/images/foto.png'] }),
    card('texto-1', { typeId: 'texto-flotante', title: undefined, content: 'Libre\ny portable', bodySize: 'large', textAlign: 'right', textColor: 'purple' }),
    card('forma-1', { typeId: 'forma', title: undefined, content: undefined, shapeKind: 'ellipse', shapeFill: 'orange', shapeStroke: 'blue', shapeStrokeWidth: 'thick' }),
  ],
} as unknown as Workspace;

describe('Imprimir y presentar (ADR 0031)', () => {
  it('B9-R3-02: el orden de lectura sigue el orden principal del tablero (board.cardIds); lo no listado cae al final por fila/columna; lo sin sitio no aparece', () => {
    const doc = printableDocument(workspace, board);
    // cardIds: a, b, sin-sitio, imagen-1, texto-1, forma-1 — sin-sitio no tiene colocación y se omite.
    // c, minimizada y v2-con-imagen no están en cardIds (dato real que puede darse): caen al final, por
    // fila/columna (minimizada cuenta por su huella, no por su estado) — nunca desaparecen por no estar listados.
    expect(doc.map((entry) => entry.id)).toEqual(['a', 'b', 'imagen-1', 'texto-1', 'forma-1', 'c', 'minimizada', 'v2-con-imagen']);
    expect(doc.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('proyecta el texto flotante y su estilo portable para impresión', () => {
    expect(printableDocument(workspace, board).find((entry) => entry.id === 'texto-1')).toMatchObject({
      id: 'texto-1', floatingText: true, content: 'Libre\ny portable', bodySize: 'large', textAlign: 'right', textColor: 'purple',
    });
  });

  it('proyecta una forma sin convertirla en contenido o relación semántica', () => {
    expect(printableDocument(workspace, board).find((entry) => entry.id === 'forma-1')).toMatchObject({
      id: 'forma-1', shapeKind: 'ellipse', shapeFill: 'orange', shapeStroke: 'blue', shapeStrokeWidth: 'thick',
    });
  });

  it('cada entrada lleva tipo, contenido completo, etiquetas, sus imágenes en orden y sus conexiones en texto', () => {
    const doc = printableDocument(workspace, board);
    const a = doc.find((entry) => entry.id === 'a');
    const b = doc.find((entry) => entry.id === 'b');
    const imagen = doc.find((entry) => entry.id === 'imagen-1');
    expect(a).toMatchObject({ id: 'a', title: 'A', typeLabel: 'Nota', tags: ['viaje'], imageRefs: ['assets/images/x.png'] });
    expect(a?.content).toContain('Texto de A');
    // La relación va de B a A: A la recibe («from», llega de B) y B la envía («to», va hacia A).
    expect(a?.connections).toEqual([{ direction: 'from', label: 'Relacionada con', otherTitle: 'B' }]);
    expect(b?.connections).toEqual([{ direction: 'to', label: 'Relacionada con', otherTitle: 'A' }]);
    expect(imagen).toMatchObject({ typeLabel: 'Imagen', imageRefs: ['assets/images/foto.png'] });
  });

  it('lleva el tamaño de título/cuerpo de la tarjeta (ADR 0050); ausente cuando la tarjeta no lo tiene', () => {
    const doc = printableDocument(workspace, board);
    const a = doc.find((entry) => entry.id === 'a');
    const c = doc.find((entry) => entry.id === 'c');
    expect(a).toMatchObject({ titleSize: 'large', bodySize: 'small' });
    expect(c && 'titleSize' in c).toBe(false);
    expect(c && 'bodySize' in c).toBe(false);
  });

  it('lleva la posición de leyenda de la tarjeta (ADR 0051); ausente cuando la tarjeta no la tiene', () => {
    const doc = printableDocument(workspace, board);
    const a = doc.find((entry) => entry.id === 'a');
    const c = doc.find((entry) => entry.id === 'c');
    expect(a).toMatchObject({ captionPosition: 'left' });
    expect(c && 'captionPosition' in c).toBe(false);
  });

  it('B9-R4-01: una Nota v2/HTML (contentDocument) también proyecta su imagen intercalada, no solo el Markdown v1', () => {
    const v2 = printableDocument(workspace, board).find((entry) => entry.id === 'v2-con-imagen');
    expect(v2).toMatchObject({ imageRefs: ['assets/images/v2.png'] });
  });

  it('un tablero sin layout o sin tarjetas da una lista vacía, no un error', () => {
    expect(printableDocument(workspace, 'no-existe' as BoardId)).toEqual([]);
  });
});
