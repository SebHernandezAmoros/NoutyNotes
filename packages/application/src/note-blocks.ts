/**
 * Contenido mixto de una nota (ADR 0021): párrafos de texto e imágenes, en el orden del Markdown.
 * Puro. Una imagen de la nota es una línea `![alt](assets/images/…)` fuera de un bloque de código; el
 * resto es texto que nunca se interpreta. Las operaciones separan los bloques con una línea en blanco.
 *
 * La lectura (`parseNoteBlocks`, `noteImageRefs`, `richTextImageRefs`, tipo `NoteBlock`) vive en el
 * dominio desde OBS-N2-02/26 (unidad U0): `purgeTrashedCard` necesita el mismo criterio de "qué
 * assets referencia una tarjeta" que ya se usaba aquí, y moverlo evita dos lectores divergentes sin
 * invertir la dependencia de dominio hacia aplicación. Se reexporta tal cual para no romper esta API.
 */
import { noteImageRefs, parseNoteBlocks, richTextImageRefs } from '@noutynotes/domain';
import type { AssetRef, NoteBlock } from '@noutynotes/domain';

export { noteImageRefs, parseNoteBlocks, richTextImageRefs };
export type { NoteBlock };

export function serializeNoteBlocks(blocks: readonly NoteBlock[]): string {
  return blocks.map((block) => (block.kind === 'image' ? `![${block.alt}](${block.ref})` : block.text)).join('\n\n');
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
