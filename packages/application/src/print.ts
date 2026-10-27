/**
 * Documento de lectura de un tablero (ADR 0031): «Imprimir» y «Presentar» son dos vistas de la misma
 * proyección pura, en el orden de lectura de las tarjetas (fila, luego columna, igual que su numeración
 * en el lienzo). Sin reloj ni acceso a archivos: se arma a partir del workspace ya cargado.
 */
import { cardContentPresentation, cardTitleText, footprint, isFloatingTextCard, richTextInlineText } from '@noutynotes/domain';
import type { BoardId, CaptionPosition, Card, CardId, ConnectorArrows, ConnectorDash, ConnectorDirection, FloatingTextAlign, FloatingTextColor, RichTextDocument, ShapeFill, ShapeKind, ShapeStroke, ShapeStrokeWidth, TextSize, Workspace } from '@noutynotes/domain';

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
  /** Cuerpo HTML seguro v1 (ADR 0066), cuando la nota lo tiene: evita volver a parsear `content` como
   * Markdown (que estaría vacío) para conservar su estructura real en impresión/presentación. */
  readonly contentDocument?: RichTextDocument;
  readonly tags: readonly string[];
  /** La imagen propia (si es una tarjeta de imagen) y las intercaladas de la nota, en orden. */
  readonly imageRefs: readonly string[];
  readonly connections: readonly PrintConnection[];
  /** Tamaño semántico de título/cuerpo (ADR 0050); ausente = `'medium'`, el tamaño de hoy. */
  readonly titleSize?: TextSize;
  readonly bodySize?: TextSize;
  readonly noteFont?: Card['noteFont'];
  /** Posición de la leyenda de imágenes intercaladas (ADR 0051); ausente = `'bottom'`. */
  readonly captionPosition?: CaptionPosition;
  readonly floatingText?: boolean;
  readonly textAlign?: FloatingTextAlign;
  readonly textColor?: FloatingTextColor;
  readonly shapeKind?: ShapeKind;
  readonly shapeFill?: ShapeFill;
  readonly shapeStroke?: ShapeStroke;
  readonly shapeStrokeWidth?: ShapeStrokeWidth;
  readonly connectorColor?: ShapeStroke;
  readonly connectorWidth?: ShapeStrokeWidth;
  readonly connectorDash?: ConnectorDash;
  readonly connectorArrows?: ConnectorArrows;
  readonly connectorDirection?: ConnectorDirection;
}

const titleOf = (card: Card | undefined): string => card ? cardTitleText(card) || 'Sin título' : 'Sin título';

/** Texto plano de texto libre (ADR 0057): su `contentDocument` (HTML seguro v1) son párrafos literales,
 * sin marcas ni bloques especiales; nunca se interpreta como Markdown en impresión/presentación. */
function floatingTextPlain(richText: RichTextDocument): string {
  return richText.blocks.map((block) => block.type === 'paragraph' || block.type === 'heading' ? richTextInlineText(block.content) : '').join('\n');
}

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
    const base = typeBase.get(card.typeId);
    const presentation = cardContentPresentation(card, base);
    const floating = isFloatingTextCard(card, base);
    const imageRefs = presentation.body === 'hidden' ? [] : base === 'image' ? [...(card.assetRefs ?? [])] : noteImageRefs(card.content ?? '');
    const body = floating && card.contentDocument !== undefined ? floatingTextPlain(card.contentDocument) : card.content ?? '';
    return [{
      id: card.id, number: index + 1, title: presentation.title === 'visible' ? titleOf(card) : '', typeLabel: typeLabel.get(card.typeId) ?? '',
      content: presentation.body === 'visible' ? body : '', tags: card.tags ?? [], imageRefs, connections: connectionsOf(workspace, card.id, cards),
      ...(!floating && presentation.body === 'visible' && card.contentDocument !== undefined ? { contentDocument: card.contentDocument } : {}),
      ...(card.titleSize === undefined ? {} : { titleSize: card.titleSize }),
      ...(card.bodySize === undefined ? {} : { bodySize: card.bodySize }),
      ...(card.noteFont === undefined ? {} : { noteFont: card.noteFont }),
      ...(card.captionPosition === undefined ? {} : { captionPosition: card.captionPosition }),
      ...(floating ? { floatingText: true as const } : {}),
      ...(card.textAlign === undefined ? {} : { textAlign: card.textAlign }),
      ...(card.textColor === undefined ? {} : { textColor: card.textColor }),
      ...(card.shapeKind === undefined ? {} : { shapeKind: card.shapeKind }),
      ...(card.shapeFill === undefined ? {} : { shapeFill: card.shapeFill }),
      ...(card.shapeStroke === undefined ? {} : { shapeStroke: card.shapeStroke }),
      ...(card.shapeStrokeWidth === undefined ? {} : { shapeStrokeWidth: card.shapeStrokeWidth }),
      ...(card.connectorColor === undefined ? {} : { connectorColor: card.connectorColor }),
      ...(card.connectorWidth === undefined ? {} : { connectorWidth: card.connectorWidth }),
      ...(card.connectorDash === undefined ? {} : { connectorDash: card.connectorDash }),
      ...(card.connectorArrows === undefined ? {} : { connectorArrows: card.connectorArrows }),
      ...(card.connectorDirection === undefined ? {} : { connectorDirection: card.connectorDirection }),
    }];
  });
}
