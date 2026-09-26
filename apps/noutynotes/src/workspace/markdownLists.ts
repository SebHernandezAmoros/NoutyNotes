/** Edición de listas Markdown estándar, sin interpretar HTML ni ejecutar contenido. */
export type ListKind = 'dash' | 'bullet' | 'number' | 'check';
export interface TextSelection { readonly start: number; readonly end: number }
export interface TextEdit { readonly text: string; readonly caret: number }

const marker = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const continuation = /^(\s*)(?:(-\s+\[[ xX]\]\s+)|([-*+]\s+)|(\d+)([.)]\s+))(.*)$/;

function fence(line: string): boolean { return /^\s*(`{3,}|~{3,})/.test(line); }

/**
 * Corrige solo bloques contiguos de listas ordenadas, respetando su número inicial y cercas de código.
 * Cada nivel de sangría lleva su propio contador: al volver de una sublista, el nivel exterior continúa.
 */
export function renumberOrderedLists(source: string, starts: ReadonlyMap<number, number> = new Map()): string {
  let inFence = false;
  let counters = new Map<number, number>();
  return source.split('\n').map((line, index) => {
    if (fence(line)) { inFence = !inFence; counters = new Map(); return line; }
    if (inFence) return line;
    const found = /^(\s*)(\d+)([.)]\s+)(.*)$/.exec(line);
    if (!found) {
      // Una línea en blanco o sin sangría cierra la lista; una sangrada continúa el elemento anterior.
      if (line.trim() === '' || !/^\s/.test(line)) counters = new Map();
      return line;
    }
    const [, prefix = '', number = '1', suffix = '. ', rest = ''] = found;
    const depth = prefix.length;
    for (const level of [...counters.keys()]) if (level > depth) counters.delete(level);
    const next = counters.get(depth) ?? starts.get(index) ?? Number(number);
    counters.set(depth, next + 1);
    return `${prefix}${next}${suffix}${rest}`;
  }).join('\n');
}

/** Inserta o transforma las líneas seleccionadas; todas las variantes son Markdown portable. */
export function applyListCommand(source: string, selection: TextSelection, kind: ListKind): TextEdit {
  const start = Math.max(0, Math.min(source.length, selection.start));
  const end = Math.max(start, Math.min(source.length, selection.end));
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const selectedEnd = end > start && source[end - 1] === '\n' ? end - 1 : end;
  const after = source.indexOf('\n', selectedEnd);
  const lineEnd = after < 0 ? source.length : after;
  let number = 1;
  const lines = source.slice(lineStart, lineEnd).split('\n');
  const replacement = lines.map((line) => {
    // En una selección de varias líneas, las vacías separan párrafos y no se convierten en elementos
    // vacíos. Una sola línea vacía (una nota nueva) sí recibe la marca: ahí se empieza a escribir.
    if (lines.length > 1 && line.trim() === '') return line;
    const bare = line.replace(marker, '$1');
    const indentation = /^\s*/.exec(bare)?.[0] ?? '';
    const body = bare.slice(indentation.length);
    const prefix = kind === 'dash' ? '- ' : kind === 'bullet' ? '* ' : kind === 'check' ? '- [ ] ' : `${number++}. `;
    return `${indentation}${prefix}${body}`;
  }).join('\n');
  const text = renumberOrderedLists(source.slice(0, lineStart) + replacement + source.slice(lineEnd));
  return { text, caret: lineStart + replacement.length };
}

/** Al recibir un salto de línea en el cursor, continúa o termina la lista actual. */
export function continueListOnChange(previous: string, next: string, selection: TextSelection): TextEdit | null {
  if (selection.start !== selection.end || next !== `${previous.slice(0, selection.start)}\n${previous.slice(selection.end)}`) return null;
  const lineStart = previous.lastIndexOf('\n', selection.start - 1) + 1;
  if (previous.slice(0, lineStart).split('\n').filter(fence).length % 2 !== 0) return null;
  const before = previous.slice(lineStart, selection.start);
  const found = continuation.exec(before);
  if (!found) return null;
  const [, indent = '', check, bullet, number, numberSuffix, body = ''] = found;
  // Una entrada vacía termina la lista y deja un párrafo en blanco.
  if (body.trim() === '') {
    const text = previous.slice(0, lineStart) + '\n' + previous.slice(selection.end);
    return { text, caret: lineStart + 1 };
  }
  const prefix = check ? '- [ ] ' : bullet ? bullet : `${Number(number) + 1}${numberSuffix}`;
  const inserted = `${indent}${prefix}`;
  const text = renumberOrderedLists(`${previous.slice(0, selection.start)}\n${inserted}${previous.slice(selection.end)}`);
  return { text, caret: selection.start + 1 + inserted.length };
}

/** Normaliza la edición del campo, incluida la renumeración tras borrar o pegar líneas. */
export function normalizeListChange(previous: string, next: string, selection: TextSelection): TextEdit | null {
  const continued = continueListOnChange(previous, next, selection);
  if (continued) return continued;
  const starts = keptStarts(previous, next);
  const normalized = renumberOrderedLists(next, starts);
  if (normalized === next) return null;
  const rawCaret = Math.max(0, Math.min(next.length, selection.start + next.length - previous.length));
  const before = renumberOrderedLists(next.slice(0, rawCaret), starts);
  return { text: normalized, caret: before.length };
}

/**
 * Si se borró el primer elemento de una lista numerada, el que sube ocupa su línea con otro texto: la
 * lista conserva el número con que empezaba. Si solo cambió el número (la persona lo editó), se respeta.
 */
function keptStarts(previous: string, next: string): Map<number, number> {
  const before = previous.split('\n');
  const after = next.split('\n');
  let index = 0;
  while (index < before.length && index < after.length && before[index] === after[index]) index += 1;
  const item = /^(\s*)(\d+)[.)]\s+(.*)$/;
  const old = item.exec(before[index] ?? '');
  const now = item.exec(after[index] ?? '');
  const starts = new Map<number, number>();
  if (old && now && old[1] === now[1] && old[3] !== now[3]) starts.set(index, Number(old[2]));
  return starts;
}

/** Alterna una casilla de la vista sin modificar otras líneas ni ejecutar Markdown. */
export function toggleChecklistLine(source: string, index: number): string | null {
  const lines = source.split('\n');
  const line = lines[index];
  if (line === undefined || !/^\s*[-*+]\s+\[[ xX]\]/.test(line)) return null;
  lines[index] = line.replace(/^(\s*[-*+]\s+)\[([ xX])\]/, (_all, prefix: string, checked: string) => `${prefix}[${checked.toLowerCase() === 'x' ? ' ' : 'x'}]`);
  return lines.join('\n');
}

/** Resumen visual de texto puro: nunca interpreta etiquetas ni ejecuta bloques de código. */
export function markdownExcerpt(source: string): string {
  let inFence = false;
  return source.split('\n').map((line) => {
    if (fence(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const check = /^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (check) return `${check[1] ?? ''}${check[2]?.toLowerCase() === 'x' ? '☑' : '☐'} ${check[3] ?? ''}`;
    return line.replace(/^\s*#{1,6}\s+/, '').replace(/^(\s*)[-*+]\s+/, '$1• ');
  }).join('\n');
}
