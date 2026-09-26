/**
 * Búsqueda dentro del proyecto abierto (ADR 0019). Consulta pura: no escribe, no crea índices y
 * nunca interpreta el contenido (el extracto es texto literal).
 */
import { normalizeTag } from '@noutynotes/domain';
import type { BoardId, CardId, Workspace } from '@noutynotes/domain';

export interface SearchResult {
  readonly cardId: CardId;
  readonly title: string;
  readonly typeLabel: string;
  readonly tags: readonly string[];
  /** Tableros que incluyen la tarjeta, en el orden del proyecto. */
  readonly boards: readonly { readonly boardId: BoardId; readonly title: string }[];
  /** Fragmento del texto alrededor de la primera coincidencia, literal. */
  readonly excerpt: string;
}

/** Sin mayúsculas ni acentos: «OTOÑO» y «otono» coinciden. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const EXCERPT = 90;

function excerptOf(content: string, words: readonly string[]): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat === '') return '';
  const folded = fold(flat);
  const at = words.map((word) => folded.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 30);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + EXCERPT)}${start + EXCERPT < flat.length ? '…' : ''}`;
}

/**
 * Palabras de la consulta: todas deben aparecer en título, texto, etiquetas o nombre del tipo. Las que
 * empiezan por `#` filtran por etiqueta (el `#` escrito en el Markdown no es una etiqueta). Consulta vacía:
 * sin resultados. La Papelera no se busca.
 */
export function searchWorkspace(workspace: Workspace, query: string): SearchResult[] {
  const parts = (typeof query === 'string' ? query : '').trim().split(/\s+/).filter(Boolean);
  const tagFilters: string[] = [];
  const words: string[] = [];
  for (const part of parts) {
    if (part.startsWith('#')) {
      const tag = normalizeTag(part);
      if (tag.ok) tagFilters.push(fold(tag.value));
    } else {
      words.push(fold(part));
    }
  }
  if (tagFilters.length === 0 && words.length === 0) return [];
  const types = new Map(workspace.cardTypes.map((type) => [type.id, type.label]));
  const results: (SearchResult & { rank: number })[] = [];
  for (const card of workspace.cards) {
    const tags = card.tags ?? [];
    // Como las palabras, «#japon» encuentra la etiqueta «japón» (sin acentos ni mayúsculas).
    const foldedTags = tags.map(fold);
    if (!tagFilters.every((tag) => foldedTags.includes(tag))) continue;
    const title = card.title ?? 'Sin título';
    const typeLabel = types.get(card.typeId) ?? card.typeId;
    const haystack = fold([title, card.content ?? '', tags.join(' '), typeLabel].join('\n'));
    if (!words.every((word) => haystack.includes(word))) continue;
    const foldedTitle = fold(title);
    results.push({
      cardId: card.id, title, typeLabel, tags,
      boards: workspace.boards.filter((board) => board.cardIds.includes(card.id)).map((board) => ({ boardId: board.id, title: board.title })),
      excerpt: excerptOf(card.content ?? '', words),
      // Primero las que coinciden en el título; después, por título.
      rank: words.length > 0 && words.every((word) => foldedTitle.includes(word)) ? 0 : 1,
    });
  }
  return results
    .sort((a, b) => a.rank - b.rank || (fold(a.title) < fold(b.title) ? -1 : fold(a.title) > fold(b.title) ? 1 : 0))
    .map(({ rank: _rank, ...result }) => result);
}
