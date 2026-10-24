import { expect, it, vi } from 'vitest';
import {
  addCardToBoard, addDocumentToBoard, analyzeAssetReferences, createEmptyWorkspaceNamed, editCardContent,
  importAssetImage, importLibraryFile, moveCardToArchive, moveCardToTrash,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';
import type { AssetRef } from '../../packages/domain/src/index';

function value<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it('consulta snapshots reales de activo/Archivo/Papelera y PDF sin llamar al almacenamiento ni cambiar contenido o bytes', async () => {
  const storage = new ArchiveStorage();
  const { id } = value(await createEmptyWorkspaceNamed(storage, 'Referencias U1'));
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const ref = value(await importAssetImage(storage, storage, id, { bytes, fileName: 'u1.png' }));
  for (const title of ['Activa', 'Archivada', 'Papelera']) {
    const cardId = value(await addCardToBoard(storage, id, { kind: 'note', title }));
    value(await editCardContent(storage, id, cardId, { content: `Antes\n\n![mapa](${ref})\n\nDespués` }));
    if (title === 'Archivada') value(await moveCardToArchive(storage, id, cardId, '2026-10-24T00:00:00Z'));
    if (title === 'Papelera') value(await moveCardToTrash(storage, id, cardId));
  }
  const pdf = value(await importLibraryFile(storage, storage, id, { bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), fileName: 'u1.pdf' }));
  value(await addDocumentToBoard(storage, id, { ref: pdf }));
  const snapshot = value(await storage.open(id));
  const before = JSON.stringify(snapshot);
  const open = vi.spyOn(storage, 'open');
  const save = vi.spyOn(storage, 'save');
  const list = vi.spyOn(storage, 'list');
  const remove = vi.spyOn(storage, 'removeAsset');
  const imageResult = analyzeAssetReferences({ workspace: snapshot, ref, unverified: ['Otras sesiones'] });
  expect(imageResult).toMatchObject({ status: 'partial', ownerCount: 3, occurrenceCount: 3 });
  expect(imageResult.owners.map((owner) => owner.collection)).toEqual(['active', 'archive', 'trash']);
  const pdfResult = analyzeAssetReferences({ workspace: snapshot, ref: pdf, unverified: [] });
  expect(pdfResult).toMatchObject({ status: 'complete-used', ownerCount: 1, occurrenceCount: 1 });
  expect(pdfResult.occurrences[0]?.kind).toBe('document-card');
  for (const spy of [open, save, list, remove]) expect(spy).not.toHaveBeenCalled();
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(JSON.stringify(value(await storage.open(id)))).toBe(before);
  expect(value(await storage.readAsset(id, ref as AssetRef))).toEqual(bytes);
});
