import { isRecord, issue, listAt } from '../errors';
import type { DomainIssue } from '../errors';
import { checkId, checkUniqueIds, isValidId } from '../ids';
import type { BoardId } from '../ids';
import { collectLayoutIssues } from '../layouts/layout';
import type { CardDisplayMode, GridRect } from '../layouts/layout';
import { collectRelationIssues } from '../relations/relation';
import type { Relation } from '../relations/relation';
import { collectCardIssues } from './card';
import type { Card } from './card';
import type { CardTypeDefinition } from './card-type';

/**
 * Instantánea de una tarjeta enviada a la Papelera (ADR 0015): todo lo necesario para restaurarla
 * con su contenido, pertenencia, colocación y relaciones. No forma parte del workspace activo.
 */
export interface TrashedCard {
  readonly card: Card;
  /** Tableros a los que pertenecía y su posición en `cardIds`. */
  readonly boards: readonly { readonly boardId: BoardId; readonly index: number }[];
  /** Colocación en cada layout donde estaba. */
  readonly placements: readonly { readonly boardId: BoardId; readonly rect: GridRect; readonly display: CardDisplayMode }[];
  /** Relaciones que la tocaban. */
  readonly relations: readonly Relation[];
}

/**
 * Invariantes de la Papelera: instantáneas válidas, IDs únicos y sin coincidir con tarjetas activas,
 * tipo existente y relaciones que tocan a la tarjeta. Los tableros guardados pueden haber
 * desaparecido: eso se resuelve al restaurar.
 */
export function collectTrashIssues(
  trash: unknown,
  types: ReadonlyMap<string, CardTypeDefinition>,
  activeCardIds: ReadonlySet<string>,
  issues: DomainIssue[],
): void {
  if (trash === undefined) return;
  const entries = listAt(trash, 'trash', issues);
  const ids: unknown[] = [];
  entries.forEach((entry, i) => {
    const path = `trash[${i}]`;
    if (!isRecord(entry) || !isRecord(entry.card)) {
      issues.push(issue('invalid-value', path, 'Debe ser una tarjeta en la Papelera con su instantánea.'));
      return;
    }
    const card = entry.card;
    ids.push(card.id);
    const type = isValidId(card.typeId) ? types.get(card.typeId) : undefined;
    collectCardIssues(card, type, `${path}.card`, issues);
    if (isValidId(card.typeId) && !types.has(card.typeId)) {
      issues.push(issue('missing-reference', `${path}.card.typeId`, `No existe el tipo de tarjeta "${card.typeId}".`));
    }
    if (isValidId(card.id) && activeCardIds.has(card.id)) {
      issues.push(issue('duplicate-id', `${path}.card.id`, `"${card.id}" ya es una tarjeta activa.`));
    }
    listAt(entry.boards, `${path}.boards`, issues).forEach((membership, j) => {
      const at = `${path}.boards[${j}]`;
      if (!isRecord(membership)) return void issues.push(issue('invalid-value', at, 'Debe indicar tablero e índice.'));
      checkId(membership.boardId, `${at}.boardId`, issues);
      if (!Number.isSafeInteger(membership.index) || (membership.index as number) < 0) {
        issues.push(issue('invalid-value', `${at}.index`, 'Debe ser un entero mayor o igual que 0.'));
      }
    });
    listAt(entry.placements, `${path}.placements`, issues).forEach((placement, j) => {
      const at = `${path}.placements[${j}]`;
      if (!isRecord(placement)) return void issues.push(issue('invalid-value', at, 'Debe indicar tablero y colocación.'));
      collectLayoutIssues({ boardId: placement.boardId, placements: [{ cardId: card.id, rect: placement.rect, display: placement.display }] }, at, issues);
    });
    listAt(entry.relations, `${path}.relations`, issues).forEach((relation, j) => {
      const at = `${path}.relations[${j}]`;
      collectRelationIssues(relation, at, issues);
      if (isRecord(relation) && relation.from !== card.id && relation.to !== card.id) {
        issues.push(issue('invalid-value', at, 'La relación no toca a la tarjeta de la Papelera.'));
      }
    });
  });
  checkUniqueIds(ids, 'trash', 'las tarjetas de la Papelera', issues);
}
