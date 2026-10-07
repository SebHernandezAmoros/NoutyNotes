/**
 * Documento HTML para imprimir un tablero (ADR 0031), en una pestaña propia. Puro: no toca el DOM ni
 * abre nada; eso lo hace quien lo llama. El contenido de las tarjetas es texto del usuario y nunca se
 * interpreta como HTML: todo pasa por `escapeHtml`, igual que el resto de la app no ejecuta HTML/JS de una nota.
 */
import { parseNoteBlocks } from '@noutynotes/application';
import type { PrintEntry } from '@noutynotes/application';
import type { CaptionPosition, RichTextInline, RichTextTable } from '@noutynotes/domain';
import { parseRichTextMarkdown, serializeRichTextMarkdown } from '@noutynotes/storage';

import { markdownExcerpt } from './markdownLists';
import { bodyFontSize, bodyLineHeight, titleFontSize, titleLineHeight } from './textSizes';
import { floatingTextColor } from './floatingText';
import { shapeFillColor, shapeStrokeColor, shapeStrokePixels } from './shapeStyle';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const connectionLine = (connection: PrintEntry['connections'][number]) =>
  `<li>${connection.direction === 'to' ? '→' : '←'} ${escapeHtml(connection.label)}: ${escapeHtml(connection.otherTitle)}</li>`;

/**
 * Posición de la leyenda (ADR 0051), mismo criterio que `NotePreview`: «bottom» usa la regla global
 * de `figcaption` (sin estilo en línea); las otras tres la sustituyen. «left»/«right» convierten la
 * figura en una fila (imagen y leyenda reparten el ancho) en vez de apilar en el presupuesto vertical.
 */
function imageHtml(ref: string, alt: string, images: ReadonlyMap<string, string>, position: CaptionPosition): string {
  const uri = images.get(ref);
  if (!uri) return '';
  const sideways = position === 'left' || position === 'right';
  const img = `<img src="${escapeHtml(uri)}" alt="${escapeHtml(alt)}"${sideways ? ' style="flex:2;min-width:0;"' : ''} />`;
  if (alt === '') return `<figure${sideways ? ' style="display:flex;gap:8px;align-items:flex-start;"' : ''}>${img}</figure>`;
  const captionStyle = position === 'top' ? ' style="margin:0 0 4px;"' : sideways ? ' style="flex:1;margin:0;"' : '';
  const caption = `<figcaption${captionStyle}>${escapeHtml(alt)}</figcaption>`;
  if (position === 'top') return `<figure>${caption}${img}</figure>`;
  if (position === 'left') return `<figure style="display:flex;gap:8px;align-items:flex-start;">${caption}${img}</figure>`;
  if (position === 'right') return `<figure style="display:flex;gap:8px;align-items:flex-start;">${img}${caption}</figure>`;
  return `<figure>${img}${caption}</figure>`;
}

function textHtml(text: string, bodyPx: number, bodyLine: number): string {
  const excerpt = markdownExcerpt(text);
  return excerpt.trim() === '' ? '' : `<pre style="font-size:${bodyPx}px;line-height:${bodyLine}px;">${escapeHtml(excerpt)}</pre>`;
}

function inlineText(content: readonly RichTextInline[]): string {
  return content.map((inline) => {
    if (inline.type === 'hard-break') return '\n';
    if (inline.type === 'link') return inlineText(inline.content);
    return inline.text;
  }).join('');
}

function tableHtml(table: RichTextTable): string {
  const header = table.header
    ? `<thead><tr>${table.header.cells.map((cell) => `<th>${escapeHtml(inlineText(cell.content))}</th>`).join('')}</tr></thead>`
    : '';
  const rows = table.rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${escapeHtml(inlineText(cell.content))}</td>`).join('')}</tr>`).join('');
  return `<table>${header}<tbody>${rows}</tbody></table>`;
}

/**
 * Cuerpo en el mismo orden que la ficha (UX7-C5): una imagen intercalada en una nota se dibuja una sola
 * vez, en su sitio, con su leyenda (como `NotePreview`, UX7-C4) — antes se repetía como `<img>` suelto
 * al principio y, de nuevo, como línea Markdown cruda `![alt](ref)` dentro del texto sin interpretar.
 * `entry.imageRefs` de una ficha de imagen única (sin sintaxis `![...]` en su contenido) se mantiene
 * como imágenes sueltas antes del texto, igual que antes.
 */
function bodyHtml(entry: PrintEntry, images: ReadonlyMap<string, string>): string {
  const position = entry.captionPosition ?? 'bottom';
  const bodyPx = bodyFontSize(entry.bodySize);
  const bodyLine = bodyLineHeight(bodyPx);
  const parsed = parseRichTextMarkdown(entry.content);
  if (parsed.ok) {
    const inline = new Set<string>(parsed.value.blocks.filter((block) => block.type === 'image').map((block) => block.assetRef));
    const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref) => imageHtml(ref, '', images, position));
    const body = parsed.value.blocks.map((block) => {
      if (block.type === 'image') return imageHtml(block.assetRef, block.alt, images, position);
      if (block.type === 'table') return tableHtml(block);
      const encoded = serializeRichTextMarkdown({ schemaVersion: parsed.value.schemaVersion, blocks: [block] });
      return encoded.ok ? textHtml(encoded.value, bodyPx, bodyLine) : '';
    });
    return [...standalone, ...body].join('');
  }
  const blocks = parseNoteBlocks(entry.content);
  const inline = new Set<string>(blocks.filter((block) => block.kind === 'image').map((block) => block.ref));
  const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref) => imageHtml(ref, '', images, position));
  const body = blocks.map((block) => (block.kind === 'image' ? imageHtml(block.ref, block.alt, images, position) : textHtml(block.text, bodyPx, bodyLine)));
  return [...standalone, ...body].join('');
}

function entryHtml(entry: PrintEntry, images: ReadonlyMap<string, string>): string {
  const tags = entry.tags.length > 0
    ? `<p class="tags">${entry.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</p>` : '';
  const connections = entry.connections.length > 0
    ? `<ul class="connections">${entry.connections.map(connectionLine).join('')}</ul>` : '';
  // Tamaño semántico del título (ADR 0050): mismo mapa que el lienzo y Lista.
  const titlePx = titleFontSize(entry.titleSize);
  const titleLine = titleLineHeight(titlePx);
  if (entry.floatingText) {
    const bodyPx = bodyFontSize(entry.bodySize);
    const bodyLine = bodyLineHeight(bodyPx);
    return `<article class="entry floating-text"><pre style="font-size:${bodyPx}px;line-height:${bodyLine}px;text-align:${entry.textAlign ?? 'left'};color:${floatingTextColor(entry.textColor, '#1e1f1a')};">${escapeHtml(entry.content)}</pre></article>`;
  }
  if (entry.shapeKind) {
    const fill = shapeFillColor(entry.shapeFill, '#ffffff');
    const stroke = shapeStrokeColor(entry.shapeStroke, '#34362f', '#ffffff');
    const width = shapeStrokePixels(entry.shapeStrokeWidth);
    const radius = entry.shapeKind === 'ellipse' ? '999px' : entry.shapeKind === 'rounded-rectangle' ? '18px' : '0';
    const shape = entry.shapeKind === 'line'
      ? `<div style="width:100%;height:${width}px;background:${stroke};"></div>`
      : `<div style="width:240px;height:140px;max-width:100%;box-sizing:border-box;background:${fill};border:${width}px solid ${stroke};border-radius:${radius};"></div>`;
    return `<article class="entry shape-entry">${shape}</article>`;
  }
  return `
    <article class="entry">
      <p class="meta">${entry.number}. ${escapeHtml(entry.typeLabel)}</p>
      <h2 style="font-size:${titlePx}px;line-height:${titleLine}px;">${escapeHtml(entry.title)}</h2>
      ${bodyHtml(entry, images)}
      ${tags}
      ${connections}
    </article>`;
}

/** Documento completo, listo para `document.write` en una pestaña nueva y `print()`. */
export function buildPrintHtml(boardTitle: string, entries: readonly PrintEntry[], images: ReadonlyMap<string, string>): string {
  const body = entries.length > 0
    ? entries.map((entry) => entryHtml(entry, images)).join('')
    : '<p class="empty">Este tablero no tiene tarjetas para imprimir.</p>';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(boardTitle)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1e1f1a; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; }
  .entry { page-break-inside: avoid; margin-bottom: 28px; border-bottom: 1px solid #ccc; padding-bottom: 16px; }
  .meta { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: #555; margin: 0; }
  h2 { margin: 4px 0 12px; }
  figure { margin: 8px 0; }
  img { max-width: 100%; display: block; }
  figcaption { font-size: 12px; font-style: italic; color: #555; margin-top: 4px; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; table-layout: fixed; }
  th, td { border: 1px solid #777; padding: 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #eee; font-weight: 700; }
  .tags, .connections { font-size: 13px; color: #555; }
  .connections { list-style: none; padding: 0; }
  .empty { font-style: italic; color: #555; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(boardTitle)}</h1>
${body}
</body>
</html>`;
}
