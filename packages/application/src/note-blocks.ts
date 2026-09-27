/**
 * Contenido mixto de una nota (ADR 0021): párrafos de texto e imágenes, en el orden del Markdown.
 * Puro. Una imagen de la nota es una línea `![alt](assets/images/…)` fuera de un bloque de código; el
 * resto es texto que nunca se interpreta. Las operaciones separan los bloques con una línea en blanco.
 */
import { isValidAssetRef } from '@noutynotes/domain';
import type { AssetRef } from '@noutynotes/domain';

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

export function serializeNoteBlocks(blocks: readonly NoteBlock[]): string {
  return blocks.map((block) => (block.kind === 'image' ? `![${block.alt}](${block.ref})` : block.text)).join('\n\n');
}

/** Referencias de las imágenes de la nota, en orden y sin repetir. */
export function noteImageRefs(content: string): AssetRef[] {
  return [...new Set(parseNoteBlocks(content).flatMap((block) => (block.kind === 'image' ? [block.ref] : [])))];
}

/** Texto alternativo en una línea y sin corchetes, para que la línea siga siendo una imagen. */
function cleanAlt(alt: string): string {
  return alt.replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Inserta una imagen después del párrafo donde está el cursor; sin cursor, al final. */
export function insertImageBlock(content: string, caret: number | undefined, ref: AssetRef | string, alt: string): string {
  const blocks = parseNoteBlocks(content);
  const image: NoteBlock = { kind: 'image', alt: cleanAlt(alt), ref: ref as AssetRef, start: 0 };
  let after = blocks.length - 1;
  if (caret !== undefined) {
    // Último bloque que empieza antes del cursor (sin `findLastIndex`: la librería del proyecto es anterior a ES2023).
    after = blocks.reduce((found, block, index) => (block.start <= caret ? index : found), -1);
  }
  return serializeNoteBlocks([...blocks.slice(0, after + 1), image, ...blocks.slice(after + 1)]);
}

/** Intercambia el bloque con su vecino (`delta` −1 o +1). Fuera de rango, no cambia nada. */
export function moveNoteBlock(content: string, index: number, delta: -1 | 1): string {
  const blocks = parseNoteBlocks(content);
  const target = index + delta;
  const moving = blocks[index];
  const other = blocks[target];
  if (!moving || !other) return content;
  const next = [...blocks];
  next[index] = other;
  next[target] = moving;
  return serializeNoteBlocks(next);
}

export function removeNoteBlock(content: string, index: number): string {
  const blocks = parseNoteBlocks(content);
  return blocks[index] ? serializeNoteBlocks(blocks.filter((_, position) => position !== index)) : content;
}

function withImage(content: string, index: number, change: (image: Extract<NoteBlock, { kind: 'image' }>) => NoteBlock): string {
  const blocks = parseNoteBlocks(content);
  const block = blocks[index];
  if (block?.kind !== 'image') return content;
  return serializeNoteBlocks(blocks.map((candidate, position) => (position === index ? change(block) : candidate)));
}

export function replaceNoteImage(content: string, index: number, ref: AssetRef | string): string {
  return withImage(content, index, (image) => ({ ...image, ref: ref as AssetRef }));
}

/**
 * Cambia el texto alternativo mientras se escribe: solo se quitan corchetes y saltos de línea (que
 * romperían la línea); los espacios se respetan para poder escribir varias palabras.
 */
export function setNoteImageAlt(content: string, index: number, alt: string): string {
  return withImage(content, index, (image) => ({ ...image, alt: alt.replace(/[[\]\r\n]+/g, ' ') }));
}

/**
 * `assetRefs` tras cambiar el contenido: se quitan solo las imágenes que estaban en el texto anterior y
 * ya no están, y se añaden las nuevas. Las referencias que la nota no gestiona se conservan.
 */
export function syncNoteAssetRefs(existing: readonly AssetRef[] | readonly string[] | undefined, before: string, after: string): AssetRef[] {
  const now = noteImageRefs(after);
  const gone = new Set(noteImageRefs(before).filter((ref) => !now.includes(ref)));
  return [...new Set([...(existing ?? []).filter((ref) => !gone.has(ref as AssetRef)) as AssetRef[], ...now])];
}
