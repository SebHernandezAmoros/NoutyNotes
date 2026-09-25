export { DomainError, assertValid } from './errors';
export type { DomainIssue, DomainIssueCode, IssueLike, ValidationResult } from './errors';
export { ID_MAX_LENGTH, isValidId, parseId } from './ids';
export type {
  BoardId, CardId, CardTypeId, FieldKey, Id, RelationId, RelationTypeId, TemplateId, WorkspaceId,
} from './ids';
export { CURRENT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, isSupportedSchemaVersion } from './schema-version';

export { ASSET_REF_MAX_LENGTH, isValidAssetRef, parseAssetRef } from './assets/asset-ref';
export type { AssetRef } from './assets/asset-ref';
export { validateBoard } from './boards/board';
export type { Board } from './boards/board';
export { validateCard } from './cards/card';
export type { Card } from './cards/card';
export { addCard, deleteCard, updateCard } from './cards/operations';
export type { AddCardOptions, CardContentChanges, DeleteCardOptions } from './cards/operations';
export { baseCardKinds, fieldKinds, validateCardType } from './cards/card-type';
export type { BaseCardKind, CardTypeDefinition, FieldDefinition, FieldKind } from './cards/card-type';
export { isCalendarDate } from './cards/field-values';
export type { FieldValue } from './cards/field-values';
export { cardDisplayModes, validateLayout } from './layouts/layout';
export type { BoardLayout, CardDisplayMode, CardPlacement, GridRect } from './layouts/layout';
export {
  DESKTOP_GRID, MAX_GRID_COLUMNS, MOBILE_GRID, TABLET_GRID,
  cellsOverlap, compareReadingOrder, footprint, snapPoint, snapSize, snapUnit, validateGridConfig, validateGridLayout,
} from './layouts/grid';
export type { GridCell, GridConfig, GridPoint, GridSize } from './layouts/grid';
export { compactLayout, findFreeSpace, moveCard, resizeCard, setDisplay } from './layouts/operations';
export type { FindFreeSpaceOptions, SetDisplayOptions } from './layouts/operations';
export { projectLayout } from './layouts/projection';
export type { ProjectedItem, ProjectedLayout } from './layouts/projection';
export { validateRelation } from './relations/relation';
export type { Relation, RelationTypeDefinition } from './relations/relation';
export { createRelation, deleteRelation, getIncomingRelations, getOutgoingRelations, getRelatedCards } from './relations/operations';
export { validateTemplate } from './templates/template';
// Guarda de datos inertes (JSON/YAML): sin getters, funciones, ciclos ni arrays dispersos; profundidad 64.
export { collectExecutableContentIssues as collectPlainDataIssues } from './templates/template';
export type { Template, TemplateBoard, TemplateManifest } from './templates/template';
export { instantiateTemplate, duplicateTemplate } from './templates/operations';
export type { InstantiateTemplateOptions, DuplicateTemplateOptions, TemplateInstance } from './templates/operations';
export { importTemplate, exportTemplate } from './templates/exchange';
export { validateWorkspace } from './workspace/workspace';
export type { Workspace, WorkspaceMetadata } from './workspace/workspace';
