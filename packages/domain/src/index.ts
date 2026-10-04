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
export { captionPositions, cardIconNames, frameOverrides, textSizes, validateCard } from './cards/card';
export { MAX_TAG_LENGTH, normalizeTag, withTag, withoutTag } from './cards/tags';
export { linkDisplay, linkUrlField, normalizeLinkUrl } from './cards/links';
export type { CaptionPosition, Card, CardIconName, FrameOverride, TextSize } from './cards/card';
export { addCard, deleteCard, pasteCardsOnBoard, updateCard, updateCardAppearance } from './cards/operations';
export type { AddCardOptions, CardAppearanceChanges, CardContentChanges, DeleteCardOptions, PasteCardsInput } from './cards/operations';
export { purgeTrashedCard, restoreTrashedCard, trashCard } from './cards/trash';
export { archiveCard, archivedToTrash, restoreArchivedCard } from './cards/archive';
export { isArchiveInstant } from './cards/trashed-card';
export type { RestoreOptions, RestoreReport } from './cards/trash';
export type { ArchivedCard, TrashedCard } from './cards/trashed-card';
export { archiveBoard, restoreArchivedBoard } from './boards/archive';
export type { RestoreBoardReport } from './boards/archive';
export type { ArchivedBoard } from './boards/archived-board';
export { baseCardKinds, fieldKinds, validateCardType } from './cards/card-type';
export type { BaseCardKind, CardTypeDefinition, FieldDefinition, FieldKind } from './cards/card-type';
export { isCalendarDate, isLinkUrl } from './cards/field-values';
export type { FieldValue } from './cards/field-values';
export {
  MAX_RICH_TEXT_BLOCKS, MAX_RICH_TEXT_INLINES, MAX_RICH_TEXT_LIST_DEPTH,
  MAX_RICH_TEXT_LIST_ITEMS, MAX_RICH_TEXT_TABLE_COLUMNS, MAX_RICH_TEXT_TABLE_ROWS,
  MAX_RICH_TEXT_TEXT_LENGTH, RICH_TEXT_SCHEMA_VERSION, createEmptyRichTextDocument,
  normalizeRichTextDocument, richTextMarks, validateRichTextDocument,
} from './rich-text/rich-text';
export type {
  RichTextBlock, RichTextDocument, RichTextHardBreak, RichTextHeading, RichTextHeadingLevel,
  RichTextImage, RichTextInline, RichTextLeaf, RichTextLink, RichTextList, RichTextListItem,
  RichTextListStyle, RichTextMark, RichTextOpaqueMarkdown, RichTextParagraph, RichTextTable,
  RichTextTableCell, RichTextTableRow, RichTextTextRun,
} from './rich-text/rich-text';
export { GRID_SUBDIVISIONS, MAX_FRAME_TITLE, cardDisplayModes, isFrameTitle, validateLayout } from './layouts/layout';
export { frameAround, frameMembers, moveFrame, removeFrame, renameFrame, resizeFrame } from './layouts/frames';
export type { BoardLayout, CardDisplayMode, CardPlacement, Frame, GridRect } from './layouts/layout';
export {
  DESKTOP_GRID, MAX_GRID_COLUMNS, MOBILE_GRID, TABLET_GRID,
  cellsOverlap, compareReadingOrder, footprint, snapFineUnit, snapPoint, snapSize, snapUnit, validateGridConfig, validateGridLayout, WORLD_GRID, MAX_WORLD_CELL,
} from './layouts/grid';
export type { GridCell, GridConfig, GridPoint, GridSize } from './layouts/grid';
export { addGroup, compactLayout, findFreeSpace, moveCard, moveCards, resizeCard, setDisplay } from './layouts/operations';
export type { FindFreeSpaceOptions, SetDisplayOptions } from './layouts/operations';
export { projectLayout } from './layouts/projection';
export type { ProjectedItem, ProjectedLayout } from './layouts/projection';
export { validateRelation } from './relations/relation';
export { relationArrows } from './relations/relation';
export type { Relation, RelationArrow, RelationTypeDefinition } from './relations/relation';
export { createRelation, deleteRelation, getIncomingRelations, getOutgoingRelations, getRelatedCards, updateRelation } from './relations/operations';
export type { RelationChanges } from './relations/operations';
export { validateTemplate } from './templates/template';
// Guarda de datos inertes (JSON/YAML): sin getters, funciones, ciclos ni arrays dispersos; profundidad 64.
export { collectPlainDataIssues } from './shared/plain-data';
export type { Template, TemplateBoard, TemplateManifest } from './templates/template';
export { instantiateTemplate, duplicateTemplate } from './templates/operations';
export type { InstantiateTemplateOptions, DuplicateTemplateOptions, TemplateInstance } from './templates/operations';
export { importTemplate, exportTemplate } from './templates/exchange';
export { validateWorkspace } from './workspace/workspace';
export type { Workspace, WorkspaceMetadata } from './workspace/workspace';
