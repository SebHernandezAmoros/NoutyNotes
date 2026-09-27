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
  /** Marcos del tablero (ADR 0027): áreas con título; sus tarjetas son las que están enteras dentro. */
  readonly frames?: readonly Frame[];
}

/** Marco (ADR 0027). No ocupa la grilla de las tarjetas ni guarda sus hijas: la pertenencia es geométrica. */
export interface Frame {
  readonly id: string;
  readonly title: string;
  readonly rect: GridRect;
}

export const MAX_FRAME_TITLE = 80;

/** Título válido: entre 1 y 80 caracteres sin contar los espacios de los extremos. */
export function isFrameTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= MAX_FRAME_TITLE;
}

// Solape de rectángulos; grid.ts importa este módulo, así que no se reutiliza el suyo.
const overlaps = (a: GridRect, b: GridRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function collectFrameIssues(value: unknown, path: string, issues: DomainIssue[]): void {
  const frames = listAt(value, path, issues);
  frames.forEach((frame, index) => {
    const framePath = `${path}[${index}]`;
    if (!isRecord(frame)) {
      issues.push(issue('invalid-layout', framePath, 'Debe ser un objeto.'));
      return;
    }
    checkId(frame.id, `${framePath}.id`, issues);
    if (!isFrameTitle(frame.title)) issues.push(issue('invalid-value', `${framePath}.title`, `Debe tener entre 1 y ${MAX_FRAME_TITLE} caracteres.`));
    collectRectIssues(frame.rect, `${framePath}.rect`, issues);
  });
  checkUniqueIds(frames.map((frame) => (isRecord(frame) ? frame.id : undefined)), path, 'los marcos del tablero', issues);
  const rects = frames.map((frame) => (isRecord(frame) && isRecord(frame.rect) ? frame.rect as unknown as GridRect : null));
  rects.forEach((rect, index) => {
    if (!rect) return;
    for (let other = 0; other < index; other += 1) {
      const previous = rects[other];
      if (previous && overlaps(rect, previous)) issues.push(issue('grid-collision', `${path}[${index}].rect`, 'Los marcos no pueden solaparse.'));
    }
  });
}

// Enteros seguros: valores mayores no se pueden sumar ni comparar de forma exacta (ADR 0004).
function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function collectRectIssues(rect: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(rect)) {
    issues.push(issue('invalid-layout', path, 'Debe indicar x, y, w y h en unidades de grilla.'));
    return;
  }
  for (const axis of ['x', 'y'] as const) {
    if (!isCoordinate(rect[axis])) {
      issues.push(issue('invalid-layout', `${path}.${axis}`, 'Debe ser un entero seguro de grilla.'));
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
  if (layout.frames !== undefined) collectFrameIssues(layout.frames, `${path}.frames`, issues);
}

export function validateLayout(layout: BoardLayout): ValidationResult<BoardLayout> {
  const issues: DomainIssue[] = [];
  collectLayoutIssues(layout, 'layout', issues);
  return resultOf(layout, issues);
}
