import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import type { GridPoint } from './grid';

export type ConnectorRoutePoint = GridPoint;
export type ConnectorBendOrientation = 'horizontal-first' | 'vertical-first';

const MAX_CONNECTOR_POINTS = 64;
const isGridUnit = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value) && (Number.isSafeInteger(value) || Number.isSafeInteger(value * 4));
const same = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
const aligned = (a: GridPoint, b: GridPoint) => a.x === b.x || a.y === b.y;

/** Ruta portable: al menos dos puntos en cuartos de celda y ningún tramo diagonal o vacío. */
export function validateConnectorPath(points: readonly ConnectorRoutePoint[]): ValidationResult<readonly ConnectorRoutePoint[]> {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_CONNECTOR_POINTS) {
    return failure([issue('invalid-layout', 'connectorPath', `Debe tener entre 2 y ${MAX_CONNECTOR_POINTS} puntos.`)]);
  }
  const issues = points.flatMap((point, index) => {
    if (typeof point !== 'object' || point === null || Array.isArray(point) || !isGridUnit(point.x) || !isGridUnit(point.y)) {
      return [issue('invalid-layout', `connectorPath[${index}]`, 'Debe usar coordenadas de grilla en cuartos.')];
    }
    if (index > 0 && (!aligned(points[index - 1] as ConnectorRoutePoint, point) || same(points[index - 1] as ConnectorRoutePoint, point))) {
      return [issue('invalid-layout', `connectorPath[${index}]`, 'Cada tramo debe ser horizontal o vertical y tener longitud.')];
    }
    return [];
  });
  return issues.length > 0 ? failure(issues) : resultOf(points, []);
}

function compact(points: readonly ConnectorRoutePoint[]): ConnectorRoutePoint[] {
  const unique = points.filter((point, index) => index === 0 || !same(point, points[index - 1] as ConnectorRoutePoint));
  const result: ConnectorRoutePoint[] = [];
  for (const point of unique) {
    const previous = result[result.length - 1];
    const before = result[result.length - 2];
    if (before && previous && ((before.x === previous.x && previous.x === point.x) || (before.y === previous.y && previous.y === point.y))) {
      result[result.length - 1] = point;
    } else result.push(point);
  }
  return result;
}

export function createOrthogonalConnectorPath(
  start: ConnectorRoutePoint,
  end: ConnectorRoutePoint,
  orientation: ConnectorBendOrientation = 'horizontal-first',
): readonly ConnectorRoutePoint[] {
  if (start.x === end.x || start.y === end.y) return [start, end];
  const elbow = orientation === 'horizontal-first' ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
  return [start, elbow, end];
}

/** Mueve un punto y recompone los dos tramos vecinos sin alterar los extremos restantes. */
export function moveConnectorPoint(
  points: readonly ConnectorRoutePoint[], index: number, to: ConnectorRoutePoint,
): readonly ConnectorRoutePoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length || !isGridUnit(to.x) || !isGridUnit(to.y)) return points;
  if (index === 0) return createOrthogonalConnectorPath(to, points[points.length - 1] as ConnectorRoutePoint);
  if (index === points.length - 1) return createOrthogonalConnectorPath(points[0] as ConnectorRoutePoint, to);
  const before = points.slice(0, index - 1);
  const after = points.slice(index + 2);
  const previous = points[index - 1] as ConnectorRoutePoint;
  const next = points[index + 1] as ConnectorRoutePoint;
  const into = createOrthogonalConnectorPath(previous, to, previous.x === (points[index] as ConnectorRoutePoint).x ? 'vertical-first' : 'horizontal-first');
  const out = createOrthogonalConnectorPath(to, next, (points[index] as ConnectorRoutePoint).x === next.x ? 'vertical-first' : 'horizontal-first');
  return compact([...before, ...into, ...out.slice(1), ...after]);
}

/** Añade un desvío rectangular a un tramo; el desplazamiento se expresa en unidades de grilla. */
export function addConnectorDetour(
  points: readonly ConnectorRoutePoint[], segmentIndex: number, offset = 1,
): readonly ConnectorRoutePoint[] {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end || !isGridUnit(offset) || offset === 0 || !aligned(start, end)) return points;
  if (start.y === end.y) {
    const middle = Math.round(((start.x + end.x) / 2) * 4) / 4;
    return compact([...points.slice(0, segmentIndex + 1), { x: middle, y: start.y }, { x: middle, y: start.y + offset },
      { x: end.x, y: start.y + offset }, ...points.slice(segmentIndex + 1)]);
  }
  const middle = Math.round(((start.y + end.y) / 2) * 4) / 4;
  return compact([...points.slice(0, segmentIndex + 1), { x: start.x, y: middle }, { x: start.x + offset, y: middle },
    { x: start.x + offset, y: end.y }, ...points.slice(segmentIndex + 1)]);
}

export function resetConnectorPath(
  points: readonly ConnectorRoutePoint[], orientation: ConnectorBendOrientation = 'horizontal-first',
): readonly ConnectorRoutePoint[] {
  const start = points[0];
  const end = points[points.length - 1];
  return start && end ? createOrthogonalConnectorPath(start, end, orientation) : points;
}

/** Quita un punto interior y recompone localmente una unión ortogonal entre sus vecinos. */
export function removeConnectorPoint(
  points: readonly ConnectorRoutePoint[], index: number,
): readonly ConnectorRoutePoint[] {
  if (!Number.isInteger(index) || index <= 0 || index >= points.length - 1) return points;
  const previous = points[index - 1] as ConnectorRoutePoint;
  const next = points[index + 1] as ConnectorRoutePoint;
  const removed = points[index] as ConnectorRoutePoint;
  const orientation: ConnectorBendOrientation = previous.x === removed.x ? 'vertical-first' : 'horizontal-first';
  const bridge = createOrthogonalConnectorPath(previous, next, orientation);
  return compact([...points.slice(0, index - 1), ...bridge, ...points.slice(index + 2)]);
}
