import { parseNoteBlocks } from '@noutynotes/application';
import type { RichTextCodec } from '@noutynotes/application';
import type { RichTextDocument } from '@noutynotes/domain';

/** Origen de los bytes de una imagen a insertar/reemplazar (UX7.1-IMAGES): subida nueva (picker del
 * sistema), ya catalogada en Assets (ASSET-04, sin copiar bytes) o recién pegada del portapapeles
 * (ASSET-06/07, bytes ya extraídos por el editor). */
export type NoteImageSource =
  | { readonly kind: 'upload' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly name: string }
  | { readonly kind: 'existing'; readonly ref: string };

/** `NoteImageSource` sin `'upload'`: la forma que ya llega con bytes resueltos (el host —
 * `InlineCardEditor`/`CardInspector`— resuelve el picker del sistema antes de pedir la escritura). */
export type ResolvedNoteImageSource = Exclude<NoteImageSource, { readonly kind: 'upload' }>;

export type VisualImagePlace =
  | { readonly kind: 'insert'; readonly afterBlock: number }
  | { readonly kind: 'replace'; readonly blockIndex: number };

export type MarkdownImagePlace =
  | { readonly kind: 'insert'; readonly caret?: number }
  | { readonly kind: 'replace'; readonly index: number };

export interface ResolvedMarkdownImagePlace {
  readonly content: string;
  readonly place: MarkdownImagePlace;
}

/**
 * Traduce una posición del documento visual (bloque N) a su posición equivalente en el Markdown que ya
 * persiste la nota — misma lógica que ya usaba `CardInspector` solo para `onInsertImage`/`onReplaceImage`,
 * ahora compartida con `InlineCardEditor` (UX7.1-IMAGES) para que ambas superficies inserten exactamente
 * igual, con cualquier origen de imagen (subida, Assets o portapapeles): «no crear implementaciones
 * diferentes de inserción para cada una».
 */
export function resolveMarkdownImagePlace(document: RichTextDocument, place: VisualImagePlace, richTextCodec: RichTextCodec): ResolvedMarkdownImagePlace | null {
  const encoded = richTextCodec.serialize(document);
  if (!encoded.ok) return null;
  const blocks = parseNoteBlocks(encoded.value);
  if (place.kind === 'replace') {
    const image = document.blocks[place.blockIndex];
    if (image?.type !== 'image') return null;
    const index = blocks.findIndex((block) => block.kind === 'image' && block.ref === image.assetRef);
    return { content: encoded.value, place: { kind: 'replace', index } };
  }
  // La leyenda portable se serializa como un bloque técnico después de la imagen. Se cuenta como parte
  // de esa imagen para que la inserción respete el orden que el usuario ve en el editor.
  let rawIndex = -1;
  let cursor = 0;
  for (let index = 0; index <= place.afterBlock && index < document.blocks.length; index += 1) {
    const visualBlock = document.blocks[index];
    if (!visualBlock) continue;
    if (visualBlock.type === 'image') {
      const imageIndex = blocks.findIndex((block, candidate) => candidate >= cursor && block.kind === 'image' && block.ref === visualBlock.assetRef);
      if (imageIndex >= 0) {
        rawIndex = imageIndex;
        cursor = imageIndex + 1;
        const captionBlock = blocks[cursor];
        if (visualBlock.caption && captionBlock?.kind === 'text' && captionBlock.text.startsWith('<!-- nouty-caption:v1:')) {
          rawIndex = cursor;
          cursor += 1;
        }
      }
    } else {
      const textIndex = blocks.findIndex((block, candidate) => candidate >= cursor && block.kind === 'text' && !block.text.startsWith('<!-- nouty-caption:v1:'));
      if (textIndex >= 0) { rawIndex = textIndex; cursor = textIndex + 1; }
    }
  }
  const caret = blocks[rawIndex]?.start ?? encoded.value.length;
  return { content: encoded.value, place: { kind: 'insert', caret } };
}
