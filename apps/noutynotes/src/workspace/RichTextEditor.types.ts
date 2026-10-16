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
  /** UX7.1-IMAGES: inserta una imagen YA catalogada en Assets, por referencia (ASSET-04). Mismo
   * punto de inserción que `onInsertImage`; el host abre el selector y reutiliza el `AssetRef` elegido. */
  readonly onInsertImageFromAssets?: ((document: RichTextDocument, afterBlock: number) => Promise<RichTextImage | null>) | undefined;
  /** UX7.1-IMAGES: bytes de una imagen pegada desde el portapapeles (ASSET-06/07); el host valida,
   * guarda el asset nuevo y devuelve el bloque a insertar, igual que `onInsertImage`. */
  readonly onPasteImage?: ((document: RichTextDocument, afterBlock: number, file: { readonly bytes: Uint8Array; readonly name: string }) => Promise<RichTextImage | null>) | undefined;
  /** UX7.1-IMAGES-FIX: el HTML pegado traía una etiqueta `<img>` pero el portapapeles no entregó sus
   * bytes (origen remoto/entre páginas sin permiso de copia real) — se avisa en vez de perder la imagen
   * en silencio; el resto del texto pegado sigue insertándose con normalidad. */
  readonly onPasteImageRejected?: ((message: string) => void) | undefined;
  readonly onOpenFullEditor?: (() => void) | undefined;
  /** Reduce la altura del editor cuando se monta directamente sobre una ficha del lienzo. */
  readonly compact?: boolean;
  /** Oculta solo las herramientas sin desmontar el documento ni su selección. */
  readonly toolbarCollapsed?: boolean;
  /** Título de una sola línea: solo formato inline y sin bloques, tablas o imágenes. */
  readonly titleOnly?: boolean;
}
