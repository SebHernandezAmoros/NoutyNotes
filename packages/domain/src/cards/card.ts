import { checkAssetRef } from '../assets/asset-ref';
import type { AssetRef } from '../assets/asset-ref';
import { checkOptionalText, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId } from '../ids';
import type { BoardId, CardId, CardTypeId } from '../ids';
import { collectCardTypeIssues } from './card-type';
import type { CardTypeDefinition } from './card-type';
import { collectFieldValueIssues } from './field-values';
import type { FieldValue } from './field-values';
import { collectTagIssues } from './tags';
import { isArchiveInstant } from './trashed-card';

/**
 * Unidad de contenido. Pertenece al workspace, no a un board: los boards la referencian por ID
 * y su posición vive en los layouts. Identidad, contenido, campos y assets se separan de la
 * representación y de las relaciones.
 */
export interface Card {
  readonly id: CardId;
  readonly typeId: CardTypeId;
  readonly title?: string;
  /** Markdown opaco para el dominio: no se interpreta ni se reescribe. */
  readonly content?: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly assetRefs?: readonly AssetRef[];
  /** Etiquetas `#` normalizadas, únicas y ordenadas (ADR 0019); ausentes si no tiene ninguna. */
  readonly tags?: readonly string[];
  /** Creación real (ADR 0024): instante ISO 8601 en UTC puesto al crearla. Ausente en las anteriores. */
  readonly createdAt?: string;
  /** Icono portable de un catálogo cerrado (ADR 0046). */
  readonly icon?: CardIconName;
  /** Destino de un atajo a otro tablero del mismo workspace (ADR 0046). */
  readonly boardTargetId?: BoardId;
  /** Excepción a la preferencia global de marco (ADR 0049). Ausente: sigue la preferencia del dispositivo. */
  readonly frameOverride?: FrameOverride;
  /** Tamaño semántico del título (ADR 0050). Ausente: `'medium'`, el tamaño de hoy. */
  readonly titleSize?: TextSize;
  /** Tamaño semántico del cuerpo (ADR 0050); no afecta al título ni al pie. Ausente: `'medium'`. */
  readonly bodySize?: TextSize;
  /** Posición de la leyenda de las imágenes intercaladas (ADR 0051). Ausente: `'bottom'`. */
  readonly captionPosition?: CaptionPosition;
  /** Alineación horizontal del texto flotante (ADR 0057). Ausente: izquierda. */
  readonly textAlign?: FloatingTextAlign;
  /** Color semántico portable del texto flotante (ADR 0057). Ausente: color del tema. */
  readonly textColor?: FloatingTextColor;
  /** Geometría y apariencia cerradas de una forma independiente (UX7 P14). */
  readonly shapeKind?: ShapeKind;
  readonly shapeFill?: ShapeFill;
  readonly shapeStroke?: ShapeStroke;
  readonly shapeStrokeWidth?: ShapeStrokeWidth;
}

/**
 * Catálogo portable del icono de ficha (ADR 0046), ampliado en UX7-D5: todo nombre aquí también
 * existe en `AppIcon` (interfaz), para que la vista previa del selector lo dibuje sin traducir
 * nombres. Deliberadamente no incluye glifos de acción pura (deshacer, cerrar, buscar…) ni los que
 * ya significan un estado distinto en la interfaz (marco, archivo): confundirían el icono de la
 * ficha, que es identidad, con una acción o un estado.
 */
export const cardIconNames = [
  'note', 'image', 'folder', 'link', 'check', 'star',
  'text', 'board', 'diary', 'assets', 'present', 'print', 'settings',
] as const;
export type CardIconName = (typeof cardIconNames)[number];

export const frameOverrides = ['visible', 'hidden'] as const;
export type FrameOverride = (typeof frameOverrides)[number];

export const textSizes = ['small', 'medium', 'large'] as const;
export type TextSize = (typeof textSizes)[number];

export const captionPositions = ['bottom', 'top', 'left', 'right'] as const;
export type CaptionPosition = (typeof captionPositions)[number];

export const floatingTextAlignments = ['left', 'center', 'right'] as const;
export type FloatingTextAlign = (typeof floatingTextAlignments)[number];

export const floatingTextColors = ['default', 'red', 'orange', 'green', 'blue', 'purple'] as const;
export type FloatingTextColor = (typeof floatingTextColors)[number];

export const shapeKinds = ['rectangle', 'rounded-rectangle', 'ellipse', 'line'] as const;
export type ShapeKind = (typeof shapeKinds)[number];

export const shapeFills = ['transparent', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type ShapeFill = (typeof shapeFills)[number];

export const shapeStrokes = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type ShapeStroke = (typeof shapeStrokes)[number];

export const shapeStrokeWidths = ['thin', 'medium', 'thick'] as const;
export type ShapeStrokeWidth = (typeof shapeStrokeWidths)[number];

/**
 * Invariantes propias de la tarjeta. Si se conoce su tipo, también la compatibilidad de campos;
 * la existencia del tipo se comprueba en el workspace.
 */
export function collectCardIssues(card: unknown, type: CardTypeDefinition | undefined, path: string, issues: DomainIssue[]): void {
  if (!isRecord(card)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(card.id, `${path}.id`, issues);
  checkId(card.typeId, `${path}.typeId`, issues);
  checkOptionalText(card.title, `${path}.title`, issues);
  if (card.content !== undefined && typeof card.content !== 'string') {
    issues.push(issue('invalid-value', `${path}.content`, 'Debe ser texto Markdown.'));
  }
  if (type) {
    collectFieldValueIssues(card.fields, type, `${path}.fields`, issues);
  } else if (!isRecord(card.fields)) {
    issues.push(issue('invalid-value', `${path}.fields`, 'Debe ser un objeto de campos.'));
  }
  collectTagIssues(card.tags, `${path}.tags`, issues);
  if (card.createdAt !== undefined && !isArchiveInstant(card.createdAt)) {
    issues.push(issue('invalid-value', `${path}.createdAt`, 'Debe ser una fecha y hora ISO 8601 en UTC.'));
  }
  if (card.icon !== undefined && !cardIconNames.includes(card.icon as CardIconName)) {
    issues.push(issue('invalid-value', `${path}.icon`, 'Debe ser un icono del catálogo admitido.'));
  }
  if (card.boardTargetId !== undefined) checkId(card.boardTargetId, `${path}.boardTargetId`, issues);
  if (card.frameOverride !== undefined && !frameOverrides.includes(card.frameOverride as FrameOverride)) {
    issues.push(issue('invalid-value', `${path}.frameOverride`, 'Debe ser "visible" u "hidden".'));
  }
  if (card.titleSize !== undefined && !textSizes.includes(card.titleSize as TextSize)) {
    issues.push(issue('invalid-value', `${path}.titleSize`, 'Debe ser "small", "medium" o "large".'));
  }
  if (card.bodySize !== undefined && !textSizes.includes(card.bodySize as TextSize)) {
    issues.push(issue('invalid-value', `${path}.bodySize`, 'Debe ser "small", "medium" o "large".'));
  }
  if (card.captionPosition !== undefined && !captionPositions.includes(card.captionPosition as CaptionPosition)) {
    issues.push(issue('invalid-value', `${path}.captionPosition`, 'Debe ser "bottom", "top", "left" o "right".'));
  }
  if (card.textAlign !== undefined && !floatingTextAlignments.includes(card.textAlign as FloatingTextAlign)) {
    issues.push(issue('invalid-value', `${path}.textAlign`, 'Debe ser "left", "center" o "right".'));
  }
  if (card.textColor !== undefined && !floatingTextColors.includes(card.textColor as FloatingTextColor)) {
    issues.push(issue('invalid-value', `${path}.textColor`, 'Debe ser un color semántico admitido.'));
  }
  if (card.shapeKind !== undefined && !shapeKinds.includes(card.shapeKind as ShapeKind)) {
    issues.push(issue('invalid-value', `${path}.shapeKind`, 'Debe ser rectángulo, rectángulo redondeado, elipse o línea.'));
  }
  if (card.shapeFill !== undefined && !shapeFills.includes(card.shapeFill as ShapeFill)) {
    issues.push(issue('invalid-value', `${path}.shapeFill`, 'Debe ser un relleno semántico admitido.'));
  }
  if (card.shapeStroke !== undefined && !shapeStrokes.includes(card.shapeStroke as ShapeStroke)) {
    issues.push(issue('invalid-value', `${path}.shapeStroke`, 'Debe ser un color de borde semántico admitido.'));
  }
  if (card.shapeStrokeWidth !== undefined && !shapeStrokeWidths.includes(card.shapeStrokeWidth as ShapeStrokeWidth)) {
    issues.push(issue('invalid-value', `${path}.shapeStrokeWidth`, 'Debe ser thin, medium o thick.'));
  }
  if (card.assetRefs !== undefined) {
    const refs = listAt(card.assetRefs, `${path}.assetRefs`, issues);
    refs.forEach((ref, index) => checkAssetRef(ref, `${path}.assetRefs[${index}]`, issues));
    if (new Set(refs).size !== refs.length) {
      issues.push(issue('invalid-asset-ref', `${path}.assetRefs`, 'Hay referencias a assets repetidas.'));
    }
  }
}

export function validateCard(card: Card, type: CardTypeDefinition): ValidationResult<Card> {
  const issues: DomainIssue[] = [];
  // Los campos solo se comprueban contra un tipo bien formado; si no, se informa del tipo.
  collectCardTypeIssues(type, 'cardType', issues);
  collectCardIssues(card, issues.length === 0 ? type : undefined, 'card', issues);
  if (card.typeId !== type.id) {
    issues.push(issue('missing-reference', 'card.typeId', `La tarjeta usa "${card.typeId}", no "${type.id}".`));
  }
  return resultOf(card, issues);
}
