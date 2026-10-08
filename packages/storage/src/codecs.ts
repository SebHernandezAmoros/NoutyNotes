import { validateLayout, validateRelation } from '@noutynotes/domain';
import type { BoardLayout, DomainIssue, Relation } from '@noutynotes/domain';
import { z } from 'zod';

import { checkShape, duplicateIdIssues, plainDataIssues, readVersionedYaml, reprefix } from './documents';
import { fail, located, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { layoutFileSchema, layoutSchema, relationSchema, relationsFileSchema } from './schemas';
import { stringifyYaml } from './yaml';

export const RELATIONS_FILE = '.nouty/relations.yaml';
export const LAYOUT_FILE = '.nouty/layout.yaml';

/** Copia sin propiedades opcionales ausentes, para que el YAML no contenga `undefined`. */
export function relationData(relation: Relation): Relation {
  return {
    id: relation.id, typeId: relation.typeId, from: relation.from, to: relation.to,
    ...(relation.label === undefined ? {} : { label: relation.label }),
    // «forward» es el valor por defecto (ADR 0034): no se escribe, para no forzar v2 sin necesidad.
    ...(relation.arrow === undefined || relation.arrow === 'forward' ? {} : { arrow: relation.arrow }),
  };
}

/** Solo una flecha distinta de «forward» necesita el esquema 2; los archivos viejos conservan v1. */
export function relationsSchemaVersion(relations: readonly Relation[]): 1 | 2 {
  return relations.some((relation) => relation.arrow !== undefined && relation.arrow !== 'forward') ? 2 : 1;
}

export function layoutData(layout: BoardLayout): BoardLayout {
  return {
    boardId: layout.boardId,
    placements: layout.placements.map(({ cardId, rect, display, connectorPath }) => ({ cardId, display, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      ...(connectorPath === undefined ? {} : { connectorPath: connectorPath.map(({ x, y }) => ({ x, y })) }) })),
    // Marcos (ADR 0027): solo si hay; sin ellos, los bytes v1/v2 no cambian.
    ...(layout.frames === undefined ? {} : { frames: layout.frames.map(({ id, title, rect }) => ({ id, title, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } })) }),
  };
}

/** Invariantes del dominio para cada relación y unicidad de IDs dentro del documento. */
export function relationIssues(relations: readonly Relation[], path: string, version: 1 | 2 = 1): (StorageIssue | DomainIssue)[] {
  const issues: (StorageIssue | DomainIssue)[] = [];
  relations.forEach((relation, index) => {
    const checked = validateRelation(relation);
    if (!checked.ok) issues.push(...reprefix(checked.issues, 'relation', `${path}[${index}]`));
    if (version === 1 && relation.arrow !== undefined) {
      issues.push({ code: 'invalid-value', path: `${path}[${index}].arrow`, message: 'La versión 1 no admite estilo de flecha.' });
    }
  });
  return [...issues, ...duplicateIdIssues(relations.map((relation) => relation.id), path, 'las relaciones')];
}

export function layoutIssues(layouts: readonly BoardLayout[], path: string, version: 1 | 2 | 3 | 4 | 5 = 1): (StorageIssue | DomainIssue)[] {
  const issues: (StorageIssue | DomainIssue)[] = [];
  const hasFractions = layouts.some((layout) => layout.placements.some((placement) => Object.values(placement.rect).some((value) => !Number.isInteger(value))));
  if (version === 4 && !hasFractions) issues.push({ code: 'invalid-layout', path, message: 'La versión 4 exige al menos una coordenada subdividida.' });
  const hasConnectorPath = layouts.some((layout) => layout.placements.some((placement) => placement.connectorPath !== undefined));
  if (version === 5 && !hasConnectorPath) issues.push({ code: 'invalid-layout', path, message: 'La versión 5 exige al menos una ruta de conector.' });
  layouts.forEach((layout, index) => {
    const checked = validateLayout(layout);
    if (!checked.ok) issues.push(...reprefix(checked.issues, 'layout', `${path}[${index}]`));
    if (version < 3 && layout.frames !== undefined) {
      issues.push({ code: 'invalid-layout', path: `${path}[${index}].frames`, message: `La versión ${version} no admite marcos.` });
    }
    if (version < 5) layout.placements.forEach((placement, placementIndex) => {
      if (placement.connectorPath !== undefined) issues.push({ code: 'invalid-layout', path: `${path}[${index}].placements[${placementIndex}].connectorPath`, message: `La versión ${version} no admite rutas de conector.` });
    });
    if (version < 4) layout.placements.forEach((placement, placementIndex) => {
      for (const axis of ['x', 'y', 'w', 'h'] as const) if (!Number.isInteger(placement.rect[axis])) {
        issues.push({ code: 'invalid-layout', path: `${path}[${index}].placements[${placementIndex}].rect.${axis}`, message: `La versión ${version} no admite subdivisiones.` });
      }
    });
    if (version === 1) layout.placements.forEach((placement, placementIndex) => {
      for (const axis of ['x', 'y'] as const) {
        if (typeof placement.rect?.[axis] === 'number' && placement.rect[axis] < 0) {
          issues.push({ code: 'invalid-layout', path: `${path}[${index}].placements[${placementIndex}].rect.${axis}`, message: 'La versión 1 no admite posiciones negativas.' });
        }
      }
    });
  });
  return [...issues, ...duplicateIdIssues(layouts.map((layout) => layout.boardId), path, 'los layouts (uno por board)')];
}

/** Marcos: esquema 3 (ADR 0027). Coordenadas negativas: 2. Los archivos viejos conservan v1. */
export function layoutSchemaVersion(layouts: readonly BoardLayout[]): 1 | 2 | 3 | 4 | 5 {
  if (layouts.some((layout) => layout.placements.some((placement) => placement.connectorPath !== undefined))) return 5;
  if (layouts.some((layout) => layout.placements.some((placement) => Object.values(placement.rect).some((value) => !Number.isInteger(value))))) return 4;
  if (layouts.some((layout) => layout.frames !== undefined)) return 3;
  return layouts.some((layout) => layout.placements.some((placement) => placement.rect.x < 0 || placement.rect.y < 0)) ? 2 : 1;
}

/** Datos inertes y de forma cerrada antes de leer ningún campo; las rutas empiezan en `root`. */
function checkInput<T>(value: unknown, root: string, schema: z.ZodType<T>): StorageResult<T> {
  const inert = plainDataIssues(value, root);
  if (inert.length > 0) return fail(inert);
  return checkShape(schema, value, root);
}

export function serializeRelations(relations: readonly Relation[]): StorageResult<string> {
  const shaped = checkInput(relations, 'relations', z.array(relationSchema));
  if (!shaped.ok) return shaped;
  const version = relationsSchemaVersion(relations);
  const issues = relationIssues(relations, 'relations', version);
  if (issues.length > 0) return fail(issues);
  return succeed(stringifyYaml({ schemaVersion: version, relations: relations.map(relationData) }));
}

export function parseRelations(text: string, file = RELATIONS_FILE): StorageResult<Relation[]> {
  const read = readVersionedYaml(text, file, relationsFileSchema, [1, 2]);
  if (!read.ok) return read;
  // Forma comprobada por Zod; las invariantes (IDs, autoenlaces, unicidad) se validan a continuación.
  const relations = read.value.relations.map((relation) => relationData(relation as unknown as Relation));
  const issues = relationIssues(relations, 'relations', read.value.schemaVersion);
  return issues.length > 0 ? fail(located(issues, file)) : succeed(relations);
}

export function serializeLayouts(layouts: readonly BoardLayout[]): StorageResult<string> {
  const shaped = checkInput(layouts, 'layouts', z.array(layoutSchema));
  if (!shaped.ok) return shaped;
  const version = layoutSchemaVersion(layouts);
  const issues = layoutIssues(layouts, 'layouts', version);
  if (issues.length > 0) return fail(issues);
  return succeed(stringifyYaml({ schemaVersion: version, layouts: layouts.map(layoutData) }));
}

export function parseLayouts(text: string, file = LAYOUT_FILE): StorageResult<BoardLayout[]> {
  const read = readVersionedYaml(text, file, layoutFileSchema, [1, 2, 3, 4, 5]);
  if (!read.ok) return read;
  // Forma comprobada por Zod; enteros, modos y colocaciones se validan a continuación.
  const layouts = read.value.layouts.map((layout) => layoutData(layout as unknown as BoardLayout));
  const issues = layoutIssues(layouts, 'layouts', read.value.schemaVersion);
  return issues.length > 0 ? fail(located(issues, file)) : succeed(layouts);
}
