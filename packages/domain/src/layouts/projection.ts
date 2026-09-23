import { failure, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import type { BoardId, CardId } from '../ids';
import { candidateRows, cellsOverlap, collectGridConfigIssues, compareReadingOrder, footprint, validateGridLayout } from './grid';
import type { GridCell, GridConfig } from './grid';
import type { BoardLayout, CardDisplayMode } from './layout';

export interface ProjectedItem {
  readonly cardId: CardId;
  /** Posición en el orden de lectura canónico, desde 0. */
  readonly order: number;
  readonly cell: GridCell;
  readonly display: CardDisplayMode;
}

/** Representación derivada para otra cantidad de columnas. Nunca se persiste. */
export interface ProjectedLayout {
  readonly boardId: BoardId;
  readonly columns: number;
  readonly items: readonly ProjectedItem[];
}

function prefixed(issues: readonly DomainIssue[], prefix: string): DomainIssue[] {
  return issues.map((found) => ({ ...found, path: `${prefix}.${found.path}` }));
}

/** Valida configuraciones y layout antes de leer ningún campo de la entrada (G4). */
function inputIssues(layout: BoardLayout, from: GridConfig, to: GridConfig): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const source = validateGridLayout(layout, from);
  if (!source.ok) issues.push(...prefixed(source.issues, 'from'));
  const target: DomainIssue[] = [];
  collectGridConfigIssues(to, target);
  if (target.length === 0 && to.rows !== undefined) {
    target.push(issue('invalid-grid-config', 'rows', 'La proyección crece hacia abajo; no admite límite de filas.'));
  }
  return [...issues, ...prefixed(target, 'to')];
}

/**
 * Deriva la representación de un layout canónico para `to.columns` sin modificarlo (ADR 0004):
 * orden de lectura canónico, ancho escalado con redondeo hacia arriba, alto de la huella
 * conservado y cada pieza en la primera posición libre posterior a la anterior.
 */
export function projectLayout(layout: BoardLayout, from: GridConfig, to: GridConfig): ValidationResult<ProjectedLayout> {
  const issues = inputIssues(layout, from, to);
  if (issues.length > 0) return failure(issues);

  const items: ProjectedItem[] = [];
  let cursor = { x: -1, y: 0 };
  for (const placement of [...layout.placements].sort(compareReadingOrder)) {
    const own = footprint(placement);
    const w = Math.max(1, Math.min(to.columns, Math.ceil((own.w * to.columns) / from.columns)));
    const h = own.h;
    const path = `items[${items.length}]`;
    // Filas candidatas: la del cursor, la siguiente (en la del cursor solo valen columnas posteriores)
    // y los bordes inferiores de lo ya colocado. La última siempre admite la pieza desde x = 0.
    const rows = candidateRows(items.map((item) => item.cell), cursor.y, [cursor.y + 1]);
    let cell: GridCell | undefined;
    for (const y of rows) {
      if (!Number.isSafeInteger(y + h)) {
        return failure([issue('out-of-bounds', path, 'La posición derivada no es representable con enteros seguros.')]);
      }
      for (let x = y === cursor.y ? cursor.x + 1 : 0; x + w <= to.columns && !cell; x += 1) {
        const candidate = { x, y, w, h };
        if (items.every((item) => !cellsOverlap(candidate, item.cell))) cell = candidate;
      }
      if (cell) break;
    }
    // Inalcanzable según la regla anterior; se informa en lugar de inventar una posición.
    if (!cell) return failure([issue('no-free-space', path, 'No se encontró posición para la pieza.')]);
    items.push({ cardId: placement.cardId, order: items.length, cell, display: placement.display });
    cursor = { x: cell.x, y: cell.y };
  }
  return resultOf({ boardId: layout.boardId, columns: to.columns, items }, []);
}
