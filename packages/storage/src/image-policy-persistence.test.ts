import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { duplicateSelection, moveCardToArchive, moveCardToTrash, restoreCardFromArchive, restoreCardFromTrash } from '@noutynotes/application';
import { ideaA, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { ArchiveStorage, MemoryStorage, parseWorkspace, readWorkspaceArchive, serializeWorkspace } from './index';
import { htmlWorkspace } from './__fixtures__/html-workspace';
import { imagePolicyDocument, imagePolicyWorkspace } from './__fixtures__/image-policy-workspace';
import { valueOf } from './__fixtures__/helpers';

const source = imagePolicyWorkspace();
const boardId = validWorkspace().boards[0]!.id;
const assets = { 'assets/images/a.png': new Uint8Array([137, 80, 78, 71, 0, 255]) };

describe('N1: persistencia y compatibilidad de las políticas de imagen', () => {
  it('C08 guarda, reabre en otra instancia y mantiene envoltura de tarjeta v12 con HTML v2', async () => {
    const storage = new MemoryStorage();
    valueOf(await storage.create(source));
    valueOf(await storage.save({ ...source, metadata: { ...source.metadata, name: 'Guardado' } }));
    const files = valueOf(storage.exportPackage(source.id));
    expect(files['cards/idea-a.md']).toContain('schemaVersion: 12');
    expect(files['cards/idea-a.md']).toContain('contentVersion: 2');
    const reopened = valueOf(await valueOf(MemoryStorage.fromPackages({ demo: files })).open(source.id));
    expect(reopened.cards[0]?.contentDocument).toEqual(imagePolicyDocument);
    expect(reopened.cards[0]?.assetRefs).toEqual(source.cards[0]?.assetRefs);
  });

  it('C09 conserva contrato, identidad y contenido en Archivo/Papelera y sus restauraciones', async () => {
    const storage = new ArchiveStorage();
    valueOf(await storage.create(source));
    valueOf(await storage.writeAsset(source.id, source.cards[0]!.assetRefs![0]!, assets['assets/images/a.png']));
    valueOf(await moveCardToArchive(storage, source.id, ideaA.id, '2026-10-22T12:00:00Z'));
    let zip = valueOf(readWorkspaceArchive(valueOf(storage.exportArchive(source.id)).bytes));
    let files = zip.files;
    expect(files['.nouty/archive.yaml']).toContain('schemaVersion: 5');
    expect(valueOf(parseWorkspace(files)).archive?.[0]?.card.contentDocument).toEqual(imagePolicyDocument);
    expect(zip.workspace.archive?.[0]?.card.contentDocument).toEqual(imagePolicyDocument);
    expect(zip.assets).toEqual(assets);
    valueOf(await restoreCardFromArchive(storage, source.id, { cardId: ideaA.id, fallbackBoardId: boardId }));
    valueOf(await moveCardToTrash(storage, source.id, ideaA.id));
    zip = valueOf(readWorkspaceArchive(valueOf(storage.exportArchive(source.id)).bytes));
    files = zip.files;
    expect(files['.nouty/trash.yaml']).toContain('schemaVersion: 4');
    expect(valueOf(parseWorkspace(files)).trash?.[0]?.card.contentDocument).toEqual(imagePolicyDocument);
    expect(zip.workspace.trash?.[0]?.card.contentDocument).toEqual(imagePolicyDocument);
    expect(zip.assets).toEqual(assets);
    valueOf(await restoreCardFromTrash(storage, source.id, { cardId: ideaA.id, fallbackBoardId: boardId }));
    expect(valueOf(await storage.open(source.id)).cards.find((card) => card.id === ideaA.id)).toEqual(source.cards[0]);
  });

  it('C10/C11 duplicar y exportar/importar conserva políticas locales y un solo Asset compartido', async () => {
    const storage = new ArchiveStorage();
    valueOf(await storage.create(source));
    valueOf(await storage.writeAsset(source.id, source.cards[0]!.assetRefs![0]!, assets['assets/images/a.png']));
    valueOf(await duplicateSelection(storage, source.id, boardId, [ideaA.id]));
    const zip = valueOf(storage.exportArchive(source.id));
    const other = new ArchiveStorage();
    valueOf(await other.importArchive(zip.bytes));
    const reopened = valueOf(await other.open(source.id));
    expect(reopened.cards.filter((card) => card.contentDocument).map((card) => card.contentDocument)).toEqual([imagePolicyDocument, imagePolicyDocument]);
    expect(valueOf(readWorkspaceArchive(zip.bytes)).assets).toEqual(assets);
  });

  it('C01/C12 abrir y guardar históricos conserva bytes y ausencias sin promover a v2', async () => {
    const files = valueOf(serializeWorkspace(htmlWorkspace()));
    const storage = valueOf(MemoryStorage.fromPackages({ demo: files }));
    valueOf(await storage.save(valueOf(await storage.open(source.id))));
    expect(valueOf(storage.exportPackage(source.id))).toEqual(files);
    expect(files['cards/idea-a.md']).toContain('contentVersion: 1');
    expect(files['cards/idea-a.md']).not.toContain('image-caption-policy');
  });

  it.each(['archive', 'trash'] as const)('C07/C13 rechaza versión futura anidada en %s sin perder el snapshot', async (kind) => {
    const storage = new MemoryStorage();
    valueOf(await storage.create(source));
    valueOf(await (kind === 'archive' ? moveCardToArchive(storage, source.id, ideaA.id, '2026-10-22T12:00:00Z') : moveCardToTrash(storage, source.id, ideaA.id)));
    const workspace = valueOf(await storage.open(source.id));
    const files = valueOf(storage.exportPackage(source.id));
    const path = `.nouty/${kind}.yaml`;
    const text = files[path]!;
    // La envoltura mantiene v5/v4; solo el documento enriquecido interior pasa a una versión futura.
    const invalid = { ...files, [path]: text.replace('schemaVersion: 2', 'schemaVersion: 3') };
    expect(invalid[path]).not.toBe(text);
    expect(parseWorkspace(invalid).ok).toBe(false);
    expect(serializeWorkspace(workspace, invalid).ok).toBe(false);
    expect(valueOf(storage.exportPackage(source.id))).toEqual(files);
  });

  it.each(['future', 'unknown-intent'])('C07/C13 rechaza paquete previo e importación %s sin confirmar reemplazos', async (kind) => {
    const files = valueOf(serializeWorkspace(source));
    const body = files['cards/idea-a.md']!;
    const invalid = { ...files, 'cards/idea-a.md': kind === 'future'
      ? body.replace('contentVersion: 2', 'contentVersion: 3')
      : body.replace('accessibility-intent="pending"', 'accessibility-intent="unknown"') };
    const before = JSON.stringify(invalid);
    expect(serializeWorkspace(source, invalid).ok).toBe(false);
    expect(JSON.stringify(invalid)).toBe(before);
    const target = new ArchiveStorage();
    valueOf(await target.create(source));
    const snapshot = valueOf(target.exportArchive(source.id)).bytes;
    const corruptZip = zipSync(Object.fromEntries(Object.entries(invalid).map(([path, text]) => [path, strToU8(text)])));
    expect((await target.importArchive(corruptZip)).ok).toBe(false);
    expect(valueOf(target.exportArchive(source.id)).bytes).toEqual(snapshot);
    expect(valueOf(await target.open(source.id))).toEqual(source);
  });
});
