export { describeUntrustedValue, invalidWorkspaceIdFailure, storageFailure } from './workspace-storage';
export type {
  WorkspaceStorage, WorkspaceStorageErrorCode, WorkspaceStorageIssue, WorkspaceStorageResult, WorkspaceSummary,
} from './workspace-storage';
export { createEmptyWorkspace, createWorkspaceFromTemplate, modifyWorkspace } from './workspace-use-cases';
export type { CreateEmptyWorkspaceInput, CreateFromTemplateInput, WorkspaceTransform } from './workspace-use-cases';
export { nextSequentialId, workspaceIdFromName } from './ids';
export {
  CANONICAL_GRID, DEFAULT_CARD_SIZE, PROTOTYPE_BOARD, PROTOTYPE_CARD_PRESETS, RELATED_RELATION_TYPE,
  addCardToBoard, connectCards, createEmptyWorkspaceNamed, disconnectCards, editCardContent, moveCardOnBoard, resizeCardOnBoard,
} from './workspace-editing';
export type { AddCardInput, BoardCardTarget, ConnectCardsInput, PrototypeCardKind } from './workspace-editing';
