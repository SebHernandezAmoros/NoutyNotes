import { isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds } from '../ids';
import type { BoardId, CardId } from '../ids';

export const cardDisplayModes = ['expanded', 'collapsed', 'minimized'] as const;
export type CardDisplayMode = (typeof cardDisplayModes)[number];

/** Rectángulo en unidades de grilla, nunca en píxeles. */
export interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Representación de una tarjeta dentro de un board. Su identidad es el par (boardId, cardId). */
export interface CardPlacement {
  readonly cardId: CardId;
  readonly rect: GridRect;
  readonly display: CardDisplayMode;
}

/**
 * Layout de un board: un único layout por board, identificado por `boardId`. Separa la
 * representación del contenido; cambiarlo no altera tarjetas ni relaciones. Límites de columnas,
 * colisiones, snap y la vista móvil pertenecen al motor de grilla (fase 2).
 */
export interface BoardLayout {
  readonly boardId: BoardId;
  readonly placements: readonly CardPlacement[];
}

// Enteros seguros: valores mayores no se pueden sumar ni comparar de forma exacta (ADR 0004).
function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function collectRectIssues(rect: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(rect)) {
    issues.push(issue('invalid-layout', path, 'Debe indicar x, y, w y h en unidades de grilla.'));
    return;
  }
  for (const axis of ['x', 'y'] as const) {
    if (!isNonNegativeInteger(rect[axis])) {
      issues.push(issue('invalid-layout', `${path}.${axis}`, 'Debe ser un entero mayor o igual que 0.'));
    }
  }
  for (const size of ['w', 'h'] as const) {
    if (!isNonNegativeInteger(rect[size]) || rect[size] === 0) {
      issues.push(issue('invalid-layout', `${path}.${size}`, 'Debe ser un entero mayor o igual que 1.'));
    }
  }
}

export function collectLayoutIssues(layout: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(layout)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(layout.boardId, `${path}.boardId`, issues);
  const placements = listAt(layout.placements, `${path}.placements`, issues);
  placements.forEach((placement, index) => {
    const placementPath = `${path}.placements[${index}]`;
    if (!isRecord(placement)) {
      issues.push(issue('invalid-layout', placementPath, 'Debe ser un objeto.'));
      return;
    }
    checkId(placement.cardId, `${placementPath}.cardId`, issues);
    collectRectIssues(placement.rect, `${placementPath}.rect`, issues);
    if (!cardDisplayModes.includes(placement.display as CardDisplayMode)) {
      issues.push(issue('invalid-layout', `${placementPath}.display`, `Modo desconocido: ${String(placement.display)}.`));
    }
  });
  checkUniqueIds(
    placements.map((placement) => (isRecord(placement) ? placement.cardId : undefined)),
    `${path}.placements`,
    `el layout del board "${String(layout.boardId)}"`,
    issues,
  );
}

export function validateLayout(layout: BoardLayout): ValidationResult<BoardLayout> {
  const issues: DomainIssue[] = [];
  collectLayoutIssues(layout, 'layout', issues);
  return resultOf(layout, issues);
}
