import type { CardId, RichTextDocument } from '@noutynotes/domain';

export type DiaryEditing = {
  readonly id: CardId;
  readonly title: string;
  readonly document: RichTextDocument;
  readonly initialTitle: string;
  readonly initialDocument: RichTextDocument;
};

const sameContent = (left: DiaryEditing, right: DiaryEditing) => left.title === right.title
  && JSON.stringify(left.document) === JSON.stringify(right.document);

export const diaryEditingDirty = (editing: DiaryEditing | null) => editing !== null
  && (editing.title !== editing.initialTitle
    || JSON.stringify(editing.document) !== JSON.stringify(editing.initialDocument));

/**
 * Persiste una revisión y vuelve a comprobar el borrador al terminar. Si el usuario
 * escribió durante el guardado, guarda también esa revisión antes de permitir que
 * la vista se cierre o navegue a otro día.
 */
export async function persistLatestDiaryRevision(
  initial: DiaryEditing,
  latestRevision: () => DiaryEditing | null,
  save: (revision: DiaryEditing) => Promise<boolean>,
): Promise<boolean> {
  let revision = initial;
  while (diaryEditingDirty(revision)) {
    if (!await save(revision)) return false;
    const latest = latestRevision();
    if (!latest || latest.id !== revision.id || sameContent(latest, revision)) return true;
    revision = {
      ...latest,
      initialTitle: revision.title,
      initialDocument: revision.document,
    };
  }
  return true;
}
