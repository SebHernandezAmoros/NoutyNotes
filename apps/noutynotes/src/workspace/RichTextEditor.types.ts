import type { RichTextCodec } from '@noutynotes/application';
import type { RichTextDocument } from '@noutynotes/domain';

export interface RichTextEditorProps {
  readonly cardId: string;
  readonly document: RichTextDocument;
  readonly codec: RichTextCodec;
  readonly onChange: (document: RichTextDocument) => void;
}
