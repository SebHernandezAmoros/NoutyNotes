/**
 * Documento de lectura de un tablero (ADR 0031): «Imprimir» y «Presentar» son dos vistas de la misma
 * proyección pura, en el orden de lectura de las tarjetas (fila, luego columna, igual que su numeración
 * en el lienzo). Sin reloj ni acceso a archivos: se arma a partir del workspace ya cargado.
 */
import { footprint } from '@noutynotes/domain';
import type { BoardId, CaptionPosition, Card, CardId, TextSize, Workspace } from '@noutynotes/domain';

import { noteImageRefs } from './note-blocks';

export interface PrintConnection {
  readonly direction: 'from' | 'to';
  readonly label: string;
  readonly otherTitle: string;
}

export interface PrintEntry {
  readonly id: CardId;
  /** Posición en el orden de lectura, desde 1. */
  readonly number: number;
  readonly title: string;
  readonly typeLabel: string;
  /** Texto completo de la nota (no un extracto): es un documento de lectura. */
  readonly content: string;
  readonly tags: readonly string[];
  /** La imagen propia (si es una tarjeta de imagen) y las intercaladas de la nota, en orden. */
  readonly imageRefs: readonly string[];
  readonly connections: readonly PrintConnection[];
  /** Tamaño semántico de título/cuerpo (ADR 0050); ausente = `'medium'`, el tamaño de hoy. */
  readonly titleSize?: TextSize;
  readonly bodySize?: TextSize;
  /** Posición de la leyenda de imágenes intercaladas (ADR 0051); ausente = `'bottom'`. */
  readonly captionPosition?: CaptionPosition;
}

const titleOf = (card: Card | undefined): string => card?.title ?? 'Sin título';

/** Conexiones de una tarjeta como texto: reutiliza `label` de la relación o, si no tiene, el de su tipo. */
function connectionsOf(workspace: Workspace, cardId: CardId, cards: ReadonlyMap<CardId, Card>): PrintConnection[] {
  const typeLabel = new Map(workspace.relationTypes.map((type) => [type.id, type.label]));
  return workspace.relations
    .filter((relation) => relation.from === cardId || relation.to === cardId)
    .map((relation) => {
      const direction: 'from' | 'to' = relation.from === cardId ? 'to' : 'from';
      const otherId = relation.from === cardId ? relation.to : relation.from;
      return { direction, label: relation.label ?? typeLabel.get(relation.typeId) ?? '', otherTitle: titleOf(cards.get(otherId)) };
    });
}

/** Documento de un tablero en orden de lectura. Sin layout, sin tarjetas o el board no existe: lista vacía. */
export function printableDocument(workspace: Workspace, boardId: BoardId): readonly PrintEntry[] {
  const layout = workspace.layouts.find((candidate) => candidate.boardId === boardId);
  if (!layout) return [];
  const cards = new Map(workspace.cards.map((card) => [card.id, card]));
  const typeLabel = new Map(workspace.cardTypes.map((type) => [type.id, type.label]));
  // Una tarjeta de imagen usa `assetRefs` (su propia foto); una nota lo mantiene en sincronía con las
  // imágenes intercaladas (ADR 0021), pero sin garantizar el orden del documento tras editarlo: se
  // vuelve a leer del texto para que las imágenes salgan en el orden en que aparecen.
  const typeBase = new Map(workspace.cardTypes.map((type) => [type.id, type.base]));
  const ordered = [...layout.placements].sort((a, b) => {
    const cellA = footprint(a);
    const cellB = footprint(b);
    return cellA.y - cellB.y || cellA.x - cellB.x;
  });
  return ordered.flatMap((placement, index): PrintEntry[] => {
    const card = cards.get(placement.cardId);
    if (!card) return [];
    const imageRefs = typeBase.get(card.typeId) === 'image' ? [...(card.assetRefs ?? [])] : noteImageRefs(card.content ?? '');
    return [{
      id: card.id, number: index + 1, title: titleOf(card), typeLabel: typeLabel.get(card.typeId) ?? '',
      content: card.content ?? '', tags: card.tags ?? [], imageRefs, connections: connectionsOf(workspace, card.id, cards),
      ...(card.titleSize === undefined ? {} : { titleSize: card.titleSize }),
      ...(card.bodySize === undefined ? {} : { bodySize: card.bodySize }),
      ...(card.captionPosition === undefined ? {} : { captionPosition: card.captionPosition }),
    }];
  });
}
