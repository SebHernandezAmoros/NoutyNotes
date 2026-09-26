/** Tarjetas de enlace (ADR 0020): tipo que las acoge y edición de su URL. Sin red: nada se descarga. */
import { linkUrlField, normalizeLinkUrl, validateWorkspace } from '@noutynotes/domain';
import type { CardId, CardTypeDefinition, CardTypeId, Workspace, WorkspaceId } from '@noutynotes/domain';

import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

/** Tipo que se añade si el proyecto no tiene ninguno de enlace compatible. */
export const LINK_CARD_TYPE: CardTypeDefinition = {
  id: 'enlace' as CardTypeId, label: 'Enlace', base: 'link',
  fields: [{ key: 'url' as CardTypeDefinition['fields'][number]['key'], kind: 'url', label: 'Enlace', required: true }],
};

/** Acepta una tarjeta con solo la URL: tipo `link` con campo `url` y el resto de campos opcionales. */
function acceptsBareLink(type: CardTypeDefinition): boolean {
  const key = linkUrlField(type);
  return key !== undefined && type.fields.every((field) => field.key === key || field.required !== true);
}

/**
 * Tipo para una tarjeta de enlace nueva: el primero compatible del proyecto (p. ej. `source` de Research)
 * o `enlace`, con un ID libre si ese ya lo usa un tipo incompatible.
 */
export function linkCardTypeFor(workspace: Workspace): CardTypeDefinition {
  const existing = workspace.cardTypes.find(acceptsBareLink);
  if (existing) return existing;
  const taken = new Set(workspace.cardTypes.map((type) => type.id as string));
  let id = LINK_CARD_TYPE.id as string;
  for (let index = 2; taken.has(id); index += 1) id = `${LINK_CARD_TYPE.id}-${index}`;
  return { ...LINK_CARD_TYPE, id: id as CardTypeId };
}

/** Cambia la URL de una tarjeta de enlace. Devuelve la URL normalizada que se guardó. */
export async function setCardLink(storage: WorkspaceStorage, workspaceId: WorkspaceId, cardId: CardId, input: string): Promise<WorkspaceStorageResult<string>> {
  const url = normalizeLinkUrl(typeof input === 'string' ? input : '');
  if (!url.ok) return storageFailure('invalid-workspace', 'input', 'El enlace no es válido.', url.issues);
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const card = workspace.cards.find((candidate) => candidate.id === cardId);
    const key = linkUrlField(workspace.cardTypes.find((type) => type.id === card?.typeId));
    if (!card || !key) return { ok: false, issues: [{ code: 'missing-reference', path: 'cardId', message: 'La tarjeta no existe o no es de enlace.' }] };
    return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => (candidate === card ? { ...card, fields: { ...card.fields, [key]: url.value } } : candidate)) });
  });
  return saved.ok ? { ok: true, value: url.value } : { ok: false, issues: saved.issues };
}
