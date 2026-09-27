/** Entradas del diario (ADR 0024): tarjetas del tipo `diario`, fuera de los tableros. */
import { validateWorkspace } from '@noutynotes/domain';
import type { Card, CardId, WorkspaceId } from '@noutynotes/domain';

import { DIARY_CARD_TYPE, isDay, isDiaryEntry } from './daily-log';
import { nextSequentialId } from './ids';
import { takenCardIds } from './workspace-editing';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

export interface DiaryEntryInput {
  /** Día de la entrada (AAAA-MM-DD). */
  readonly day: string;
  /** Instante de creación (ISO 8601 en UTC): lo pone la interfaz, application no usa el reloj. */
  readonly createdAt: string;
  /** `true`: «Escribir la nota de hoy», reutiliza la primera entrada del día si existe. */
  readonly reuse: boolean;
}

/** Devuelve la entrada del día (existente si `reuse`) o crea una nueva. */
export async function openDiaryEntry(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: DiaryEntryInput): Promise<WorkspaceStorageResult<CardId>> {
  if (!isDay(input.day)) return storageFailure('invalid-workspace', 'day', 'La fecha debe ser AAAA-MM-DD.');
  if (input.reuse) {
    const opened = await storage.open(workspaceId);
    if (!opened.ok) return { ok: false, issues: opened.issues };
    const existing = opened.value.cards.filter((card) => isDiaryEntry(card) && card.fields.fecha === input.day)
      .sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1))[0];
    if (existing) return { ok: true, value: existing.id };
  }
  let created: CardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const types = workspace.cardTypes.some((type) => type.id === DIARY_CARD_TYPE.id) ? workspace.cardTypes : [...workspace.cardTypes, DIARY_CARD_TYPE];
    const cardId = nextSequentialId('tarjeta', takenCardIds(workspace)) as CardId;
    const card: Card = { id: cardId, typeId: DIARY_CARD_TYPE.id, title: `Diario ${input.day}`, fields: { fecha: input.day }, content: '', createdAt: input.createdAt };
    created = cardId;
    return validateWorkspace({ ...workspace, cardTypes: types, cards: [...workspace.cards, card] });
  });
  if (!saved.ok) return { ok: false, issues: saved.issues };
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la entrada.') : { ok: true, value: created };
}
