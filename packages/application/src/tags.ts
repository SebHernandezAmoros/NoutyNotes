/** Etiquetas `#` de tarjetas por proyecto (ADR 0019): añadir, quitar, renombrar y quitar de todas. */
import { normalizeTag, validateWorkspace, withTag, withoutTag } from '@noutynotes/domain';
import type { Card, CardId, Workspace, WorkspaceId } from '@noutynotes/domain';

import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

/** Etiquetas con recuento real de tarjetas activas (la Papelera no cuenta), por nombre. */
export function workspaceTags(workspace: Workspace): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of workspace.cards) for (const tag of card.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([tag, count]) => ({ tag, count }));
}

/** Etiquetas sin la clave cuando la lista queda vacía: la tarjeta vuelve a v1 (ADR 0019). */
function withTags(card: Card, tags: readonly string[]): Card {
  const { tags: _previous, ...rest } = card;
  return tags.length > 0 ? { ...rest, tags } : rest;
}

/** Aplica `change` a todas las tarjetas, activas y de la Papelera, y valida el resultado. */
function everywhere(workspace: Workspace, change: (card: Card) => Card) {
  return validateWorkspace({
    ...workspace,
    cards: workspace.cards.map(change),
    ...(workspace.trash ? { trash: workspace.trash.map((entry) => ({ ...entry, card: change(entry.card) })) } : {}),
  });
}

async function editTags(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, edit: (tags: readonly string[]) => string[]): Promise<WorkspaceStorageResult<string[]>> {
  let result: string[] = [];
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const target = workspace.cards.find((card) => card.id === cardId);
    if (!target) return { ok: false, issues: [{ code: 'missing-reference', path: 'cardId', message: 'La tarjeta no existe en este proyecto.' }] };
    result = edit(target.tags ?? []);
    return validateWorkspace({ ...workspace, cards: workspace.cards.map((card) => (card.id === cardId ? withTags(card, result) : card)) });
  });
  return saved.ok ? { ok: true, value: result } : { ok: false, issues: saved.issues };
}

/** Añade una etiqueta tal como la escribe la persona (`#Japón` → `japón`). Devuelve la lista resultante. */
export async function addCardTag(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, input: string): Promise<WorkspaceStorageResult<string[]>> {
  const normalized = normalizeTag(typeof input === 'string' ? input : '');
  if (!normalized.ok) return storageFailure('invalid-workspace', 'input', 'La etiqueta no es válida.', normalized.issues);
  return editTags(storage, workspaceId, cardId, (tags) => withTag(tags, normalized.value));
}

export async function removeCardTag(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, tag: string): Promise<WorkspaceStorageResult<string[]>> {
  return editTags(storage, workspaceId, cardId, (tags) => withoutTag(tags, tag));
}

/**
 * Renombra una etiqueta en todo el proyecto, también en la Papelera (restaurar no devuelve el nombre viejo).
 * Si el nombre nuevo ya existe, se fusionan sin duplicados. Una sola transacción.
 */
export async function renameTag(storage: WorkspaceStorage, workspaceId: WorkspaceId, from: string, input: string): Promise<WorkspaceStorageResult<string>> {
  const normalized = normalizeTag(typeof input === 'string' ? input : '');
  if (!normalized.ok) return storageFailure('invalid-workspace', 'input', 'El nombre nuevo no es válido.', normalized.issues);
  const to = normalized.value;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const used = [...workspace.cards, ...(workspace.trash ?? []).map((entry) => entry.card)].some((card) => card.tags?.includes(from));
    if (!used) return { ok: false, issues: [{ code: 'missing-reference', path: 'from', message: `Ninguna tarjeta usa la etiqueta «${from}».` }] };
    return everywhere(workspace, (card) => (card.tags?.includes(from) ? withTags(card, withTag(withoutTag(card.tags, from), to)) : card));
  });
  return saved.ok ? { ok: true, value: to } : { ok: false, issues: saved.issues };
}

/** Quita la etiqueta de todas las tarjetas del proyecto, también de la Papelera. */
export async function removeTagEverywhere(storage: WorkspaceStorage, workspaceId: WorkspaceId, tag: string): Promise<WorkspaceStorageResult<void>> {
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => everywhere(workspace, (card) => (card.tags?.includes(tag) ? withTags(card, withoutTag(card.tags, tag)) : card)));
  return saved.ok ? { ok: true, value: undefined } : { ok: false, issues: saved.issues };
}
