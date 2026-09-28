/**
 * Documento HTML para imprimir un tablero (ADR 0031), en una pestaña propia. Puro: no toca el DOM ni
 * abre nada; eso lo hace quien lo llama. El contenido de las tarjetas es texto del usuario y nunca se
 * interpreta como HTML: todo pasa por `escapeHtml`, igual que el resto de la app no ejecuta HTML/JS de una nota.
 */
import type { PrintEntry } from '@noutynotes/application';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const connectionLine = (connection: PrintEntry['connections'][number]) =>
  `<li>${connection.direction === 'to' ? '→' : '←'} ${escapeHtml(connection.label)}: ${escapeHtml(connection.otherTitle)}</li>`;

function entryHtml(entry: PrintEntry, images: ReadonlyMap<string, string>): string {
  const tags = entry.tags.length > 0
    ? `<p class="tags">${entry.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</p>` : '';
  const connections = entry.connections.length > 0
    ? `<ul class="connections">${entry.connections.map(connectionLine).join('')}</ul>` : '';
  const imagesHtml = entry.imageRefs.map((ref) => {
    const uri = images.get(ref);
    return uri ? `<img src="${escapeHtml(uri)}" alt="" />` : '';
  }).join('');
  return `
    <article class="entry">
      <p class="meta">${entry.number}. ${escapeHtml(entry.typeLabel)}</p>
      <h2>${escapeHtml(entry.title)}</h2>
      ${imagesHtml}
      <pre>${escapeHtml(entry.content)}</pre>
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
  img { max-width: 100%; display: block; margin: 8px 0; }
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
