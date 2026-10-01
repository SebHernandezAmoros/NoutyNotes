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
}

export const cardIconNames = ['note', 'image', 'folder', 'link', 'check', 'star'] as const;
export type CardIconName = (typeof cardIconNames)[number];

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
