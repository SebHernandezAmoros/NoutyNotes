import { isValidAssetRef } from '@noutynotes/domain';
import type { RichTextPdf, WorkspaceId } from '@noutynotes/domain';
import type { WorkspaceAssets } from './workspace-assets';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorageResult } from './workspace-storage';

export const MAX_NOTE_PDF_BYTES = 16 * 1024 * 1024;
/** Minimal signature, not a sanitizer or proof that every page is renderable. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, index) => bytes[index] === byte);
}
export function inspectNotePdf(bytes: Uint8Array): WorkspaceStorageResult<void> {
  if (bytes.length > MAX_NOTE_PDF_BYTES) return storageFailure('invalid-asset', 'archivo', 'El PDF supera 16 MiB por archivo: no puede viajar en el ZIP. Usa un PDF más pequeño; no se ha modificado el original.');
  if (!hasPdfSignature(bytes)) return storageFailure('invalid-asset', 'archivo', 'El archivo no tiene una firma PDF válida.');
  return { ok: true, value: undefined };
}
/** Prepares an editorial object only. No snapshot save, copy or physical removal. */
export async function prepareNotePdf(assets: WorkspaceAssets, workspaceId: WorkspaceId, ref: string, label?: string): Promise<WorkspaceStorageResult<RichTextPdf>> {
  if (!isValidAssetRef(ref) || !/^assets\/.+\.pdf$/i.test(ref)) return storageFailure('invalid-asset', 'ref', 'Selecciona un PDF de este proyecto.');
  if (label !== undefined && (label.trim().length === 0 || label.length > 1000)) return storageFailure('invalid-asset', 'label', 'El nombre debe contener entre 1 y 1000 caracteres.');
  const read = await assets.readAsset(workspaceId, ref);
  if (!read.ok) return read;
  const checked = inspectNotePdf(read.value);
  if (!checked.ok) return checked;
  return { ok: true, value: { type: 'pdf', assetRef: ref, ...(label === undefined ? {} : { label }) } };
}
