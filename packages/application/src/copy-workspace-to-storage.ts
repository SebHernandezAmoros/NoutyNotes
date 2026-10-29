import type { AssetRef, WorkspaceId } from '@noutynotes/domain';
import { assetsOf } from './workspace-assets';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceSummary } from './workspace-storage';

export type WorkspaceCopyResult = { readonly ok: true; readonly summary: WorkspaceSummary } | {
  readonly ok: false; readonly stage: 'prepare' | 'write' | 'verify'; readonly partial: boolean; readonly issues: readonly WorkspaceStorageIssue[];
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Revalidación sin escrituras para reintentar una activación fallida; detecta cambios posteriores. */
export async function verifyWorkspaceCopy(source: WorkspaceStorage, destination: WorkspaceStorage, id: WorkspaceId): Promise<boolean> {
  try {
    const original = await source.open(id); const copy = await destination.open(id);
    if (!original.ok || !copy.ok || stable(original.value) !== stable(copy.value)) return false;
    if (!source.exportDocuments || !destination.exportDocuments) return false;
    const originalDocs = await source.exportDocuments(id); const copyDocs = await destination.exportDocuments(id);
    if (!originalDocs.ok || !copyDocs.ok || stable(originalDocs.value) !== stable(copyDocs.value)) return false;
    const sourceAssets = assetsOf(source); const targetAssets = assetsOf(destination);
    if (!sourceAssets || !targetAssets) return false;
    const refs = await sourceAssets.listAssets(id); const targetRefs = await targetAssets.listAssets(id);
    if (!refs.ok || !targetRefs.ok || stable([...refs.value].sort()) !== stable([...targetRefs.value].sort())) return false;
    for (const path of refs.value) {
      const a = await sourceAssets.readAsset(id, path as AssetRef); const b = await targetAssets.readAsset(id, path as AssetRef);
      if (!a.ok || !b.ok || !equalBytes(a.value, b.value)) return false;
    }
    return true;
  } catch { return false; }
}

/** Copia conservadora, nunca mueve ni elimina. No promete una transacción conjunta de textos/binarios.
 * La UI debe excluir edición durante la copia y no activar hasta recibir ok; un error conserva origen.
 */
export async function copyWorkspaceToStorage(source: WorkspaceStorage, destination: WorkspaceStorage, id: WorkspaceId): Promise<WorkspaceCopyResult> {
  let stage: 'prepare' | 'write' | 'verify' = 'prepare'; let partial = false;
  const failure = (issues: readonly WorkspaceStorageIssue[]): WorkspaceCopyResult => ({ ok: false, stage, partial, issues });
  const invalid = (message: string): WorkspaceCopyResult => failure([{ code: 'io-failure', path: 'copy', message }]);
  try {
    if (source === destination) return invalid('El origen y el destino deben ser distintos.');
    const srcAssets = assetsOf(source); const dstAssets = assetsOf(destination);
    if (!srcAssets || !dstAssets) return invalid('El almacenamiento no permite conservar todos los binarios.');
    const listed = await destination.list(); if (!listed.ok) return failure(listed.issues);
    if (listed.value.length > 0) return failure([{ code: 'workspace-already-exists', path: 'destination', message: 'Selecciona una carpeta vacía; no se sobrescriben proyectos.' }]);
    const opened = await source.open(id); if (!opened.ok) return failure(opened.issues);
    const snapshot = opened.value; const fingerprint = stable(snapshot);
    if (!source.exportDocuments || !destination.exportDocuments) return invalid('El almacenamiento no permite conservar los documentos originales.');
    const documents = await source.exportDocuments(id); if (!documents.ok) return failure(documents.issues);
    const refs = await srcAssets.listAssets(id); if (!refs.ok) return failure(refs.issues);
    const binaries = new Map<AssetRef, Uint8Array>();
    for (const path of refs.value) {
      const ref = path as AssetRef; const bytes = await srcAssets.readAsset(id, ref);
      if (!bytes.ok) return failure(bytes.issues);
      binaries.set(ref, bytes.value.slice());
    }
    stage = 'write'; partial = true; // incluso un create fallido puede dejar archivos parciales.
    const created = await destination.create(snapshot, documents.value); if (!created.ok) return failure(created.issues);
    for (const [ref, bytes] of binaries) {
      const written = await dstAssets.writeAsset(id, ref, bytes); if (!written.ok) return failure(written.issues);
    }
    stage = 'verify';
    const reopened = await destination.open(id); if (!reopened.ok) return failure(reopened.issues);
    if (stable(reopened.value) !== fingerprint) return invalid('La copia no coincide con el documento original.');
    const copyDocs = await destination.exportDocuments(id); if (!copyDocs.ok) return failure(copyDocs.issues);
    if (stable(copyDocs.value) !== stable(documents.value)) return invalid('La copia no conserva los documentos originales.');
    const copiedRefs = await dstAssets.listAssets(id); if (!copiedRefs.ok) return failure(copiedRefs.issues);
    if (stable([...copiedRefs.value].sort()) !== stable([...binaries.keys()].sort())) return invalid('La copia no conserva el inventario de binarios.');
    for (const [ref, bytes] of binaries) {
      const checked = await dstAssets.readAsset(id, ref); if (!checked.ok) return failure(checked.issues);
      if (!equalBytes(bytes, checked.value)) return invalid('Un binario de la copia no coincide con el original.');
    }
    const latest = await source.open(id); if (!latest.ok) return failure(latest.issues);
    const latestDocs = await source.exportDocuments(id); if (!latestDocs.ok) return failure(latestDocs.issues);
    if (stable(latestDocs.value) !== stable(documents.value)) return invalid('Los documentos del origen cambiaron durante la copia.');
    const latestRefs = await srcAssets.listAssets(id); if (!latestRefs.ok) return failure(latestRefs.issues);
    if (stable(latest.value) !== fingerprint || stable([...latestRefs.value].sort()) !== stable([...binaries.keys()].sort())) return invalid('El origen cambió durante la copia; no se activará el destino.');
    for (const [ref, bytes] of binaries) {
      const latestBytes = await srcAssets.readAsset(id, ref);
      if (!latestBytes.ok) return failure(latestBytes.issues);
      if (!equalBytes(bytes, latestBytes.value)) return invalid('Un binario del origen cambió durante la copia.');
    }
    return { ok: true, summary: created.value };
  } catch { return invalid('No se pudo completar o verificar la copia. El origen se conserva.'); }
}
