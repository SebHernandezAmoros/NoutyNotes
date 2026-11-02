import { noteImageRefs, parseNoteBlocks, richTextImageRefs, richTextInlineText } from '@noutynotes/domain';
import type { RichTextDocument } from '@noutynotes/domain';

/**
 * Extracto breve y seguro (B9-R3-01, corregido en B9-R4-01): solo párrafos/encabezados ya interpretados,
 * nunca HTML ni bloques especiales (tabla, imagen, PDF). Mismo criterio que ya usaba el panel de
 * conexiones de Presentar (B9-R2-04), generalizado aquí para que `ReadingOrderControl` identifique cada
 * fila sin duplicar la extracción en cada llamador. `content` cubre Markdown histórico; `contentDocument`,
 * Notas HTML (cuyo `content` puede estar vacío) tienen prioridad cuando existen.
 *
 * B9-R4-01: una Nota v1 (sin `contentDocument`) con una imagen intercalada mostraba antes la línea
 * `![alt](assets/...)` cruda como si fuera texto — `parseNoteBlocks` ya separa imagen de texto con el
 * mismo criterio que `noteImageRefs` (integridad), así que reutilizarlo aquí basta para que el extracto
 * nunca incluya una ruta de archivo.
 */
export function readingPreviewText(entry: { readonly content?: string; readonly contentDocument?: RichTextDocument }, maxChars = 140): string {
  const fromDocument = entry.contentDocument?.blocks
    .flatMap((block) => block.type === 'paragraph' || block.type === 'heading' ? [richTextInlineText(block.content)] : [])
    .join(' ') ?? '';
  const fromLegacyText = entry.contentDocument ? '' : parseNoteBlocks(entry.content ?? '')
    .flatMap((block) => (block.kind === 'text' ? [block.text] : [])).join(' ');
  const text = (fromDocument || fromLegacyText).replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Primera imagen representativa de una Nota (B9-R4-01): v2/HTML vía `contentDocument`, v1 histórico vía
 * el mismo criterio que ya usa `noteImageRefs` para integridad. Generalizado aquí para que cada llamador
 * (Lista, Imprimir, Presentar) resuelva la miniatura contra sus propios mapas de imágenes ya existentes,
 * sin un segundo gestor de imágenes ni duplicar bytes.
 */
export function readingThumbnailRef(entry: { readonly content?: string; readonly contentDocument?: RichTextDocument }): string | undefined {
  return entry.contentDocument ? richTextImageRefs(entry.contentDocument)[0] : noteImageRefs(entry.content ?? '')[0];
}

/** Estado de orden efímero para vistas de lectura. Los IDs pertenecen al tablero actual. */
export function reconcileReadingOrder(chosen: readonly string[], defaults: readonly string[]): string[] {
  const available = new Set(defaults);
  const retained = [...new Set(chosen)].filter((id) => available.has(id));
  return [...retained, ...defaults.filter((id) => !retained.includes(id))];
}

export function moveReadingId(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Presentation branches use existing directed relations; unavailable cards cannot be destinations. */
export function outgoingReadingTargets(current: string, visible: readonly string[], relations: readonly { readonly from: string; readonly to: string }[]): string[] {
  const allowed = new Set(visible);
  return [...new Set(relations.filter((relation) => relation.from === current && allowed.has(relation.to)).map((relation) => relation.to))];
}

/**
 * B9-R4-02: `board.cardIds` puede incluir legítimamente una tarjeta sin colocación actual (un board
 * admite miembros sin sitio — `packages/domain/src/boards/board.ts`; `printableDocument` ya la omite de
 * la salida sin tocar su membresía). Lista solo puede reordenar lo que se ve, pero debe conservar esas
 * tarjetas «sin sitio» para que la escritura final sea exactamente el mismo conjunto que `board.cardIds`
 * (`reorderCardsOnBoard` rechaza con razón cualquier conjunto incompleto). Recorre `original` y, en cada
 * posición visible, toma el siguiente ID de `newVisibleOrder` en su nuevo orden; cada posición oculta
 * conserva su mismo vecino relativo, sin moverse.
 */
export function mergeHiddenIntoOrder(original: readonly string[], newVisibleOrder: readonly string[]): string[] {
  const visible = new Set(newVisibleOrder);
  const queue = [...newVisibleOrder];
  return original.map((id) => (visible.has(id) ? queue.shift() ?? id : id));
}
