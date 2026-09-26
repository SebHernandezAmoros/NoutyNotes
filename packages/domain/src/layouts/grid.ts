import { isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { collectLayoutIssues } from './layout';
import type { BoardLayout, CardPlacement } from './layout';

/**
 * Configuración que recibe el motor. No depende del ancho de pantalla: la presentación elige
 * qué configuración usar. Sin `rows`, el board crece hacia abajo sin límite (ADR 0004).
 */
export interface GridConfig {
  readonly columns: number;
  readonly rows?: number;
  /** Mundo con coordenadas firmadas; `columns` sigue definiendo el ancho inicial de autocolocación. */
  readonly world?: boolean;
}

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface GridSize {
  readonly w: number;
  readonly h: number;
}

/** Área ocupada en unidades de grilla, como intervalo semiabierto [x, x + w) × [y, y + h). */
export interface GridCell extends GridPoint, GridSize {}

export const MAX_GRID_COLUMNS = 48;
export const DESKTOP_GRID: GridConfig = { columns: 12 };
export const TABLET_GRID: GridConfig = { columns: 6 };
export const MOBILE_GRID: GridConfig = { columns: 1 };
/** Límite práctico: 96 millones de píxeles a la escala base, lejos de la precisión insegura. */
export const MAX_WORLD_CELL = 1_000_000;
export const WORLD_GRID: GridConfig = { columns: 12, world: true };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function collectGridConfigIssues(config: unknown, issues: DomainIssue[]): void {
  if (!isRecord(config)) {
    issues.push(issue('invalid-grid-config', 'config', 'Debe indicar columnas.'));
    return;
  }
  if (!isPositiveSafeInteger(config.columns) || config.columns > MAX_GRID_COLUMNS) {
    issues.push(issue('invalid-grid-config', 'columns', `Debe ser un entero entre 1 y ${MAX_GRID_COLUMNS}.`));
  }
  if (config.rows !== undefined && !isPositiveSafeInteger(config.rows)) {
    issues.push(issue('invalid-grid-config', 'rows', 'Si se indica, debe ser un entero mayor o igual que 1.'));
  }
  if (config.world !== undefined && config.world !== true) {
    issues.push(issue('invalid-grid-config', 'world', 'Debe ser true cuando se indique.'));
  }
  if (config.world && config.rows !== undefined) {
    issues.push(issue('invalid-grid-config', 'rows', 'Un mundo bidireccional no admite límite de filas.'));
  }
}

export function validateGridConfig(config: GridConfig): ValidationResult<GridConfig> {
  const issues: DomainIssue[] = [];
  collectGridConfigIssues(config, issues);
  return resultOf(config, issues);
}

/** Redondea al entero más cercano; los empates van hacia +∞ y `-0` se normaliza a `0`. */
export function snapUnit(value: number, path = 'value'): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return resultOf(value, [issue('invalid-layout', path, 'Debe ser un número finito.')]);
  }
  return resultOf(Math.round(value) + 0, []);
}

function snapPair<K extends string>(value: Readonly<Record<K, number>>, keys: readonly [K, K], path: string): ValidationResult<Record<K, number>> {
  const issues: DomainIssue[] = [];
  const snapped = {} as Record<K, number>;
  if (!isRecord(value)) return resultOf(snapped, [issue('invalid-layout', path, 'Debe ser un objeto con coordenadas numéricas.')]);
  for (const key of keys) {
    const result = snapUnit(value[key], key);
    if (result.ok) snapped[key] = result.value;
    else issues.push(...result.issues);
  }
  return resultOf(snapped, issues);
}

/** Ajusta una posición fraccionaria. No recorta a los límites: eso lo decide cada operación. */
export function snapPoint(point: GridPoint): ValidationResult<GridPoint> {
  return snapPair(point, ['x', 'y'], 'point');
}

export function snapSize(size: GridSize): ValidationResult<GridSize> {
  return snapPair(size, ['w', 'h'], 'size');
}

/** Área que ocupa la colocación según su modo; `rect` conserva el tamaño expandido. */
export function footprint(placement: CardPlacement): GridCell {
  const { x, y, w, h } = placement.rect;
  if (placement.display === 'minimized') return { x, y, w: 1, h: 1 };
  if (placement.display === 'collapsed') return { x, y, w, h: 1 };
  return { x, y, w, h };
}

/** Orden de lectura `(y, x, cardId)`; el cardId solo desempata y hace la ordenación total. */
export function compareReadingOrder(a: CardPlacement, b: CardPlacement): number {
  return a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
}

/** Comparten al menos una celda. Tocarse por un borde o una esquina no es solapamiento. */
export function cellsOverlap(a: GridCell, b: GridCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * El rect canónico (tamaño expandido) debe poder sumarse sin perder exactitud en cualquier modo,
 * aunque su huella reducida quepa donde el rect no cabe (ADR 0004).
 */
export function isRepresentable(cell: GridCell): boolean {
  return Number.isSafeInteger(cell.x + cell.w) && Number.isSafeInteger(cell.y + cell.h);
}

/**
 * Filas donde puede empezar la primera posición libre en orden de lectura: `from`, las filas
 * `extra` y los bordes inferiores posteriores. Si la primera posición libre estuviera en otra fila
 * y, la fila y - 1 también estaría libre, porque ninguna huella termina en y. Así el trabajo depende
 * del número de tarjetas y no de la altura de la grilla (ADR 0004, G3).
 */
export function candidateRows(cells: readonly GridCell[], from: number, extra: readonly number[] = []): number[] {
  const rows = new Set<number>([from, ...extra]);
  for (const cell of cells) if (cell.y + cell.h > from) rows.add(cell.y + cell.h);
  return [...rows].sort((a, b) => a - b);
}

/** Comprueba que un área cabe en la grilla con sumas enteras seguras. */
export function fitsGrid(cell: GridCell, config: GridConfig): boolean {
  const right = cell.x + cell.w;
  const bottom = cell.y + cell.h;
  if (config.world) return Number.isSafeInteger(right) && Number.isSafeInteger(bottom)
    && cell.x >= -MAX_WORLD_CELL && cell.y >= -MAX_WORLD_CELL
    && right <= MAX_WORLD_CELL && bottom <= MAX_WORLD_CELL;
  return cell.x >= 0 && cell.y >= 0 && Number.isSafeInteger(right) && Number.isSafeInteger(bottom)
    && right <= config.columns && (config.rows === undefined || bottom <= config.rows);
}

/**
 * Estructura, límites y colisiones de un layout frente a una configuración ya válida. Cada par en
 * colisión se informa una vez, en la colocación posterior del array.
 */
export function collectGridIssues(layout: BoardLayout, config: GridConfig, issues: DomainIssue[]): void {
  const structural: DomainIssue[] = [];
  collectLayoutIssues(layout, 'layout', structural);
  if (structural.length > 0) {
    issues.push(...structural.map((found) => ({ ...found, path: found.path.replace(/^layout\./, '') })));
    return;
  }
  const cells = layout.placements.map(footprint);
  layout.placements.forEach((placement, index) => {
    const path = `placements[${index}].rect`;
    // La huella nunca supera al rect: si el rect es representable, la huella también.
    if (!isRepresentable(placement.rect)) {
      issues.push(issue('out-of-bounds', path, 'El tamaño expandido no es representable con enteros seguros.'));
      return;
    }
    if (!fitsGrid(cells[index] as GridCell, config)) {
      issues.push(issue('out-of-bounds', path, 'La tarjeta sale de los límites de la grilla.'));
    }
    if ((!config.world && placement.rect.w > config.columns) || (config.rows !== undefined && placement.rect.h > config.rows)) {
      issues.push(issue('out-of-bounds', `${path}.${placement.rect.w > config.columns ? 'w' : 'h'}`,
        'El tamaño expandido no cabe en la grilla.'));
    }
  });
  layout.placements.forEach((placement, index) => {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (cellsOverlap(cells[earlier] as GridCell, cells[index] as GridCell)) {
        issues.push(issue('grid-collision', `placements[${index}]`,
          `"${placement.cardId}" se solapa con "${(layout.placements[earlier] as CardPlacement).cardId}".`));
      }
    }
  });
}

/** Un layout aceptado por esta función no tiene posiciones inválidas ni solapamientos. */
export function validateGridLayout(layout: BoardLayout, config: GridConfig): ValidationResult<BoardLayout> {
  const issues: DomainIssue[] = [];
  collectGridConfigIssues(config, issues);
  if (issues.length === 0) collectGridIssues(layout, config, issues);
  return resultOf(layout, issues);
}
