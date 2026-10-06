import type { RichTextCodec } from '@noutynotes/application';
import type { RichTextDocument, RichTextImage } from '@noutynotes/domain';

export interface RichTextEditorProps {
  readonly cardId: string;
  readonly document: RichTextDocument;
  readonly codec: RichTextCodec;
  readonly onChange: (document: RichTextDocument) => void;
  readonly images?: ReadonlyMap<string, string>;
  readonly captionPosition?: 'bottom' | 'top' | 'left' | 'right';
  readonly fontFamily?: string | undefined;
  readonly onInsertImage?: ((document: RichTextDocument, afterBlock: number) => Promise<RichTextImage | null>) | undefined;
  readonly onReplaceImage?: ((document: RichTextDocument, blockIndex: number) => Promise<RichTextImage | null>) | undefined;
  /** Reduce la altura del editor cuando se monta directamente sobre una ficha del lienzo. */
  readonly compact?: boolean;
}
