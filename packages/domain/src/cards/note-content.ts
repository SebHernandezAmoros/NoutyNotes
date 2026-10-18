/**
 * Lectura pura del contenido Markdown heredado de una Nota (ADR 0021): párrafos de texto e imágenes,
 * en el orden del Markdown. Una imagen de la nota es una línea `![alt](assets/images/…)` fuera de un
 * bloque de código; el resto es texto que nunca se interpreta.
 *
 * Vive en el dominio (OBS-N2-02/26, unidad U0) porque `purgeTrashedCard` necesita el mismo criterio de
 * "qué assets referencia una tarjeta" que ya usaba `cardAssetRefs` en aplicación — moverlo aquí evita
 * dos lectores divergentes sin invertir la dependencia de dominio hacia aplicación. Las operaciones de
 * escritura sobre el Markdown (insertar, mover, reemplazar un bloque…) siguen en
 * `packages/application/src/note-blocks.ts`, que reexporta este módulo para no romper su API pública.
 */
import { isValidAssetRef } from '../assets/asset-ref';
import type { AssetRef } from '../assets/asset-ref';

export type NoteBlock =
  | { readonly kind: 'text'; readonly text: string; readonly start: number }
  | { readonly kind: 'image'; readonly alt: string; readonly ref: AssetRef; readonly start: number };

const IMAGE_LINE = /^!\[([^\]\n]*)\]\(([^)\s]+)\)\s*$/;
const FENCE = /^\s*(```|~~~)/;

function imageOf(line: string): { alt: string; ref: AssetRef } | null {
  const match = IMAGE_LINE.exec(line);
  const ref = match?.[2];
  if (!match || !ref || !ref.startsWith('assets/images/') || !isValidAssetRef(ref)) return null;
  return { alt: match[1] ?? '', ref: ref as AssetRef };
}

/** Párrafos (separados por líneas en blanco) e imágenes, con su posición en el texto original. */
export function parseNoteBlocks(content: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let paragraphStart = 0;
  let fence: string | null = null;
  let offset = 0;
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'text', text: paragraph.join('\n'), start: paragraphStart });
    paragraph = [];
  };
  for (const line of (typeof content === 'string' ? content : '').split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence !== null) {
      paragraph.push(line);
      if (fenceMark === fence) fence = null;
      continue;
    }
    if (fenceMark) {
      if (paragraph.length === 0) paragraphStart = lineStart;
      paragraph.push(line);
      fence = fenceMark;
      continue;
    }
    const image = imageOf(line);
    if (image) {
      flush();
      blocks.push({ kind: 'image', ...image, start: lineStart });
    } else if (line.trim() === '') {
      flush();
    } else {
      if (paragraph.length === 0) paragraphStart = lineStart;
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Referencias de las imágenes de la nota, en orden y sin repetir. */
export function noteImageRefs(content: string): AssetRef[] {
  return [...new Set(parseNoteBlocks(content).flatMap((block) => (block.kind === 'image' ? [block.ref] : [])))];
}
