/** Entradas del diario (ADR 0024): tarjetas del tipo `diario`, fuera de los tableros. */
import { validateWorkspace } from '@noutynotes/domain';
import type { Card, CardId, CardTypeDefinition, WorkspaceId } from '@noutynotes/domain';

import { DIARY_CARD_TYPE, isDay, isDiaryEntry } from './daily-log';
import { nextSequentialId } from './ids';
import { takenCardIds } from './workspace-editing';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

export interface DocumentAnnotationInput {
  /** Día de la entrada (AAAA-MM-DD): el mismo contrato que `DiaryEntryInput.day`. */
  readonly day: string;
  /** Instante de creación (ISO 8601 en UTC): lo pone la interfaz, application no usa el reloj. */
  readonly createdAt: string;
  /** Referencia relativa, ya catalogada (`assets/...`), del PDF/TXT/Markdown anotado. */
  readonly documentRef: string;
  /** Nombre de archivo para el título de la entrada (p. ej. «Manual.pdf»). */
  readonly documentName: string;
  /** Texto de reflexión de la persona; puede quedar vacío y completarse luego desde el Diario. */
  readonly reflection: string;
  /** Página (entero positivo, PDF). */
  readonly page?: number;
  /** Línea (entero positivo, TXT). */
  readonly line?: number;
  /** Encabezado o nombre de sección (Markdown). */
  readonly section?: string;
}

export interface DiaryEntryInput {
  /** Día de la entrada (AAAA-MM-DD). */
  readonly day: string;
  /** Instante de creación (ISO 8601 en UTC): lo pone la interfaz, application no usa el reloj. */
  readonly createdAt: string;
  /** `true`: «Escribir la nota de hoy», reutiliza la primera entrada del día si existe. */
  readonly reuse: boolean;
}

/**
 * Sustituye (o añade) la definición `diario` por la vigente, en vez de solo añadirla si falta.
 * B9-R4-11: un workspace que ya tenía entradas de diario antes de ampliar `DIARY_CARD_TYPE` con los
 * campos documentales seguía registrando la definición antigua (sin ellos) para siempre, y una nueva
 * anotación habría fallado con «campo desconocido». Los campos nuevos son todos opcionales, así que
 * sustituir la definición nunca invalida una entrada ya guardada.
 */
function withCurrentDiaryCardType(cardTypes: readonly CardTypeDefinition[]): readonly CardTypeDefinition[] {
  return [...cardTypes.filter((type) => type.id !== DIARY_CARD_TYPE.id), DIARY_CARD_TYPE];
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
    const types = withCurrentDiaryCardType(workspace.cardTypes);
    const cardId = nextSequentialId('tarjeta', takenCardIds(workspace)) as CardId;
    const card: Card = { id: cardId, typeId: DIARY_CARD_TYPE.id, title: `Diario ${input.day}`, fields: { fecha: input.day }, content: '', createdAt: input.createdAt };
    created = cardId;
    return validateWorkspace({ ...workspace, cardTypes: types, cards: [...workspace.cards, card] });
  });
  if (!saved.ok) return { ok: false, issues: saved.issues };
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la entrada.') : { ok: true, value: created };
}

/**
 * Crea una anotación de Diario sobre un documento ya catalogado (B9-R4-11, MVP Nivel 2). Siempre una
 * entrada nueva e independiente (nunca reutiliza la del día, a diferencia de `openDiaryEntry` con
 * `reuse: true`) — varias anotaciones del mismo documento, o del mismo día, nunca se fusionan.
 */
export async function annotateDocumentInDiary(storage: WorkspaceStorage, workspaceId: WorkspaceId, input: DocumentAnnotationInput): Promise<WorkspaceStorageResult<CardId>> {
  if (!isDay(input.day)) return storageFailure('invalid-workspace', 'day', 'La fecha debe ser AAAA-MM-DD.');
  if (input.page !== undefined && (!Number.isInteger(input.page) || input.page < 1)) {
    return storageFailure('invalid-workspace', 'page', 'La página debe ser un número entero positivo.');
  }
  if (input.line !== undefined && (!Number.isInteger(input.line) || input.line < 1)) {
    return storageFailure('invalid-workspace', 'line', 'La línea debe ser un número entero positivo.');
  }
  let created: CardId | undefined;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => {
    const types = withCurrentDiaryCardType(workspace.cardTypes);
    const cardId = nextSequentialId('tarjeta', takenCardIds(workspace)) as CardId;
    const card: Card = {
      id: cardId, typeId: DIARY_CARD_TYPE.id, title: input.documentName, content: input.reflection, createdAt: input.createdAt,
      fields: {
        fecha: input.day, 'documento-ref': input.documentRef,
        ...(input.page !== undefined ? { 'documento-pagina': input.page } : {}),
        ...(input.line !== undefined ? { 'documento-linea': input.line } : {}),
        ...(input.section !== undefined && input.section !== '' ? { 'documento-seccion': input.section } : {}),
      },
    };
    created = cardId;
    return validateWorkspace({ ...workspace, cardTypes: types, cards: [...workspace.cards, card] });
  });
  if (!saved.ok) return { ok: false, issues: saved.issues };
  return created === undefined ? storageFailure('invalid-workspace', 'transform', 'No se creó la anotación.') : { ok: true, value: created };
}
