// Datos de prueba deterministas. No se exportan desde el paquete.
import type { AssetRef } from '../assets/asset-ref';
import type { Card } from '../cards/card';
import type { CardTypeDefinition } from '../cards/card-type';
import type { ValidationResult } from '../errors';
import type { BoardId, CardId, CardTypeId, FieldKey, Id, RelationId, RelationTypeId, WorkspaceId } from '../ids';
import type { Workspace } from '../workspace/workspace';

export const id = <T extends Id<string>>(value: string) => value as T;
export const asset = (value: string) => value as AssetRef;

export const noteType: CardTypeDefinition = {
  id: id<CardTypeId>('note'),
  label: 'Nota',
  base: 'note',
  fields: [
    { key: id<FieldKey>('summary'), kind: 'markdown', required: true },
    { key: id<FieldKey>('status'), kind: 'select', options: ['open', 'done'] },
    { key: id<FieldKey>('due'), kind: 'date' },
    { key: id<FieldKey>('cover'), kind: 'asset' },
    { key: id<FieldKey>('source'), kind: 'url' },
    { key: id<FieldKey>('score'), kind: 'number' },
    { key: id<FieldKey>('pinned'), kind: 'boolean' },
  ],
};

export const ideaA: Card = {
  id: id<CardId>('idea-a'),
  typeId: id<CardTypeId>('note'),
  title: 'Idea A',
  content: '# Idea A\n\nTexto **Markdown**.',
  fields: { summary: 'Resumen', status: 'open', due: '2026-02-28', cover: 'assets/images/a.png' },
  assetRefs: [asset('assets/images/a.png')],
};

export const ideaB: Card = {
  id: id<CardId>('idea-b'),
  typeId: id<CardTypeId>('note'),
  fields: { summary: 'Otra', score: 3, pinned: true, source: 'https://example.com/ref' },
};

export function validWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: id<WorkspaceId>('demo'),
    metadata: { name: 'Demo', description: 'Workspace de prueba' },
    cardTypes: [noteType],
    relationTypes: [{ id: id<RelationTypeId>('references'), label: 'Referencia' }],
    cards: [ideaA, ideaB],
    boards: [
      { id: id<BoardId>('overview'), title: 'Resumen', cardIds: [ideaA.id, ideaB.id] },
      // La misma tarjeta puede mostrarse en otro board.
      { id: id<BoardId>('research'), title: 'Investigación', cardIds: [ideaA.id] },
    ],
    layouts: [
      {
        boardId: id<BoardId>('overview'),
        placements: [
          { cardId: ideaA.id, rect: { x: 0, y: 0, w: 4, h: 3 }, display: 'expanded' },
          { cardId: ideaB.id, rect: { x: 4, y: 0, w: 4, h: 2 }, display: 'minimized' },
        ],
      },
    ],
    relations: [{ id: id<RelationId>('a-references-b'), typeId: id<RelationTypeId>('references'), from: ideaA.id, to: ideaB.id }],
  };
}

/** Incidencias como `código@ruta` para comparar resultados de forma legible. */
export function problems(result: ValidationResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

/** Construye datos que el tipo no admitiría, como llegarían desde un archivo externo. */
export function unsafe<T>(value: unknown): T {
  return value as T;
}
