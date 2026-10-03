/**
 * Documento HTML para imprimir un tablero (ADR 0031), en una pestaña propia. Puro: no toca el DOM ni
 * abre nada; eso lo hace quien lo llama. El contenido de las tarjetas es texto del usuario y nunca se
 * interpreta como HTML: todo pasa por `escapeHtml`, igual que el resto de la app no ejecuta HTML/JS de una nota.
 */
import { parseNoteBlocks } from '@noutynotes/application';
import type { PrintEntry } from '@noutynotes/application';

import { markdownExcerpt } from './markdownLists';
import { bodyFontSize, bodyLineHeight, titleFontSize, titleLineHeight } from './textSizes';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const connectionLine = (connection: PrintEntry['connections'][number]) =>
  `<li>${connection.direction === 'to' ? '→' : '←'} ${escapeHtml(connection.label)}: ${escapeHtml(connection.otherTitle)}</li>`;

function imageHtml(ref: string, alt: string, images: ReadonlyMap<string, string>): string {
  const uri = images.get(ref);
  if (!uri) return '';
  const caption = alt !== '' ? `<figcaption>${escapeHtml(alt)}</figcaption>` : '';
  return `<figure><img src="${escapeHtml(uri)}" alt="${escapeHtml(alt)}" />${caption}</figure>`;
}

function textHtml(text: string, bodyPx: number, bodyLine: number): string {
  const excerpt = markdownExcerpt(text);
  return excerpt.trim() === '' ? '' : `<pre style="font-size:${bodyPx}px;line-height:${bodyLine}px;">${escapeHtml(excerpt)}</pre>`;
}

/**
 * Cuerpo en el mismo orden que la ficha (UX7-C5): una imagen intercalada en una nota se dibuja una sola
 * vez, en su sitio, con su leyenda (como `NotePreview`, UX7-C4) — antes se repetía como `<img>` suelto
 * al principio y, de nuevo, como línea Markdown cruda `![alt](ref)` dentro del texto sin interpretar.
 * `entry.imageRefs` de una ficha de imagen única (sin sintaxis `![...]` en su contenido) se mantiene
 * como imágenes sueltas antes del texto, igual que antes.
 */
function bodyHtml(entry: PrintEntry, images: ReadonlyMap<string, string>): string {
  const blocks = parseNoteBlocks(entry.content);
  const inline = new Set<string>(blocks.filter((block) => block.kind === 'image').map((block) => block.ref));
  const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref) => imageHtml(ref, '', images));
  // Tamaño semántico del cuerpo (ADR 0050): mismo mapa que el lienzo y Lista.
  const bodyPx = bodyFontSize(entry.bodySize);
  const bodyLine = bodyLineHeight(bodyPx);
  const body = blocks.map((block) => (block.kind === 'image' ? imageHtml(block.ref, block.alt, images) : textHtml(block.text, bodyPx, bodyLine)));
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
