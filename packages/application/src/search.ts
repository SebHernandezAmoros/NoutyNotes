/**
 * Búsqueda dentro del proyecto abierto (ADR 0019) y en todos los proyectos (ADR 0020). Consulta pura:
 * no escribe, no crea índices y nunca interpreta el contenido (el extracto es texto literal).
 */
import { cardTitleText, normalizeTag } from '@noutynotes/domain';
import type { BoardId, CardId, CardTypeId, Workspace, WorkspaceId } from '@noutynotes/domain';

import type { WorkspaceStorage } from './workspace-storage';

export interface SearchResult {
  readonly cardId: CardId;
  readonly title: string;
  readonly typeId: CardTypeId;
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
 * Palabras de la consulta: todas deben aparecer en título, texto, etiquetas, enlaces o nombre del tipo.
 * Las que empiezan por `#` filtran por etiqueta (el `#` escrito en el Markdown no es una etiqueta).
 * `typeId` limita a un tipo del proyecto (ADR 0020). Sin palabras, etiquetas ni tipo: sin resultados.
 * La Papelera no se busca.
 */
export function searchWorkspace(workspace: Workspace, query: string, options: { readonly typeId?: CardTypeId } = {}): SearchResult[] {
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
  if (tagFilters.length === 0 && words.length === 0 && options.typeId === undefined) return [];
  const types = new Map(workspace.cardTypes.map((type) => [type.id, type]));
  const results: (SearchResult & { rank: number })[] = [];
  for (const card of workspace.cards) {
    if (options.typeId !== undefined && card.typeId !== options.typeId) continue;
    const tags = card.tags ?? [];
    // Como las palabras, «#japon» encuentra la etiqueta «japón» (sin acentos ni mayúsculas).
    const foldedTags = tags.map(fold);
    if (!tagFilters.every((tag) => foldedTags.includes(tag))) continue;
    const title = cardTitleText(card) || 'Sin título';
    const type = types.get(card.typeId);
    const typeLabel = type?.label ?? card.typeId;
    // Los enlaces (campos `url`) también se buscan: «ejemplo.com» encuentra su tarjeta.
    const links = (type?.fields ?? []).filter((field) => field.kind === 'url')
      .map((field) => card.fields[field.key]).filter((value): value is string => typeof value === 'string');
    const haystack = fold([title, card.content ?? '', tags.join(' '), typeLabel, ...links].join('\n'));
    if (!words.every((word) => haystack.includes(word))) continue;
    const foldedTitle = fold(title);
    results.push({
      cardId: card.id, title, typeId: card.typeId, typeLabel, tags,
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

export interface ProjectResults {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly results: readonly SearchResult[];
}

export interface GlobalSearch {
  /** Solo los proyectos con coincidencias, en el orden del almacenamiento. */
  readonly projects: readonly ProjectResults[];
  /** Proyectos que no se pudieron leer, con el motivo: nunca se omiten en silencio. */
  readonly unreadable: readonly { readonly workspaceId: WorkspaceId; readonly name: string; readonly message: string }[];
  /** Cuántos proyectos se revisaron, legibles o no. */
  readonly searched: number;
}

/**
 * Búsqueda en todos los proyectos del almacenamiento (ADR 0020). Se lanza de forma explícita: lee cada
 * proyecto (salvo `current`, que ya está en memoria) y aplica `searchWorkspace`. No guarda índices.
 */
export async function searchAllWorkspaces(storage: WorkspaceStorage, query: string, current?: Workspace): Promise<GlobalSearch> {
  const listed = await storage.list();
  if (!listed.ok) {
    return { projects: [], unreadable: [{ workspaceId: '' as WorkspaceId, name: 'Lista de proyectos', message: listed.issues[0]?.message ?? 'No se pudo leer.' }], searched: 0 };
  }
  const projects: ProjectResults[] = [];
  const unreadable: { workspaceId: WorkspaceId; name: string; message: string }[] = [];
  for (const summary of listed.value) {
    const opened = current?.id === summary.id ? { ok: true as const, value: current } : await storage.open(summary.id);
    if (!opened.ok) {
      unreadable.push({ workspaceId: summary.id, name: summary.name, message: opened.issues[0]?.message ?? 'No se pudo leer.' });
      continue;
    }
    const results = searchWorkspace(opened.value, query);
    if (results.length > 0) projects.push({ workspaceId: summary.id, name: opened.value.metadata.name, results });
  }
  return { projects, unreadable, searched: listed.value.length };
}
