import type { DraftSource, DraftValidation } from '@noutynotes/application';
import type { CardId, RichTextDocument } from '@noutynotes/domain';

/** Local edits publish immediately; only durable autosave waits for a pause. */
export const EDITOR_AUTOSAVE = { idleMs: 1200, maxWaitMs: 5000 } as const;

/** Datos editoriales compartidos por una sola sesión; `content` conserva el transporte legado. */
export interface EditableCardDraft {
  readonly cardId: CardId;
  readonly title: string;
  readonly content: string;
  readonly titleDocument?: RichTextDocument;
  readonly bodySource?: DraftSource;
  readonly bodyDocument?: RichTextDocument;
  readonly bodyValidation?: DraftValidation;
}
