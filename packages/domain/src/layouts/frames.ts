/**
 * Marcos del tablero (ADR 0027). Un marco es un área con título; sus tarjetas son las que tienen la
 * huella entera dentro. Mover un marco mueve ese conjunto con `moveCards`; ninguna operación corta una
 * tarjeta ni solapa dos marcos. O todo o nada.
 */
import { failure, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import type { CardId } from '../ids';
import { cellsOverlap, fitsGrid, footprint, validateGridLayout } from './grid';
import type { GridCell, GridConfig, GridPoint, GridSize } from './grid';
import { isFrameTitle, validateLayout } from './layout';
import type { BoardLayout, Frame, GridRect } from './layout';
import { moveCards } from './operations';

const inside = (cell: GridCell, rect: GridRect) =>
  cell.x >= rect.x && cell.y >= rect.y && cell.x + cell.w <= rect.x + rect.w && cell.y + cell.h <= rect.y + rect.h;

/** Tarjetas enteras dentro del marco, en el orden del layout. */
export function frameMembers(layout: BoardLayout, frameId: string): CardId[] {
  const frame = layout.frames?.find((candidate) => candidate.id === frameId);
  if (!frame) return [];
  return layout.placements.filter((placement) => inside(footprint(placement), frame.rect)).map((placement) => placement.cardId);
}

function locate(layout: BoardLayout, frameId: string): ValidationResult<Frame> {
  const frame = layout.frames?.find((candidate) => candidate.id === frameId);
  return frame ? resultOf(frame, []) : failure([issue('missing-reference', 'frameId', `No hay un marco "${String(frameId)}".`)]);
}

/**
 * Un marco en `rect` puede quedar así: cabe en la grilla, no pisa otro marco y cada tarjeta queda
 * entera dentro o entera fuera. `members` son las que deben quedar dentro (las demás no pueden tocarlo).
 */
function placementIssues(layout: BoardLayout, frameId: string, rect: GridRect, config: GridConfig, members?: ReadonlySet<CardId>): DomainIssue[] {
  if (!fitsGrid(rect, config)) return [issue('out-of-bounds', 'rect', 'El marco saldría de los límites de la grilla.')];
  const issues: DomainIssue[] = [];
  for (const other of layout.frames ?? []) {
    if (other.id !== frameId && cellsOverlap(rect, other.rect)) issues.push(issue('grid-collision', 'rect', `Se solaparía con el marco «${other.title}».`));
  }
  for (const placement of layout.placements) {
    const cell = footprint(placement);
    if (!cellsOverlap(cell, rect)) continue;
    const whole = inside(cell, rect);
    if (members ? !members.has(placement.cardId) : !whole) {
      issues.push(issue('grid-collision', 'rect', `Pisaría la tarjeta "${placement.cardId}".`));
    }
  }
  return issues;
}

function withFrames(layout: BoardLayout, frames: readonly Frame[]): BoardLayout {
  const { frames: _previous, ...rest } = layout;
  return frames.length === 0 ? rest : { ...rest, frames };
}

function checked(layout: BoardLayout, config: GridConfig): ValidationResult<BoardLayout> {
  const valid = validateLayout(layout);
  if (!valid.ok) return valid;
  return validateGridLayout(layout, config);
}

/** Crea un marco que rodea las tarjetas indicadas, con una fila más arriba para su título. */
export function frameAround(
  layout: BoardLayout, cardIds: readonly CardId[], { id, title }: { readonly id: string; readonly title: string }, config: GridConfig,
): ValidationResult<BoardLayout> {
  const base = checked(layout, config);
  if (!base.ok) return base;
  if (!isFrameTitle(title)) return failure([issue('invalid-value', 'title', 'El título del marco debe tener entre 1 y 80 caracteres.')]);
  const members = new Set(cardIds);
  const cells = layout.placements.filter((placement) => members.has(placement.cardId)).map(footprint);
  if (cells.length === 0 || cells.length !== members.size) return failure([issue('missing-reference', 'cardIds', 'Elige tarjetas colocadas en este tablero.')]);
  const left = Math.min(...cells.map((cell) => cell.x));
  const top = Math.min(...cells.map((cell) => cell.y)) - 1;
  const right = Math.max(...cells.map((cell) => cell.x + cell.w));
  const bottom = Math.max(...cells.map((cell) => cell.y + cell.h));
  const rect = { x: left, y: top, w: right - left, h: bottom - top };
  const issues = placementIssues(layout, id, rect, config, members);
  if (issues.length > 0) return failure(issues);
  return checked(withFrames(layout, [...(layout.frames ?? []), { id, title: title.trim(), rect }]), config);
}

/** Mueve el marco y sus tarjetas con el mismo desplazamiento. */
export function moveFrame(layout: BoardLayout, frameId: string, delta: GridPoint, config: GridConfig): ValidationResult<BoardLayout> {
  const base = checked(layout, config);
  if (!base.ok) return base;
  const found = locate(layout, frameId);
  if (!found.ok) return failure(found.issues);
  if (!Number.isSafeInteger(delta.x) || !Number.isSafeInteger(delta.y)) return failure([issue('invalid-layout', 'delta', 'Debe ser un desplazamiento entero.')]);
  const members = frameMembers(layout, frameId);
  const rect = { ...found.value.rect, x: found.value.rect.x + delta.x, y: found.value.rect.y + delta.y };
  // Las tarjetas del marco se mueven con él: no cuentan como obstáculo.
  const issues = placementIssues(layout, frameId, rect, config, new Set(members));
  if (issues.length > 0) return failure(issues);
  const moved = members.length > 0 ? moveCards(layout, members, delta, config) : resultOf(layout, []);
  if (!moved.ok) return moved;
  return checked(withFrames(moved.value, (layout.frames ?? []).map((frame) => (frame.id === frameId ? { ...frame, rect } : frame))), config);
}

/** Cambia el tamaño (la esquina superior izquierda no se mueve) sin cortar ninguna tarjeta. */
export function resizeFrame(layout: BoardLayout, frameId: string, size: GridSize, config: GridConfig): ValidationResult<BoardLayout> {
  const base = checked(layout, config);
  if (!base.ok) return base;
  const found = locate(layout, frameId);
  if (!found.ok) return failure(found.issues);
  if (!Number.isSafeInteger(size.w) || !Number.isSafeInteger(size.h) || size.w < 1 || size.h < 1) {
    return failure([issue('invalid-layout', 'size', 'Debe ser un entero mayor o igual que 1.')]);
  }
  const rect = { ...found.value.rect, w: size.w, h: size.h };
  const issues = placementIssues(layout, frameId, rect, config);
  if (issues.length > 0) return failure(issues);
  return checked(withFrames(layout, (layout.frames ?? []).map((frame) => (frame.id === frameId ? { ...frame, rect } : frame))), config);
}

export function renameFrame(layout: BoardLayout, frameId: string, title: string): ValidationResult<BoardLayout> {
  const found = locate(layout, frameId);
  if (!found.ok) return failure(found.issues);
  if (!isFrameTitle(title)) return failure([issue('invalid-value', 'title', 'El título del marco debe tener entre 1 y 80 caracteres.')]);
  return validateLayout(withFrames(layout, (layout.frames ?? []).map((frame) => (frame.id === frameId ? { ...frame, title: title.trim() } : frame))));
}

/** Quita el marco; las tarjetas se quedan donde están. */
export function removeFrame(layout: BoardLayout, frameId: string): ValidationResult<BoardLayout> {
  const found = locate(layout, frameId);
  if (!found.ok) return failure(found.issues);
  return validateLayout(withFrames(layout, (layout.frames ?? []).filter((frame) => frame.id !== frameId)));
}
