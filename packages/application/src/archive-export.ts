/**
 * Exportar una selección del Archivo (ADR 0039): un workspace nuevo y autocontenido con las tarjetas
 * elegidas como tarjetas activas (no archivadas: es una exportación, no sigue archivada), sus
 * relaciones entre sí y solo los assets que usan. No es el ZIP del workspace de origen.
 */
import { validateWorkspace } from '@noutynotes/domain';
import type { BoardId, Card, CardId, Workspace } from '@noutynotes/domain';

import { cardAssetRefs } from './assets-catalog';
import { DEFAULT_CARD_SIZE } from './workspace-editing';
import { workspaceIdFromName } from './ids';

export interface ArchiveSelectionExport {
  readonly workspace: Workspace;
  /** Rutas de assets que las tarjetas elegidas usan; solo esos binarios viajan en el ZIP. */
  readonly assetRefs: readonly string[];
}

export type ArchiveSelectionExportResult = { readonly ok: true; readonly value: ArchiveSelectionExport } | { readonly ok: false; readonly reason: string };

const EXPORT_BOARD_ID = 'seleccion' as BoardId;

/** Cuántas columnas de tarjetas caben en el ancho canónico, para una cuadrícula simple de lectura. */
const COLUMNS = 4;

export function archiveSelectionForExport(workspace: Workspace, cardIds: readonly CardId[]): ArchiveSelectionExportResult {
  if (cardIds.length === 0) return { ok: false, reason: 'Elige al menos una tarjeta.' };
  const archive = workspace.archive ?? [];
  const entries = cardIds.map((cardId) => archive.find((entry) => entry.card.id === cardId)).filter((entry) => entry !== undefined);
  if (entries.length !== cardIds.length) return { ok: false, reason: 'Alguna tarjeta elegida ya no está en el Archivo.' };

  const cards: Card[] = entries.map((entry) => entry.card);
  const selected = new Set(cardIds);
  const cardTypeIds = new Set(cards.map((card) => card.typeId));
  const cardTypes = workspace.cardTypes.filter((type) => cardTypeIds.has(type.id));

  // Cada tarjeta guardó sus propias relaciones al archivarse; una entre dos elegidas queda duplicada
  // (aparece en las dos instantáneas) y se toma una sola vez, por ID.
  const relationMap = new Map(entries.flatMap((entry) => entry.relations
    .filter((relation) => selected.has(relation.from) && selected.has(relation.to))
    .map((relation) => [relation.id, relation] as const)));
  const relationTypeIds = new Set([...relationMap.values()].map((relation) => relation.typeId));
  const relationTypes = workspace.relationTypes.filter((type) => relationTypeIds.has(type.id));

  const placements = cards.map((card, index) => ({
    cardId: card.id,
    rect: { x: (index % COLUMNS) * DEFAULT_CARD_SIZE.w, y: Math.floor(index / COLUMNS) * DEFAULT_CARD_SIZE.h, ...DEFAULT_CARD_SIZE },
    display: 'expanded' as const,
  }));

  const id = workspaceIdFromName(`${workspace.metadata.name} - selección`, []);
  const synthetic: Workspace = {
    schemaVersion: 1,
    id,
    metadata: { name: `Selección exportada de ${workspace.metadata.name}` },
    cardTypes,
    relationTypes,
    cards,
    boards: [{ id: EXPORT_BOARD_ID, title: 'Selección exportada', cardIds: [...cardIds] }],
    layouts: [{ boardId: EXPORT_BOARD_ID, placements }],
    relations: [...relationMap.values()],
  };
  const validated = validateWorkspace(synthetic);
  if (!validated.ok) return { ok: false, reason: 'La selección no se pudo armar como workspace exportable.' };

  const assetRefs = [...new Set(cards.flatMap((card) => cardAssetRefs(synthetic, card)))];
  return { ok: true, value: { workspace: validated.value, assetRefs } };
}
