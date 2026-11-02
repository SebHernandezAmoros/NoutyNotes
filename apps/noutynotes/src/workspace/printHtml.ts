import type { Locale } from '@noutynotes/ui';
import { t } from '../i18n';
/**
 * Documento HTML para imprimir un tablero (ADR 0031), en una pestaña propia. Puro: no toca el DOM ni
 * abre nada; eso lo hace quien lo llama. El contenido de las tarjetas es texto del usuario y nunca se
 * interpreta como HTML: todo pasa por `escapeHtml`, igual que el resto de la app no ejecuta HTML/JS de una nota.
 */
import { parseNoteBlocks } from '@noutynotes/application';
import type { PrintEntry } from '@noutynotes/application';
import type { CaptionPosition, RichTextImage, RichTextInline, RichTextTable } from '@noutynotes/domain';
import { parseRichTextMarkdown, serializeRichTextHtml, serializeRichTextMarkdown } from '@noutynotes/storage';

import { markdownExcerpt } from './markdownLists';
import { bodyFontSize, bodyLineHeight, titleFontSize, titleLineHeight } from './textSizes';
import { floatingTextColor } from './floatingText';
import { shapeFillColor, shapeStrokeColor, shapeStrokePixels } from './shapeStyle';
import { resolveImageReading } from './canvas/imageReadingPresentation';

export interface PrintOptions {
  readonly paper?: 'A4' | 'Letter';
  readonly orientation?: 'portrait' | 'landscape';
  readonly fonts?: ReadonlyMap<string, string>;
  readonly inheritedFont?: string | undefined;
  readonly locale?: Locale;
  readonly style?: 'report' | 'visual';
}

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
function imageHtml(ref: string, alt: string, images: ReadonlyMap<string, string>, position: CaptionPosition, locale: Locale, layout?: RichTextImage): string {
  const uri = images.get(ref);
  const reading = layout ? resolveImageReading(layout) : null;
  const captionDocument = reading?.caption.length ? serializeRichTextHtml({ schemaVersion: 2, blocks: [{ type: 'paragraph', content: reading.caption }] }) : null;
  const captionHtml = reading ? (captionDocument?.ok ? captionDocument.value.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '') : '') : escapeHtml(alt);
  const sideways = position === 'left' || position === 'right';
  const img = uri ? `<img src="${escapeHtml(uri)}" alt="${escapeHtml(reading?.alt ?? alt)}"${sideways ? ' style="flex:2;min-width:0;"' : ''} />`
    : `<p class="missing-resource" role="status">${escapeHtml(t('print.imageMissing', locale))}</p>`;
  const width = layout?.size === 'small' ? '25%' : layout?.size === 'medium' ? '50%' : layout?.size === 'large' ? '75%' : '100%';
  const margin = layout?.alignment === 'left' ? '0 auto 0 0' : layout?.alignment === 'right' ? '0 0 0 auto' : '0 auto';
  const explicitLayout = layout?.size !== undefined || layout?.alignment !== undefined;
  const figureStyle = `${explicitLayout ? `width:${width};max-width:100%;margin:${margin};` : ''}${sideways ? 'display:flex;gap:8px;align-items:flex-start;' : ''}`;
  const figureAttr = figureStyle === '' ? '' : ` style="${figureStyle}"`;
  if (captionHtml === '') return `<figure${figureAttr}>${img}</figure>`;
  const captionStyle = position === 'top' ? ' style="margin:0 0 4px;"' : sideways ? ' style="flex:1;margin:0;"' : '';
  const caption = `<figcaption${captionStyle}>${captionHtml}</figcaption>`;
  if (position === 'top') return `<figure${figureAttr}>${caption}${img}</figure>`;
  if (position === 'left') return `<figure${figureAttr}>${caption}${img}</figure>`;
  if (position === 'right') return `<figure${figureAttr}>${img}${caption}</figure>`;
  return `<figure${figureAttr}>${img}${caption}</figure>`;
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
    ? `<thead><tr>${table.header.cells.map((cell) => `<th${cell.verticalAlignment ? ` style="vertical-align:${cell.verticalAlignment === 'center' ? 'middle' : cell.verticalAlignment};"` : ''}>${escapeHtml(inlineText(cell.content))}</th>`).join('')}</tr></thead>`
    : '';
  const rows = table.rows.map((row) => `<tr>${row.cells.map((cell) => `<td${cell.verticalAlignment ? ` style="vertical-align:${cell.verticalAlignment === 'center' ? 'middle' : cell.verticalAlignment};"` : ''}>${escapeHtml(inlineText(cell.content))}</td>`).join('')}</tr>`).join('');
  return `<table>${header}<tbody>${rows}</tbody></table>`;
}

/**
 * Cuerpo en el mismo orden que la ficha (UX7-C5): una imagen intercalada en una nota se dibuja una sola
 * vez, en su sitio, con su leyenda (como `NotePreview`, UX7-C4) — antes se repetía como `<img>` suelto
 * al principio y, de nuevo, como línea Markdown cruda `![alt](ref)` dentro del texto sin interpretar.
 * `entry.imageRefs` de una ficha de imagen única (sin sintaxis `![...]` en su contenido) se mantiene
 * como imágenes sueltas antes del texto, igual que antes.
 */
function bodyHtml(entry: PrintEntry, images: ReadonlyMap<string, string>, locale: Locale): string {
  const position = entry.captionPosition ?? 'bottom';
  const bodyPx = bodyFontSize(entry.bodySize);
  const bodyLine = bodyLineHeight(bodyPx);
  // Cuerpo HTML seguro (ADR 0066): el documento ya está parseado, no hay `content` Markdown que volver
  // a interpretar (quedaría vacío y perdería la estructura real, defecto ya corregido en esta intervención).
  const parsed = entry.contentDocument ? { ok: true as const, value: entry.contentDocument } : parseRichTextMarkdown(entry.content);
  if (parsed.ok) {
    const inline = new Set<string>(parsed.value.blocks.filter((block) => block.type === 'image').map((block) => block.assetRef));
    const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref) => imageHtml(ref, '', images, position, locale));
    const body = parsed.value.blocks.map((block) => {
      if (block.type === 'image') return imageHtml(block.assetRef, block.alt, images, position, locale, block);
      if (block.type === 'pdf') return `<p class="pdf-attachment">PDF: ${escapeHtml(block.label ?? 'PDF')}</p>`;
      if (block.type === 'table') return tableHtml(block);
      const semantic = parsed.value.schemaVersion !== 1 || entry.noteFont !== undefined;
      const encoded = (semantic ? serializeRichTextHtml : serializeRichTextMarkdown)({ schemaVersion: parsed.value.schemaVersion, blocks: [block] });
      if (!semantic) return encoded.ok ? textHtml(encoded.value, bodyPx, bodyLine) : '';
      return encoded.ok ? `<div style="font-size:${bodyPx}px;line-height:${bodyLine}px">${encoded.value}</div>` : `<p>${escapeHtml(t('print.unsupported', locale))}</p>`;
    });
    return [...standalone, ...body].join('');
  }
  const blocks = parseNoteBlocks(entry.content);
  const inline = new Set<string>(blocks.filter((block) => block.kind === 'image').map((block) => block.ref));
  const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref) => imageHtml(ref, '', images, position, locale));
  const body = blocks.map((block) => (block.kind === 'image' ? imageHtml(block.ref, block.alt, images, position, locale) : textHtml(block.text, bodyPx, bodyLine)));
  return [...standalone, ...body].join('');
}

function entryHtml(entry: PrintEntry, images: ReadonlyMap<string, string>, family: string, fallback: string, locale: Locale, style: 'report' | 'visual'): string {
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
  if (entry.connectorColor !== undefined || entry.connectorWidth !== undefined || entry.connectorDash !== undefined || entry.connectorArrows !== undefined) {
    const stroke = shapeStrokeColor(entry.connectorColor, '#34362f', '#ffffff');
    const width = shapeStrokePixels(entry.connectorWidth);
    const style = entry.connectorDash === 'dotted' ? 'dotted' : entry.connectorDash === 'dashed' ? 'dashed' : 'solid';
    const arrows = entry.connectorArrows ?? 'end';
    const start = arrows === 'start' || arrows === 'both' ? '◀' : '';
    const end = arrows === 'end' || arrows === 'both' ? '▶' : '';
    const rotate = entry.connectorDirection === 'up' ? '-18deg' : '18deg';
    return `<article class="entry connector-entry"><div style="display:flex;align-items:center;gap:4px;width:240px;max-width:100%;transform:rotate(${rotate});color:${stroke};"><span>${start}</span><div style="flex:1;border-top:${width}px ${style} ${stroke};"></div><span>${end}</span></div></article>`;
  }
  if (style === 'visual') {
    const frame = entry.frameOverride === 'hidden' ? ' frameless' : '';
    const transparent = entry.noteBackground === 'transparent' ? ' transparent-note' : '';
    return `<article class="entry visual-note${frame}${transparent}">
      <div class="visual-note-header"><span>${entry.number} // ${escapeHtml(entry.title || entry.typeLabel)}</span></div>
      <div class="visual-note-body" style="font-family:${escapeHtml(family)}">${fallback}${bodyHtml(entry, images, locale)}${tags}${connections}</div>
    </article>`;
  }
  return `
    <article class="entry">
      <p class="meta">${entry.number}. ${escapeHtml(entry.typeLabel)}</p>
      <h2 style="font-size:${titlePx}px;line-height:${titleLine}px;">${escapeHtml(entry.title)}</h2>
      <div style="font-family:${escapeHtml(family)}">${fallback}${bodyHtml(entry, images, locale)}</div>
      ${tags}
      ${connections}
    </article>`;
}

/** Documento completo, listo para `document.write` en una pestaña nueva y `print()`. */
export function buildPrintHtml(boardTitle: string, entries: readonly PrintEntry[], images: ReadonlyMap<string, string>, options: PrintOptions = {}): string {
  const locale = options.locale ?? 'es';
  const paper = options.paper === 'Letter' ? 'Letter' : 'A4';
  const orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait';
  const faces = [...(options.fonts ?? new Map<string, string>())].filter(([, uri]) => /^data:font\/(ttf|otf|woff2);base64,[A-Za-z0-9+/=]+$/.test(uri));
  const fontNames = new Map(faces.map(([ref], index) => [ref, 'noty-print-' + index]));
  const fontCss = faces.map(([, uri], index) => '@font-face{font-family:noty-print-' + index + ';src:url("' + uri + '")}').join('');
  const body = entries.length > 0
    ? entries.map((entry) => {
      const font = entry.noteFont;
      const family = font?.kind === 'asset' ? fontNames.get(font.assetRef) ?? 'system-ui,sans-serif'
        : font?.family === 'serif' ? 'Georgia,serif' : font?.family === 'mono' ? 'monospace' : font?.family === 'system' ? 'system-ui,sans-serif' : options.inheritedFont ?? 'Georgia,serif';
      const fallback = font?.kind === 'asset' && !fontNames.has(font.assetRef) ? '<p role="status">' + escapeHtml(t('content.fontFallback', options.locale ?? 'es')) + '</p>' : '';
      return entryHtml(entry, images, family, fallback, locale, options.style === 'visual' ? 'visual' : 'report');
    }).join('')
    : `<p class="empty">${escapeHtml(t('print.empty', locale))}</p>`;
  return `<!doctype html>
<html lang="${locale === 'en' ? 'en' : 'es'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(boardTitle)}</title>
<style>
${fontCss}
  @page { size: ${paper} ${orientation}; margin: 12mm; }
[data-nouty-align="center"]{text-align:center}[data-nouty-align="right"]{text-align:right}[data-nouty-align="justify"]{text-align:justify}
  body { font-family: Georgia, "Times New Roman", serif; color: #1e1f1a; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; }
  /* B9-R2-02: una Nota que cabe entera en una página no debe partirse (cabecera en una página, cuerpo
     en la siguiente) — defecto real observado en la paginación visual. 'avoid' deja que el motor de
     impresión la empuje entera a la página siguiente; si de verdad no cabe en ninguna página completa,
     el propio navegador la parte igual (nunca se pierde contenido), con el borde/fondo de .visual-note
     repintándose en cada fragmento como aviso visual de continuidad — un rótulo 'continúa' explícito no
     es fiable entre navegadores en impresión (sin cabeceras de página CSS con soporte real en Chrome) y
     queda documentado como límite conocido en vez de simulado con JavaScript o una imagen rasterizada. */
  .entry { margin-bottom: 28px; border-bottom: 1px solid #ccc; padding-bottom: 16px; overflow-wrap: anywhere; break-inside: avoid-page; page-break-inside: avoid; }
  figure, tr { page-break-inside: avoid; }
  h1, h2, .meta { break-after: avoid; }
  p, pre { orphans: 2; widows: 2; }
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
  .visual-note { background: #FFFDF6; border: 2px solid #b7b9aa; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .visual-note-header { background: #F2B3C6; color: #1e1f1a; font: 700 11px/1.4 ui-monospace, Menlo, Consolas, monospace; padding: 10px 12px; break-after: avoid; overflow-wrap: anywhere; }
  .visual-note-body { padding: 12px; color: #1e1f1a; overflow-wrap: anywhere; }
  .visual-note.frameless { border: none; }
  .visual-note.frameless .visual-note-header { display: none; }
  .visual-note.transparent-note { background: transparent; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<h1>${escapeHtml(boardTitle)}</h1>
${body}
</body>
</html>`;
}
