import { isValidId, validateWorkspace } from '@noutynotes/domain';
import type { Board, Card, DomainIssue, TrashedCard, Workspace } from '@noutynotes/domain';
import type { z } from 'zod';

import { LAYOUT_FILE, RELATIONS_FILE, layoutData, layoutSchemaVersion, parseLayouts, parseRelations, relationData } from './codecs';
import { checkShape, checkVersionedData, compact, duplicateIdIssues, mergeWithPrevious, plainDataIssues, previousFilesIssues, readVersionedYaml, yamlDocument } from './documents';
import type { GeneratedDocument, PreviousPackage } from './documents';
import { joinFrontmatter, splitFrontmatter } from './frontmatter';
import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { isPortableAssetRef } from './paths';
import { boardFrontmatterSchema, cardFrontmatterSchema, trashFileSchema, workspaceManifestSchema, workspaceSchema } from './schemas';
import { validateTextFiles } from './text-files';
import type { TextFiles } from './text-files';
import { parseYaml, stringifyYaml } from './yaml';

export const WORKSPACE_FILE = '.nouty/workspace.yaml';
/** Papelera de tarjetas (ADR 0015): documento administrado opcional, solo si no está vacía. */
export const TRASH_FILE = '.nouty/trash.yaml';
export const WORKSPACE_README = 'README.md';
export const ASSETS_DIRECTORY = 'assets/';

export const cardPath = (id: string): string => `cards/${id}.md`;
export const boardPath = (id: string): string => `boards/${id}.md`;

/** Extras que el formato conserva sin interpretarlos: README del workspace y textos bajo assets/. */
export function isWorkspaceExtra(path: string): boolean {
  return path === WORKSPACE_README || path.startsWith(ASSETS_DIRECTORY);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clave semántica de un documento Markdown: frontmatter canónico más cuerpo literal. */
function markdownDocument(frontmatter: unknown, body: string): GeneratedDocument {
  const yaml = stringifyYaml(frontmatter);
  return { text: joinFrontmatter(yaml, body), key: `${yaml}\u0000${body}` };
}

function cardDocument(card: Card): GeneratedDocument {
  return markdownDocument(compact({
    schemaVersion: 1, id: card.id, typeId: card.typeId, title: card.title,
    fields: card.fields, assetRefs: card.assetRefs, contentPresent: card.content !== undefined,
  }), card.content ?? '');
}

/** Copia canónica de una instantánea de la Papelera, sin claves ausentes ni orden accidental. */
function trashData(entry: TrashedCard): unknown {
  const { card } = entry;
  return compact({
    card: { id: card.id, typeId: card.typeId, title: card.title, fields: card.fields, assetRefs: card.assetRefs, content: card.content },
    boards: entry.boards.map(({ boardId, index }) => ({ boardId, index })),
    placements: entry.placements.map(({ boardId, rect, display }) => ({ boardId, display, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } })),
    relations: entry.relations.map(relationData),
  });
}

function trashSchemaVersion(entries: readonly TrashedCard[]): 1 | 2 {
  return entries.some((entry) => entry.placements.some((placement) => placement.rect.x < 0 || placement.rect.y < 0)) ? 2 : 1;
}

function boardDocument(board: Board): GeneratedDocument {
  return markdownDocument(compact({
    schemaVersion: 1, id: board.id, title: board.title, cardIds: board.cardIds,
    descriptionPresent: board.description !== undefined,
  }), board.description ?? '');
}

/**
 * Documentos administrados de un workspace ya validado. Cada documento depende solo de su parte
 * del modelo, así que dos workspaces con la misma parte producen la misma clave.
 */
function workspaceDocuments(workspace: Workspace): Map<string, GeneratedDocument> {
  const documents = new Map<string, GeneratedDocument>();
  documents.set(WORKSPACE_FILE, yamlDocument(compact({
    schemaVersion: 1, id: workspace.id, metadata: workspace.metadata,
    cardTypes: workspace.cardTypes, relationTypes: workspace.relationTypes,
    cards: workspace.cards.map((card) => card.id), boards: workspace.boards.map((board) => board.id),
  })));
  documents.set(LAYOUT_FILE, yamlDocument({ schemaVersion: layoutSchemaVersion(workspace.layouts), layouts: workspace.layouts.map(layoutData) }));
  documents.set(RELATIONS_FILE, yamlDocument({ schemaVersion: 1, relations: workspace.relations.map(relationData) }));
  for (const card of workspace.cards) documents.set(cardPath(card.id), cardDocument(card));
  for (const board of workspace.boards) documents.set(boardPath(board.id), boardDocument(board));
  if (workspace.trash && workspace.trash.length > 0) {
    documents.set(TRASH_FILE, yamlDocument({ schemaVersion: trashSchemaVersion(workspace.trash), items: workspace.trash.map(trashData) }));
  }
  return documents;
}

/** Referencias de assets portables: las de la tarjeta y los valores de campos `asset`. */
function assetPathIssues(workspace: Workspace, locate: (cardIndex: number, rest: string) => string): StorageIssue[] {
  const kinds = new Map(workspace.cardTypes.map((type) => [type.id, new Map(type.fields.map((field) => [field.key as string, field.kind]))]));
  const issues: StorageIssue[] = [];
  const message = 'Las referencias a assets deben ser rutas portables.';
  const cards = [...workspace.cards, ...(workspace.trash ?? []).map((entry) => entry.card)];
  cards.forEach((card, index) => {
    card.assetRefs?.forEach((ref, j) => {
      if (!isPortableAssetRef(ref)) issues.push(storageIssue('invalid-path', locate(index, `assetRefs[${j}]`), message));
    });
    for (const [key, value] of Object.entries(card.fields)) {
      if (kinds.get(card.typeId)?.get(key) === 'asset' && !isPortableAssetRef(value)) {
        issues.push(storageIssue('invalid-path', locate(index, `fields.${key}`), message));
      }
    }
  });
  return issues;
}

/** Sitúa una incidencia de `validateWorkspace` en el archivo que contiene el dato. */
function locateWorkspaceIssue(issue: DomainIssue | StorageIssue, workspace: Workspace): StorageIssue {
  const entity = /^(cards|boards)\[(\d+)\](?:\.(.*))?$/.exec(issue.path);
  if (entity) {
    const [, kind, index, rest] = entity;
    const id = kind === 'cards' ? workspace.cards[Number(index)]?.id : workspace.boards[Number(index)]?.id;
    if (id !== undefined) {
      const file = kind === 'cards' ? cardPath(id) : boardPath(id);
      return { ...issue, path: rest ? `${file}#${rest}` : file };
    }
  }
  if (/^layouts(\[|$)/.test(issue.path)) return { ...issue, path: `${LAYOUT_FILE}#${issue.path}` };
  if (/^trash(\[|$)/.test(issue.path)) return { ...issue, path: `${TRASH_FILE}#${issue.path}` };
  if (/^relations(\[|$)/.test(issue.path)) return { ...issue, path: `${RELATIONS_FILE}#${issue.path}` };
  return { ...issue, path: issue.path ? `${WORKSPACE_FILE}#${issue.path}` : WORKSPACE_FILE };
}

interface MarkdownEntity<T> {
  readonly frontmatter: T;
  readonly body: string;
}

/** Documento Markdown administrado: frontmatter estricto, versión, forma e identidad. */
function readMarkdown<T extends { readonly id: string }>(
  text: string,
  file: string,
  id: string,
  schema: z.ZodType<T>,
): StorageResult<MarkdownEntity<T>> {
  const split = splitFrontmatter(text, file);
  if (!split.ok) return split;
  const parsed = parseYaml(split.value.frontmatter, file);
  if (!parsed.ok) return parsed;
  const checked = checkVersionedData(parsed.value, file, schema);
  if (!checked.ok) return checked;
  if (checked.value.id !== id) {
    return fail([storageIssue('identity-mismatch', `${file}#id`, `El documento declara "${checked.value.id}" pero el manifiesto y la ruta indican "${id}".`)]);
  }
  return succeed({ frontmatter: checked.value, body: split.value.body });
}

interface WorkspacePackage {
  readonly workspace: Workspace;
  readonly files: TextFiles;
  readonly extras: ReadonlyMap<string, string>;
}

function manifestIdIssues(ids: readonly string[], key: 'cards' | 'boards'): StorageIssue[] {
  const path = `${WORKSPACE_FILE}#${key}`;
  const invalid = ids.flatMap((id, index) => (isValidId(id) ? [] : [storageIssue('invalid-id', `${path}[${index}]`, `Identificador inválido: "${id}".`)]));
  return [...invalid, ...duplicateIdIssues(ids, path, `la lista de ${key}`)];
}

/** Lectura completa y validada de un paquete de workspace, conservando archivos y extras. */
function readWorkspacePackage(input: unknown): StorageResult<WorkspacePackage> {
  const validated = validateTextFiles(input);
  if (!validated.ok) return validated;
  const files = validated.value;
  const manifestText = files[WORKSPACE_FILE];
  if (manifestText === undefined) return fail([storageIssue('missing-file', WORKSPACE_FILE, 'Falta el manifiesto del workspace.')]);
  const parsedManifest = parseYaml(manifestText, WORKSPACE_FILE);
  if (!parsedManifest.ok) return parsedManifest;
  const manifest = checkVersionedData(parsedManifest.value, WORKSPACE_FILE, workspaceManifestSchema);
  if (!manifest.ok) return manifest;
  const { cards: cardIds, boards: boardIds } = manifest.value;
  const idIssues = [...manifestIdIssues(cardIds, 'cards'), ...manifestIdIssues(boardIds, 'boards')];
  if (idIssues.length > 0) return fail(idIssues);

  const managed = new Set([WORKSPACE_FILE, LAYOUT_FILE, RELATIONS_FILE, ...cardIds.map(cardPath), ...boardIds.map(boardPath)]);
  // La Papelera es opcional: se administra si existe, pero su ausencia no es un error.
  const hasTrash = files[TRASH_FILE] !== undefined;
  const issues: StorageIssue[] = [];
  const extras = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) {
    if (managed.has(path) || path === TRASH_FILE) continue;
    if (isWorkspaceExtra(path)) extras.set(path, text);
    else issues.push(storageIssue('unexpected-file', path, 'Archivo no declarado en el manifiesto ni admitido como extra (README.md o assets/).'));
  }
  for (const path of managed) {
    if (files[path] === undefined) issues.push(storageIssue('missing-file', path, 'Falta un documento declarado en el manifiesto.'));
  }
  if (issues.length > 0) return fail(issues);

  const cards: Card[] = [];
  for (const id of cardIds) {
    const file = cardPath(id);
    const read = readMarkdown(files[file] ?? '', file, id, cardFrontmatterSchema);
    if (!read.ok) {
      issues.push(...read.issues);
      continue;
    }
    const { frontmatter: front, body } = read.value;
    if (!front.contentPresent && body !== '') {
      issues.push(storageIssue('invalid-document', file, 'Con contentPresent: false el cuerpo debe estar vacío.'));
      continue;
    }
    // El marcador distingue contenido ausente de contenido vacío; el cuerpo se toma literal.
    cards.push(compact({
      id, typeId: front.typeId, title: front.title, fields: front.fields, assetRefs: front.assetRefs,
      content: front.contentPresent ? body : undefined,
    }) as unknown as Card);
  }
  const boards: Board[] = [];
  for (const id of boardIds) {
    const file = boardPath(id);
    const read = readMarkdown(files[file] ?? '', file, id, boardFrontmatterSchema);
    if (!read.ok) {
      issues.push(...read.issues);
      continue;
    }
    const { frontmatter: front, body } = read.value;
    if (!front.descriptionPresent && body !== '') {
      issues.push(storageIssue('invalid-document', file, 'Con descriptionPresent: false el cuerpo debe estar vacío.'));
      continue;
    }
    boards.push(compact({
      id, title: front.title, cardIds: front.cardIds, description: front.descriptionPresent ? body : undefined,
    }) as unknown as Board);
  }
  const layouts = parseLayouts(files[LAYOUT_FILE] ?? '');
  if (!layouts.ok) issues.push(...layouts.issues);
  const relations = parseRelations(files[RELATIONS_FILE] ?? '');
  if (!relations.ok) issues.push(...relations.issues);
  const trash = hasTrash ? readVersionedYaml(files[TRASH_FILE] ?? '', TRASH_FILE, trashFileSchema, [1, 2]) : null;
  if (trash && !trash.ok) issues.push(...trash.issues);
  if (trash?.ok && trash.value.schemaVersion === 1) {
    trash.value.items.forEach((entry, itemIndex) => entry.placements.forEach((placement, placementIndex) => {
      for (const axis of ['x', 'y'] as const) {
        if (placement.rect[axis] < 0) issues.push(storageIssue('invalid-layout',
          `${TRASH_FILE}#items[${itemIndex}].placements[${placementIndex}].rect.${axis}`,
          'La versión 1 no admite posiciones negativas.'));
      }
    }));
  }
  if (issues.length > 0 || !layouts.ok || !relations.ok || (trash && !trash.ok)) return fail(issues);

  const { id, metadata, cardTypes, relationTypes } = manifest.value;
  // Datos con la forma comprobada; `validateWorkspace` decide si cumplen las invariantes.
  const workspace = compact({
    schemaVersion: 1, id, metadata, cardTypes, relationTypes, cards, boards, layouts: layouts.value, relations: relations.value,
    trash: trash?.ok ? trash.value.items : undefined,
  }) as unknown as Workspace;
  const semantic = validateWorkspace(workspace);
  const located = [
    ...(semantic.ok ? [] : semantic.issues.map((found) => locateWorkspaceIssue(found, workspace))),
    ...assetPathIssues(workspace, (index, rest) => `${cardPath(cardIds[index] ?? '')}#${rest}`),
  ];
  return located.length > 0 ? fail(located) : succeed({ workspace, files, extras });
}

/**
 * Lee un paquete v1 como Workspace. Valida rutas, límites, YAML estricto, versiones, claves
 * cerradas, identidad manifiesto/ruta/documento e invariantes del dominio. Los extras admitidos
 * no forman parte del modelo.
 */
export function parseWorkspace(files: TextFiles): StorageResult<Workspace> {
  const read = readWorkspacePackage(files);
  return read.ok ? succeed(read.value.workspace) : read;
}

/** Datos de entrada escribibles sin pérdida: inertes, forma cerrada, dominio y rutas portables. */
function checkWorkspaceInput(workspace: unknown): StorageIssue[] {
  if (!isObject(workspace)) return [storageIssue('invalid-value', 'workspace', 'Debe ser un objeto Workspace.')];
  const inert = plainDataIssues(workspace, '');
  if (inert.length > 0) return inert;
  const shaped = checkShape(workspaceSchema, workspace);
  if (!shaped.ok) return [...shaped.issues];
  const typed = workspace as unknown as Workspace;
  const semantic = validateWorkspace(typed);
  if (!semantic.ok) return [...semantic.issues];
  return assetPathIssues(typed, (index, rest) => `cards[${index}].${rest}`);
}

/**
 * Escribe un workspace como paquete v1 determinista. Con `previousFiles`, valida antes el paquete
 * anterior, reutiliza los bytes de cada documento sin cambios semánticos (incluidos comentarios y
 * estilo), regenera solo los modificados, omite los de entidades eliminadas y conserva los extras
 * admitidos. Un documento regenerado pierde los comentarios YAML que tuviera.
 */
export function serializeWorkspace(workspace: Workspace, previousFiles?: TextFiles): StorageResult<TextFiles> {
  const inputIssues = checkWorkspaceInput(workspace);
  if (inputIssues.length > 0) return fail(inputIssues);
  let previous: PreviousPackage | undefined;
  if (previousFiles !== undefined) {
    const read = readWorkspacePackage(previousFiles);
    if (!read.ok) return fail(previousFilesIssues(read.issues));
    previous = { ...read.value, documents: workspaceDocuments(read.value.workspace) };
  }
  // Los extras también cuentan para los límites del resultado.
  return mergeWithPrevious(workspaceDocuments(workspace), previous);
}
