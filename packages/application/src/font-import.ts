/**
 * Fuentes en la biblioteca (ADR 0041, ADR 0042): validación por firma binaria (TTF, OTF, WOFF2 —esta
 * última es el formato que sirve Google Fonts, confirmado contra el servidor real antes de programar—),
 * nunca por la extensión del nombre, igual que una imagen (ADR 0015). La licencia no se puede verificar:
 * se guarda como nota de buena fe, no como prueba.
 */
import { isValidAssetRef } from '@noutynotes/domain';
import type { AssetRef, WorkspaceId } from '@noutynotes/domain';

import { assetBaseName } from './assets-library';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';
import type { WorkspaceAssets } from './workspace-assets';

/** Una fuente completa rara vez pasa de unos pocos MB; margen entre imágenes (5 MB) y documentos (20 MB). */
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

export interface FontKind {
  readonly extension: 'ttf' | 'otf' | 'woff2';
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((value, index) => bytes[index] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Firma binaria: TrueType `00 01 00 00`; OpenType/CFF `OTTO`; WOFF2 `wOF2` (ADR 0042). Sin TTC ni WOFF. */
export function inspectFont(bytes: Uint8Array): WorkspaceStorageResult<FontKind> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return storageFailure('invalid-asset', 'archivo', 'El archivo está vacío.');
  if (bytes.length > MAX_FONT_BYTES) return storageFailure('invalid-asset', 'archivo', 'La fuente supera 10 MB.');
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00])) return { ok: true, value: { extension: 'ttf' } };
  if (startsWith(bytes, ascii('OTTO'))) return { ok: true, value: { extension: 'otf' } };
  if (startsWith(bytes, ascii('wOF2'))) return { ok: true, value: { extension: 'woff2' } };
  return storageFailure('invalid-asset', 'archivo', 'Formato no admitido. Usa una fuente TTF, OTF o WOFF2.');
}

export interface LibraryFontInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Nota de licencia de buena fe (ADR 0041), no una prueba: se guarda junto a la fuente si no está vacía. */
  readonly licenseNote?: string;
}

export interface ImportedFont {
  readonly ref: string;
  readonly licenseRef?: string;
}

/**
 * Importa una fuente a `assets/fonts/`, sin crear tarjeta. Nunca sobrescribe: numera si el nombre ya
 * existe. La nota de licencia, si se da, se guarda como `<ruta>.license.txt`; si falla, la fuente ya
 * quedó guardada y se devuelve igual, sin nota (no bloquea por un archivo auxiliar opcional).
 */
export async function importLibraryFont(
  storage: WorkspaceStorage, assets: WorkspaceAssets, workspaceId: WorkspaceId, input: LibraryFontInput,
): Promise<WorkspaceStorageResult<ImportedFont>> {
  const kind = inspectFont(input.bytes);
  if (!kind.ok) return { ok: false, issues: kind.issues };
  const opened = await storage.open(workspaceId);
  if (!opened.ok) return { ok: false, issues: opened.issues };
  const base = assetBaseName(input.fileName, 'fuente');
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = `assets/fonts/${attempt === 1 ? base : `${base}-${attempt}`}.${kind.value.extension}`;
    if (!isValidAssetRef(candidate)) break;
    const written = await assets.writeAsset(workspaceId, candidate as AssetRef, input.bytes);
    if (!written.ok) {
      if (written.issues[0]?.code !== 'asset-conflict') return { ok: false, issues: written.issues };
      continue;
    }
    const note = input.licenseNote?.trim();
    if (!note) return { ok: true, value: { ref: candidate } };
    const licenseRef = `${candidate}.license.txt`;
    const savedNote = await assets.writeAsset(workspaceId, licenseRef as AssetRef, new TextEncoder().encode(note));
    return { ok: true, value: savedNote.ok ? { ref: candidate, licenseRef } : { ref: candidate } };
  }
  return storageFailure('asset-conflict', 'archivo', 'No hay un nombre libre para la fuente en assets/fonts.');
}
