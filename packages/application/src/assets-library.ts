/**
 * Biblioteca de assets del proyecto (ADR 0022): importar sin crear tarjeta, añadir al tablero sin copiar,
 * reemplazar cambiando todas las referencias en una transacción y eliminar solo lo que nada usa.
 */
import { validateWorkspace } from '@noutynotes/domain';
import type { AssetRef, BoardId, CardId, WorkspaceId } from '@noutynotes/domain';

import { assetKind, buildAssetCatalog, replaceAssetReferences } from './assets-catalog';
import { inspectImage, titleFrom, withdraw, writeImageAsset } from './images';
import { fold } from './search';
import type { WorkspaceAssets } from './workspace-assets';
import { addCardToBoard } from './workspace-editing';
import type { AddCardInput } from './workspace-editing';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

/** Nombre de archivo portable a partir del del usuario: «Plano del Río.jpg» → «plano-del-rio». */
export function assetBaseName(fileName: string, fallback = 'imagen'): string {
  const base = fold(fileName.replace(/\.[^./\\]*$/, '')).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base === '' ? fallback : base;
}

const numbered = (base: string) => (attempt: number) => (attempt === 1 ? base : `${base}-${attempt}`);

/** Importa una imagen a `assets/images/` sin crear tarjeta. Devuelve su ruta. */
export async function importAssetImage(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, input: { readonly bytes: Uint8Array; readonly fileName: string },
): Promise<WorkspaceStorageResult<string>> {
  const kind = inspectImage(input.bytes);
  if (!kind.ok) return { ok: false, issues: kind.issues };
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  return writeImageAsset(assets, workspaceId, input.bytes, kind.value, numbered(assetBaseName(input.fileName)));
}

/** Tarjeta de imagen que referencia un asset existente, sin copiarlo. Devuelve su ID. */
export function addAssetToBoard(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, input: { readonly ref: string; readonly boardId?: BoardId; readonly near?: AddCardInput['near']; readonly createdAt?: string },
): Promise<WorkspaceStorageResult<CardId>> {
  if (typeof input.ref !== 'string' || assetKind(input.ref) !== 'image') {
    return Promise.resolve(storageFailure('invalid-asset', 'ref', 'Solo las imágenes pueden añadirse al tablero como tarjeta.'));
  }
  const name = input.ref.split('/').pop() ?? input.ref;
  return addCardToBoard(storage, workspaceId, {
    kind: 'image', assetRef: input.ref, title: titleFrom(name),
    ...(input.boardId ? { boardId: input.boardId } : {}), ...(input.near ? { near: input.near } : {}), ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

/**
 * Reemplaza un asset por una imagen nueva: escribe el archivo (sin sobrescribir nada) y cambia todas las
 * referencias en una sola transacción. El anterior queda sin usar. Si no se guarda, se retira el nuevo.
 */
export async function replaceAsset(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId,
  input: { readonly from: string; readonly bytes: Uint8Array; readonly fileName: string },
): Promise<WorkspaceStorageResult<string>> {
  const kind = inspectImage(input.bytes);
  if (!kind.ok) return { ok: false, issues: kind.issues };
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const written = await writeImageAsset(assets, workspaceId, input.bytes, kind.value, numbered(assetBaseName(input.fileName)));
  if (!written.ok) return { ok: false, issues: written.issues };
  const to = written.value;
  const saved = await modifyWorkspace(storage, workspaceId, (workspace) => validateWorkspace(replaceAssetReferences(workspace, input.from, to)));
  if (saved.ok) return { ok: true, value: to };
  return withdraw(assets, workspaceId, to as AssetRef, saved);
}

export interface DeleteAssetsResult {
  readonly removed: readonly string[];
  /** No se borran: alguna tarjeta (activa o en la Papelera) los usa. */
  readonly inUse: readonly string[];
  readonly failed: readonly string[];
}

/** Borra los assets indicados que nada usa; los que están en uso se devuelven sin tocar. */
export async function deleteUnusedAssets(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, refs: readonly string[],
): Promise<WorkspaceStorageResult<DeleteAssetsResult>> {
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const listed = await assets.listAssets(workspaceId);
  if (!listed.ok) return { ok: false, issues: listed.issues };
  const catalog = new Map(buildAssetCatalog(opened.value, listed.value).map((entry) => [entry.ref, entry]));
  const removed: string[] = [];
  const inUse: string[] = [];
  const failed: string[] = [];
  for (const ref of refs) {
    const entry = catalog.get(ref);
    if (!entry || entry.missing) continue;
    if (!entry.unused) {
      inUse.push(ref);
      continue;
    }
    const result = await assets.removeAsset(workspaceId, ref as AssetRef);
    (result.ok ? removed : failed).push(ref);
  }
  return { ok: true, value: { removed, inUse, failed } };
}
