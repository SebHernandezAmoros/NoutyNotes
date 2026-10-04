import type { RichTextDocument } from '@noutynotes/domain';

export interface WebRichTextEditorProps {
  readonly cardId: string;
  readonly document: RichTextDocument;
  readonly onChange: (document: RichTextDocument) => void;
}
