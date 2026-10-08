import { failure, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import type { CardId } from '../ids';
import { candidateRows, cellsOverlap, compareReadingOrder, fitsGrid, footprint, isRepresentable, validateGridLayout } from './grid';
import type { GridCell, GridConfig, GridPoint, GridSize } from './grid';
import { GRID_SUBDIVISIONS, cardDisplayModes } from './layout';
import type { BoardLayout, CardDisplayMode, CardPlacement } from './layout';
import { validateConnectorPath } from './connector-path';
import type { ConnectorRoutePoint } from './connector-path';

export interface FindFreeSpaceOptions {
  /** Tarjeta cuya huella se ignora, por ejemplo al buscar un nuevo sitio para ella misma. */
  readonly ignore?: CardId;
  /** Esquina superior izquierda de la zona de búsqueda (por ejemplo, la parte visible del mundo). Por defecto, el origen. */
  readonly from?: GridPoint;
  /** Ancho de la banda de búsqueda en celdas; se ensancha hasta el de la tarjeta. Por defecto, las columnas de la grilla. */
  readonly columns?: number;
}

export interface SetDisplayOptions {
  /** Qué hacer si la huella crece y no cabe donde está (ADR 0004). Por defecto, `fail`. */
  readonly ifOccupied?: 'fail' | 'relocate';
}

type Located = { readonly layout: BoardLayout; readonly index: number; readonly placement: CardPlacement };

function fail<T>(value: T, issues: DomainIssue[]): ValidationResult<T> {
  return resultOf(value, issues);
}

/** Valida configuración y layout de entrada y localiza la tarjeta. No repara layouts inválidos. */
function locate(layout: BoardLayout, cardId: CardId, config: GridConfig): ValidationResult<Located> {
  const checked = validateGridLayout(layout, config);
  if (!checked.ok) return failure(checked.issues);
  const index = layout.placements.findIndex((placement) => placement.cardId === cardId);
  const placement = layout.placements[index];
  if (!placement) return failure([issue('missing-reference', 'cardId', `No hay colocación para "${String(cardId)}".`)]);
  return resultOf({ layout, index, placement }, []);
}

function checkIntegers<K extends string>(value: Readonly<Record<K, number>>, keys: readonly K[], path: string, minimum: number): DomainIssue[] {
  if (!isRecord(value)) return [issue('invalid-layout', path, 'Debe ser un objeto con valores numéricos.')];
  return keys
    .filter((key) => !(Number.isSafeInteger(value[key]) || Number.isSafeInteger(value[key] * GRID_SUBDIVISIONS)) || value[key] < minimum)
    .map((key) => issue('invalid-layout', `${path}.${key}`,
      minimum > 0 ? 'Debe ser un entero mayor o igual que 1.' : 'Debe ser un entero; aplicar snap antes de operar.'));
}

/** Límites y colisiones de una colocación candidata frente al resto del layout. */
function fitIssues(layout: BoardLayout, index: number, candidate: CardPlacement, config: GridConfig, boundsPath: string): DomainIssue[] {
  if (!isRepresentable(candidate.rect)) {
    return [issue('out-of-bounds', boundsPath, 'El tamaño expandido dejaría de ser representable con enteros seguros.')];
  }
  const cell = footprint(candidate);
  if (!fitsGrid(cell, config)) return [issue('out-of-bounds', boundsPath, 'La tarjeta saldría de los límites de la grilla.')];
  const issues: DomainIssue[] = [];
  for (const [pointIndex, point] of (candidate.connectorPath ?? []).entries()) {
    if (!fitsGrid({ x: point.x, y: point.y, w: 0.25, h: 0.25 }, config)) {
      issues.push(issue('out-of-bounds', `${boundsPath}.connectorPath[${pointIndex}]`, 'El punto saldría de los límites de la grilla.'));
    }
  }
  layout.placements.forEach((other, otherIndex) => {
    if (candidate.connectorPath === undefined && other.connectorPath === undefined && otherIndex !== index && cellsOverlap(cell, footprint(other))) {
      issues.push(issue('grid-collision', `placements[${otherIndex}]`, `Se solaparía con "${other.cardId}".`));
    }
  });
  return issues;
}

function replaceAt(layout: BoardLayout, index: number, placement: CardPlacement): BoardLayout {
  return { ...layout, placements: layout.placements.map((current, i) => (i === index ? placement : current)) };
}

function withCorner(placement: CardPlacement, { x, y }: GridPoint): CardPlacement {
  const dx = x - placement.rect.x;
  const dy = y - placement.rect.y;
  return { ...placement, rect: { ...placement.rect, x, y },
    ...(placement.connectorPath === undefined ? {} : { connectorPath: placement.connectorPath.map((point) => ({ x: point.x + dx, y: point.y + dy })) }) };
}

function invalidOptions(options: unknown): DomainIssue[] {
  return isRecord(options) ? [] : [issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')];
}

function invalidZone(options: FindFreeSpaceOptions): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const { from, columns } = options;
  if (from !== undefined && (!isRecord(from) || !Number.isSafeInteger(from.x) || !Number.isSafeInteger(from.y))) {
    issues.push(issue('invalid-value', 'options.from', 'Debe ser un punto de la grilla con enteros.'));
  }
  if (columns !== undefined && (!Number.isSafeInteger(columns) || columns < 1)) {
    issues.push(issue('invalid-value', 'options.columns', 'Debe ser un entero mayor o igual que 1.'));
  }
  return issues;
}

/** Primera posición libre en orden de lectura: filas de arriba abajo y columnas de izquierda a derecha. */
export function findFreeSpace(layout: BoardLayout, size: GridSize, config: GridConfig, options: FindFreeSpaceOptions = {}): ValidationResult<GridPoint> {
  const origin: GridPoint = { x: 0, y: 0 };
  const optionIssues = invalidOptions(options);
  if (optionIssues.length > 0) return fail(origin, optionIssues);
  const zoneIssues = invalidZone(options);
  if (zoneIssues.length > 0) return fail(origin, zoneIssues);
  const checked = validateGridLayout(layout, config);
  if (!checked.ok) return fail(origin, [...checked.issues]);
  const sizeIssues = checkIntegers(size, ['w', 'h'], 'size', 1);
  if (sizeIssues.length > 0) return fail(origin, sizeIssues);
  if ((!config.world && size.w > config.columns) || (config.rows !== undefined && size.h > config.rows)) {
    return fail(origin, [issue('out-of-bounds', 'size', 'El tamaño no cabe en la grilla.')]);
  }
  const occupied = layout.placements.filter((placement) => placement.cardId !== options.ignore && placement.connectorPath === undefined).map(footprint);
  const start = options.from ?? origin;
  const end = start.x + Math.max(options.columns ?? config.columns, size.w);
  for (const y of candidateRows(occupied, start.y)) {
    // Filas en orden creciente: si esta ya no es representable o excede el límite, las siguientes tampoco.
    if (!fitsGrid({ x: start.x, y, w: size.w, h: size.h }, config)) break;
    for (let x = start.x; x + size.w <= end; x += 1) {
      const candidate: GridCell = { x, y, w: size.w, h: size.h };
      if (!fitsGrid(candidate, config)) continue;
      if (occupied.every((cell) => !cellsOverlap(candidate, cell))) return resultOf({ x, y }, []);
    }
  }
  return fail(origin, [issue('no-free-space', 'size', 'No queda espacio libre representable dentro de los límites.')]);
}

/** Mueve la esquina de la tarjeta. No ajusta en silencio: fuera de límites o con colisión, falla. */
export function moveCard(layout: BoardLayout, cardId: CardId, to: GridPoint, config: GridConfig): ValidationResult<BoardLayout> {
  const located = locate(layout, cardId, config);
  if (!located.ok) return fail(layout, [...located.issues]);
  const pointIssues = checkIntegers(to, ['x', 'y'], 'to', Number.MIN_SAFE_INTEGER);
  if (pointIssues.length > 0) return fail(layout, pointIssues);
  const candidate = withCorner(located.value.placement, to);
  const issues = fitIssues(layout, located.value.index, candidate, config, 'to');
  return issues.length > 0 ? fail(layout, issues) : resultOf(replaceAt(layout, located.value.index, candidate), []);
}

/** Sustituye la ruta de una colocación sin convertirla en una caja de colisión. */
export function setConnectorPath(
  layout: BoardLayout, cardId: CardId, connectorPath: readonly ConnectorRoutePoint[], config: GridConfig,
): ValidationResult<BoardLayout> {
  const located = locate(layout, cardId, config);
  if (!located.ok) return fail(layout, [...located.issues]);
  const checked = validateConnectorPath(connectorPath);
  if (!checked.ok) return fail(layout, [...checked.issues]);
  const start = connectorPath[0] as ConnectorRoutePoint;
  const candidate: CardPlacement = {
    ...located.value.placement,
    rect: { ...located.value.placement.rect, x: start.x, y: start.y, w: 1, h: 1 },
    connectorPath: connectorPath.map(({ x, y }) => ({ x, y })),
    display: 'expanded',
  };
  const issues = fitIssues(layout, located.value.index, candidate, config, 'connectorPath');
  return issues.length > 0 ? fail(layout, issues) : resultOf(replaceAt(layout, located.value.index, candidate), []);
}

/**
 * Mueve un conjunto de tarjetas con el mismo desplazamiento en celdas (ADR 0025). Las del conjunto no
 * chocan entre sí; cada una debe caber en los límites y no pisar ninguna tarjeta de fuera. O todas o ninguna.
 */
export function moveCards(layout: BoardLayout, cardIds: readonly CardId[], delta: GridPoint, config: GridConfig): ValidationResult<BoardLayout> {
  const checked = validateGridLayout(layout, config);
  if (!checked.ok) return fail(layout, [...checked.issues]);
  if (!Array.isArray(cardIds) || cardIds.length === 0) return fail(layout, [issue('invalid-value', 'cardIds', 'Debe haber al menos una tarjeta.')]);
  const deltaIssues = checkIntegers(delta, ['x', 'y'], 'delta', Number.MIN_SAFE_INTEGER);
  if (deltaIssues.length > 0) return fail(layout, deltaIssues);
  const members = new Set(cardIds);
  const missing = [...members].filter((cardId) => !layout.placements.some((placement) => placement.cardId === cardId));
  if (missing.length > 0) return fail(layout, missing.map((cardId) => issue('missing-reference', 'cardIds', `No hay colocación para "${String(cardId)}".`)));
  const moved = layout.placements.map((placement) => (members.has(placement.cardId)
    ? withCorner(placement, { x: placement.rect.x + delta.x, y: placement.rect.y + delta.y }) : placement));
  // Cada movida frente a las de fuera: las del conjunto se desplazan igual y no pueden solaparse entre sí.
  const outside: BoardLayout = { ...layout, placements: layout.placements.filter((placement) => !members.has(placement.cardId)) };
  const issues = moved.filter((placement) => members.has(placement.cardId))
    .flatMap((candidate) => fitIssues(outside, -1, candidate, config, 'delta'));
  return issues.length > 0 ? fail(layout, issues) : resultOf({ ...layout, placements: moved }, []);
}

/**
 * Añade un grupo de colocaciones nuevas (pegar/duplicar, ADR 0052): todo o nada, ninguna puede
 * solaparse con las que ya había ni entre sí. No busca hueco por sí sola — quien llama ya decidió
 * el desplazamiento (p. ej. con `findFreeSpace` sobre el contorno del grupo); esta función solo
 * valida la colocación final y la aplica.
 */
export function addGroup(layout: BoardLayout, additions: readonly CardPlacement[], config: GridConfig): ValidationResult<BoardLayout> {
  const checked = validateGridLayout(layout, config);
  if (!checked.ok) return fail(layout, [...checked.issues]);
  if (!Array.isArray(additions) || additions.length === 0) return fail(layout, [issue('invalid-value', 'additions', 'Debe haber al menos una colocación.')]);
  const already = additions.filter((placement) => layout.placements.some((existing) => existing.cardId === placement.cardId));
  if (already.length > 0) {
    return fail(layout, already.map((placement) => issue('duplicate-id', 'additions', `Ya hay una colocación para "${placement.cardId}".`)));
  }
  const combined: BoardLayout = { ...layout, placements: [...layout.placements, ...additions] };
  const issues = additions.flatMap((candidate, offset) => fitIssues(combined, layout.placements.length + offset, candidate, config, 'additions'));
  return issues.length > 0 ? fail(layout, issues) : resultOf(combined, []);
}

/** Cambia el tamaño expandido (`rect.w`, `rect.h`) y valida la huella resultante en cualquier modo. */
export function resizeCard(layout: BoardLayout, cardId: CardId, size: GridSize, config: GridConfig): ValidationResult<BoardLayout> {
  const located = locate(layout, cardId, config);
  if (!located.ok) return fail(layout, [...located.issues]);
  const sizeIssues = checkIntegers(size, ['w', 'h'], 'size', 1);
  if (sizeIssues.length > 0) return fail(layout, sizeIssues);
  if ((!config.world && size.w > config.columns) || (config.rows !== undefined && size.h > config.rows)) {
    return fail(layout, [issue('out-of-bounds', 'size', 'El tamaño no cabe en la grilla.')]);
  }
  const { placement, index } = located.value;
  const candidate: CardPlacement = { ...placement, rect: { ...placement.rect, w: size.w, h: size.h } };
  const issues = fitIssues(layout, index, candidate, config, 'size');
  return issues.length > 0 ? fail(layout, issues) : resultOf(replaceAt(layout, index, candidate), []);
}

/**
 * Cambia solo `display`: identidad, `rect`, contenido y relaciones no cambian. Reducir la huella
 * siempre cabe. Si crece y no cabe, falla o, con `relocate`, busca el primer hueco (ADR 0004).
 */
export function setDisplay(
  layout: BoardLayout,
  cardId: CardId,
  display: CardDisplayMode,
  config: GridConfig,
  options: SetDisplayOptions = {},
): ValidationResult<BoardLayout> {
  if (!cardDisplayModes.includes(display)) {
    return fail(layout, [issue('invalid-layout', 'display', `Modo desconocido: ${String(display)}.`)]);
  }
  const optionIssues = invalidOptions(options);
  if (optionIssues.length > 0) return fail(layout, optionIssues);
  const ifOccupied = options.ifOccupied ?? 'fail';
  if (ifOccupied !== 'fail' && ifOccupied !== 'relocate') {
    return fail(layout, [issue('invalid-value', 'options.ifOccupied', 'Debe ser "fail" o "relocate".')]);
  }
  const located = locate(layout, cardId, config);
  if (!located.ok) return fail(layout, [...located.issues]);
  const { placement, index } = located.value;
  const candidate: CardPlacement = { ...placement, display };
  const issues = fitIssues(layout, index, candidate, config, 'rect');
  if (issues.length === 0) return resultOf(replaceAt(layout, index, candidate), []);
  if (ifOccupied === 'fail') return fail(layout, issues);

  const { w, h } = footprint(candidate);
  const spot = findFreeSpace(layout, { w, h }, config, { ignore: cardId });
  if (!spot.ok) return fail(layout, [...spot.issues]);
  const relocated = withCorner(candidate, spot.value);
  // El hueco admite la huella, pero el rect canónico también debe seguir siendo representable. Los
  // huecos posteriores están más abajo, así que tampoco lo serían: no hay posición válida.
  if (fitIssues(layout, index, relocated, config, 'rect').length > 0) {
    return fail(layout, [issue('no-free-space', 'size', 'No queda espacio libre representable para el tamaño expandido.')]);
  }
  return resultOf(replaceAt(layout, index, relocated), []);
}

/**
 * Compactación vertical simple: en orden de lectura `(y, x, cardId)`, cada huella sube hasta
 * tocar una ya colocada que comparta columnas, o hasta la fila 0. Conserva columnas, tamaños,
 * modos y el orden del array. Es determinista e idempotente.
 */
export function compactLayout(layout: BoardLayout, config: GridConfig): ValidationResult<BoardLayout> {
  const checked = validateGridLayout(layout, config);
  if (!checked.ok) return fail(layout, [...checked.issues]);
  const newY = new Map<CardPlacement, number>();
  const settled: GridCell[] = [];
  for (const placement of [...layout.placements].sort(compareReadingOrder)) {
    if (placement.connectorPath !== undefined) {
      newY.set(placement, placement.rect.y);
      continue;
    }
    const cell = footprint(placement);
    // En un layout válido, las huellas ya colocadas que comparten columnas quedan por encima.
    const top = settled
      .filter((other) => other.x < cell.x + cell.w && cell.x < other.x + other.w)
      .reduce((bottom, other) => Math.max(bottom, other.y + other.h), 0);
    newY.set(placement, top);
    settled.push({ ...cell, y: top });
  }
  return resultOf({
    ...layout,
    placements: layout.placements.map((placement) => withCorner(placement, { x: placement.rect.x, y: newY.get(placement) ?? placement.rect.y })),
  }, []);
}
