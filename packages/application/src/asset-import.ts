/**
 * Documentos y audio en la biblioteca (ADR 0038): validación por extensión (ya la usa el catálogo,
 * ADR 0022), no por firma binaria — a diferencia de una imagen, son demasiados formatos para eso.
 */
import { isValidAssetRef } from '@noutynotes/domain';
import type { AssetRef, WorkspaceId } from '@noutynotes/domain';

import { assetKind } from './assets-catalog';
import { assetBaseName } from './assets-library';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import type { WorkspaceAssets } from './workspace-assets';

/** Documentos y audio son formatos más grandes que una imagen; el ZIP y la memoria siguen siendo razonables. */
export const MAX_LIBRARY_FILE_BYTES = 20 * 1024 * 1024;

const FOLDER: Readonly<Record<'document' | 'audio', string>> = { document: 'assets/documents', audio: 'assets/audio' };

export interface LibraryFileInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

/**
 * Importa un documento o audio a `assets/documents/` o `assets/audio/`, sin crear tarjeta (no hay
 * tipo de tarjeta que los represente todavía). Nunca sobrescribe: numera si el nombre ya existe.
 * Devuelve su ruta.
 */
export async function importLibraryFile(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, input: LibraryFileInput,
): Promise<WorkspaceStorageResult<string>> {
  const kind = assetKind(input.fileName);
  if (kind !== 'document' && kind !== 'audio') {
    return storageFailure('invalid-asset', 'archivo', 'Ese tipo de archivo no se puede importar todavía: solo documentos y audio.');
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) return storageFailure('invalid-asset', 'archivo', 'El archivo está vacío.');
  if (input.bytes.length > MAX_LIBRARY_FILE_BYTES) return storageFailure('invalid-asset', 'archivo', 'El archivo supera 20 MB.');
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const extension = input.fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const base = assetBaseName(input.fileName, 'archivo');
  const folder = FOLDER[kind];
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = `${folder}/${attempt === 1 ? base : `${base}-${attempt}`}${extension}`;
    if (!isValidAssetRef(candidate)) break;
    const written = await assets.writeAsset(workspaceId, candidate as AssetRef, input.bytes);
    if (written.ok) return { ok: true, value: candidate };
    if (written.issues[0]?.code !== 'asset-conflict') return { ok: false, issues: written.issues };
  }
  return storageFailure('asset-conflict', 'archivo', 'No hay un nombre libre para el archivo.');
}
