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
  };
}

export function layoutData(layout: BoardLayout): BoardLayout {
  return {
    boardId: layout.boardId,
    placements: layout.placements.map(({ cardId, rect, display }) => ({ cardId, display, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } })),
  };
}

/** Invariantes del dominio para cada relación y unicidad de IDs dentro del documento. */
export function relationIssues(relations: readonly Relation[], path: string): (StorageIssue | DomainIssue)[] {
  const issues: (StorageIssue | DomainIssue)[] = [];
  relations.forEach((relation, index) => {
    const checked = validateRelation(relation);
    if (!checked.ok) issues.push(...reprefix(checked.issues, 'relation', `${path}[${index}]`));
  });
  return [...issues, ...duplicateIdIssues(relations.map((relation) => relation.id), path, 'las relaciones')];
}

export function layoutIssues(layouts: readonly BoardLayout[], path: string, version: 1 | 2 = 1): (StorageIssue | DomainIssue)[] {
  const issues: (StorageIssue | DomainIssue)[] = [];
  layouts.forEach((layout, index) => {
    const checked = validateLayout(layout);
    if (!checked.ok) issues.push(...reprefix(checked.issues, 'layout', `${path}[${index}]`));
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

/** Solo un layout con coordenadas negativas necesita el esquema 2; los archivos viejos conservan v1. */
export function layoutSchemaVersion(layouts: readonly BoardLayout[]): 1 | 2 {
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
  const issues = relationIssues(relations, 'relations');
  if (issues.length > 0) return fail(issues);
  return succeed(stringifyYaml({ schemaVersion: 1, relations: relations.map(relationData) }));
}

export function parseRelations(text: string, file = RELATIONS_FILE): StorageResult<Relation[]> {
  const read = readVersionedYaml(text, file, relationsFileSchema);
  if (!read.ok) return read;
  // Forma comprobada por Zod; las invariantes (IDs, autoenlaces, unicidad) se validan a continuación.
  const relations = read.value.relations.map((relation) => relationData(relation as unknown as Relation));
  const issues = relationIssues(relations, 'relations');
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
  const read = readVersionedYaml(text, file, layoutFileSchema, [1, 2]);
  if (!read.ok) return read;
  // Forma comprobada por Zod; enteros, modos y colocaciones se validan a continuación.
  const layouts = read.value.layouts.map((layout) => layoutData(layout as unknown as BoardLayout));
  const issues = layoutIssues(layouts, 'layouts', read.value.schemaVersion);
  return issues.length > 0 ? fail(located(issues, file)) : succeed(layouts);
}
