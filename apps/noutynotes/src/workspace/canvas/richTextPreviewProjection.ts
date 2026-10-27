import type { RichTextBlock, RichTextDocument, RichTextInline, RichTextList, RichTextListItem } from '@noutynotes/domain';

import { estimatePreviewLines } from './previewOverflow';

/** Costo aproximado en «renglones» de un bloque de imagen sin dimensiones propias: calibrado para que
 * coincida con el alto histórico de una miniatura (`THUMB`/`IMAGE_HEIGHT` ≈ 72-88px a la tipografía
 * habitual). Único valor compartido entre `blockLines` (abajo) y la estimación de `CanvasCard.tsx`
 * para decidir si hace falta el lector completo — antes esa segunda estimación ignoraba a las
 * imágenes por completo (OBS-N2-28/G1, corrección de regresión de texto omitido). */
export const IMAGE_BLOCK_LINES = 5;

/** Texto plano de contenido en línea (sin HTML ni Markdown): un salto de línea por salto duro o por
 * una línea nueva dentro de un enlace. Vive aquí (compartido, en vez de duplicado en `CanvasCard.tsx`)
 * porque tanto el recorte de la previsualización como la estimación de Canvas necesitan el mismo
 * texto plano para medir renglones reales por ancho. */
export function inlinePlainText(content: readonly RichTextInline[]): string {
  return content.map((inline) => inline.type === 'link'
    ? inline.content.map((leaf) => leaf.type === 'text' ? leaf.text : '\n').join('')
    : inline.type === 'text' ? inline.text : '\n').join('');
}

/** Renglones reales de un fragmento en línea: a diferencia del cálculo histórico (solo saltos de línea
 * explícitos), estima también el envoltorio visual por el ancho real disponible — reutiliza la misma
 * fórmula ya probada de `estimatePreviewLines` (antes solo usada por `previewOverflow.ts`), en vez de
 * duplicar el cálculo de ancho de carácter (OBS-N2-28/G1, corrección de regresión). */
function inlineLines(content: readonly RichTextInline[], width: number, fontSize: number): number {
  return estimatePreviewLines(inlinePlainText(content), width, fontSize);
}

function listLines(list: RichTextList, width: number, fontSize: number): number {
  return list.items.reduce((total, item) => total + inlineLines(item.content, width, fontSize)
    + (item.children?.reduce((nested, child) => nested + listLines(child, width, fontSize), 0) ?? 0), 0);
}

/** Costo aproximado en «renglones» de un bloque, usado tanto para decidir qué cabe en la
 * previsualización (recorte de texto) como, para imágenes de una Nota banner (OBS-N2-28/G1), para
 * calcular cuánto espacio le queda disponible al no ser ya un bloque de texto. `width`/`fontSize` son
 * obligatorios para los bloques de texto: sin ellos, un párrafo largo sin saltos de línea explícitos
 * siempre «costaría» 1 renglón sin importar cuánto ocupe realmente al envolver (la causa confirmada de
 * OBS-N2-RICHTEXT-CANVAS-VISIBILITY). */
export function blockLines(block: RichTextBlock, width: number, fontSize: number): number {
  if (block.type === 'pdf') return Math.ceil(84 / Math.round(fontSize * 1.35));
  if (block.type === 'retired-image') return 2 + estimatePreviewLines(block.alt, width, fontSize) + inlineLines(block.caption ?? [], width, fontSize);
  if (block.type === 'paragraph' || block.type === 'heading') return inlineLines(block.content, width, fontSize);
  if (block.type === 'opaque-markdown') return Math.max(1, block.source.split('\n').length);
  if (block.type === 'list') return listLines(block, width, fontSize);
  if (block.type === 'table') return (block.header ? 1 : 0) + block.rows.length;
  return IMAGE_BLOCK_LINES;
}

function projectList(list: RichTextList, budget: { value: number }, width: number, fontSize: number): RichTextList | null {
  const items: RichTextListItem[] = [];
  for (const item of list.items) {
    if (budget.value <= 0) break;
    budget.value -= Math.min(budget.value, inlineLines(item.content, width, fontSize));
    const children: RichTextList[] = [];
    const { children: sourceChildren, ...itemWithoutChildren } = item;
    for (const child of sourceChildren ?? []) {
      const projected = projectList(child, budget, width, fontSize);
      if (projected) children.push(projected);
      if (budget.value <= 0) break;
    }
    items.push(children.length > 0 ? { ...itemWithoutChildren, children } : itemWithoutChildren);
  }
  return items.length > 0 ? { ...list, items } : null;
}

function projectBlocks(document: RichTextDocument, capacity: number, width: number, fontSize: number): readonly RichTextBlock[] {
  const budget = { value: Math.max(0, capacity) };
  const blocks: RichTextBlock[] = [];
  for (const block of document.blocks) {
    if (budget.value <= 0) break;
    if (block.type === 'list') {
      const projected = projectList(block, budget, width, fontSize);
      if (projected) blocks.push(projected);
      continue;
    }
    if (block.type === 'table') {
      const header = block.header && budget.value > 0 ? block.header : undefined;
      if (header) budget.value -= 1;
      const rows = block.rows.slice(0, budget.value);
      budget.value -= rows.length;
      if (header) blocks.push({ ...block, header, rows });
      else if (rows.length > 0) {
        const { header: sourceHeader, ...tableWithoutHeader } = block;
        void sourceHeader;
        blocks.push({ ...tableWithoutHeader, rows });
      }
      continue;
    }
    if (block.type === 'pdf' || block.type === 'image' || block.type === 'retired-image') {
      // Una imagen se muestra entera o no se muestra (OBS-N2-28/G1, corrección de regresión de texto
      // omitido): a diferencia de un bloque de texto, su alto real en pantalla tiene un piso fijo
      // (`bannerImageHeight`/`bannerImageBudget`) que no baja aunque el presupuesto restante sea menor.
      // Cobrarle solo lo que sobraba del presupuesto (como antes) contradecía ese alto real: la imagen
      // terminaba ocupando más píxeles de los que esta selección le había «reservado», y ese déficit lo
      // absorbía en pantalla el bloque de texto más próximo (encogiéndolo hasta volverse invisible) en
      // vez de quedar reflejado en `hiddenLines`.
      const cost = blockLines(block, width, fontSize);
      if (budget.value < cost) continue;
      blocks.push(block);
      budget.value -= cost;
      continue;
    }
    blocks.push(block);
    budget.value -= Math.min(budget.value, blockLines(block, width, fontSize));
  }
  return blocks;
}

/** Proyecta solo el principio visible de un documento sin alterar el documento durable. `width`/
 * `fontSize` permiten estimar renglones reales por envoltorio visual, no solo por saltos de línea
 * explícitos (OBS-N2-28/G1, corrección de regresión de texto omitido). */
export function projectRichTextPreview(document: RichTextDocument, capacity: number, width: number, fontSize: number, reserveOverflowLine = false): {
  readonly document: RichTextDocument;
  readonly hiddenLines: number;
} {
  const totalLines = document.blocks.reduce((total, block) => total + blockLines(block, width, fontSize), 0);
  const visibleCapacity = reserveOverflowLine && totalLines > capacity ? Math.max(0, capacity - 1) : Math.max(0, capacity);
  return {
    document: { schemaVersion: document.schemaVersion, blocks: projectBlocks(document, visibleCapacity, width, fontSize) },
    hiddenLines: Math.max(0, totalLines - visibleCapacity),
  };
}
