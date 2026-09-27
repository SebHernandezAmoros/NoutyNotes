/**
 * Archivo de tarjetas (ADR 0023): aparta sin destruir, con la misma instantánea que la Papelera y la
 * fecha de archivo. Eliminar desde el Archivo no borra: envía a la Papelera.
 */
import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import type { CardId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import { restoreSnapshot, setAsideCard } from './trash';
import type { RestoreOptions, RestoreReport } from './trash';
import { isArchiveInstant } from './trashed-card';
import type { ArchivedCard, TrashedCard } from './trashed-card';

/** Archiva una tarjeta activa. `archivedAt` lo da la aplicación (ISO 8601 en UTC): el dominio no tiene reloj. */
export function archiveCard(workspace: Workspace, cardId: CardId, archivedAt: string): ValidationResult<Workspace> {
  if (!isArchiveInstant(archivedAt)) return failure([issue('invalid-value', 'archivedAt', 'Debe ser una fecha y hora ISO 8601 en UTC.')]);
  const aside = setAsideCard(workspace, cardId);
  if (!aside.ok) return failure([...aside.issues]);
  const entry: ArchivedCard = { ...aside.value.entry, archivedAt };
  return validateWorkspace({ ...aside.value.workspace, archive: [...(workspace.archive ?? []), entry] });
}

function archivedEntry(workspace: Workspace, cardId: CardId): ValidationResult<ArchivedCard> {
  const entry = workspace.archive?.find((candidate) => candidate.card.id === cardId);
  return entry ? resultOf(entry, []) : failure([issue('missing-reference', 'cardId', 'La tarjeta no está en el Archivo.')]);
}

/** Restaura una tarjeta archivada en su sitio (o en un hueco libre, o en el tablero de reserva). */
export function restoreArchivedCard(
  workspace: Workspace, cardId: CardId, options: RestoreOptions,
): ValidationResult<{ readonly workspace: Workspace; readonly report: RestoreReport }> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure([...source.issues]);
  const entry = archivedEntry(workspace, cardId);
  if (!entry.ok) return failure([...entry.issues]);
  return restoreSnapshot({ ...workspace, archive: (workspace.archive ?? []).filter((candidate) => candidate !== entry.value) }, entry.value, options);
}

/** «Eliminar» desde el Archivo: pasa a la Papelera con su instantánea (sin la fecha de archivo). */
export function archivedToTrash(workspace: Workspace, cardId: CardId): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  const entry = archivedEntry(workspace, cardId);
  if (!entry.ok) return failure([...entry.issues]);
  const { archivedAt: _archivedAt, ...snapshot } = entry.value;
  const trashed: TrashedCard = snapshot;
  return validateWorkspace({
    ...workspace,
    archive: (workspace.archive ?? []).filter((candidate) => candidate !== entry.value),
    trash: [...(workspace.trash ?? []), trashed],
  });
}
