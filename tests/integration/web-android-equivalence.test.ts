import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { addCardToBoard, connectCards, editCardContent, moveCardOnBoard } from '../../packages/application/src/index';
import type { WorkspaceStorage, WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, CardId, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import {
  ArchiveStorage, DocumentTreeFolderPort, FolderStorage, readWorkspaceArchive, writeWorkspaceArchive,
} from '../../packages/storage/src/index';
import type { FolderPort, StorageResult, WorkspaceDirectory } from '../../packages/storage/src/index';

const id = (value: string) => value as WorkspaceId;
const decoder = new TextDecoder();

function ok<T>(result: WorkspaceStorageResult<T> | StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Mismo fixture v1 para todas las plataformas: editado a mano, con README, asset de texto y asset binario. */
function fixture(): Record<string, Uint8Array> {
  const root = fileURLToPath(new URL('../fixtures/workspace-v1-edited/', import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  const files: Record<string, Uint8Array> = {};
  for (const path of walk(root)) files[relative(root, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  files['assets/images/pixel.png'] = Uint8Array.from({ length: 300 }, (_, index) => (index * 37) % 256);
  return files;
}

/** Carpeta web (ADR 0010): el mismo FolderStorage que usa el navegador, sobre un puerto de rutas. */
class WebFolder implements WorkspaceDirectory {
  constructor(readonly files: Map<string, Uint8Array>) {}
  async listPaths() { return [...this.files.keys()]; }
  async read(path: string) { return this.files.get(path)?.slice(); }
  async write(path: string, bytes: Uint8Array) { this.files.set(path, bytes.slice()); }
  async remove(path: string) { this.files.delete(path); }
}
class WebPort implements FolderPort {
  constructor(readonly folder: WebFolder) {}
  async permission() { return true; }
  async folders() { return [{ key: 'demo', folder: this.folder }]; }
  async createFolder(): Promise<WorkspaceDirectory> { throw new Error('No se usa en esta prueba.'); }
}

async function applySameEdits(storage: WorkspaceStorage): Promise<CardId> {
  const cardId = ok(await addCardToBoard(storage, id('demo'), { kind: 'note' }));
  ok(await editCardContent(storage, id('demo'), cardId, { title: 'Desde cualquier plataforma', content: '## Markdown\r\n\n- [x] igual\n' }));
  ok(await moveCardOnBoard(storage, id('demo'), { boardId: 'overview' as BoardId, cardId, to: { x: 0, y: 6 } }));
  ok(await connectCards(storage, id('demo'), { from: cardId, to: 'idea-b' as CardId }));
  return cardId;
}

const textsOf = (files: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(files)
  .filter(([path]) => !path.startsWith('assets/')).map(([path, bytes]) => [path, decoder.decode(bytes)]));
const assetsOf = (files: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('assets/')));

describe('mismo fixture v1 en web y Android produce datos equivalentes (fase 10)', () => {
  it('abrir, editar y guardar da el mismo workspace y los mismos bytes en Android, carpeta web y ZIP web', async () => {
    const source = fixture();

    const tree = new MemoryDocumentTree();
    for (const [path, bytes] of Object.entries(source)) tree.put(`demo/${path}`, bytes);
    const android = new FolderStorage(new DocumentTreeFolderPort(tree));

    const webFiles = new Map(Object.entries(source));
    const web = new FolderStorage(new WebPort(new WebFolder(webFiles)));

    const zip = new ArchiveStorage();
    const texts = Object.fromEntries(Object.entries(source).filter(([path]) => !path.startsWith('assets/')).map(([path, bytes]) => [path, decoder.decode(bytes)]));
    ok(await zip.importArchive(ok(writeWorkspaceArchive(texts, assetsOf(source)))));

    // Abrir: los tres ven el mismo workspace.
    const opened = ok(await android.open(id('demo')));
    expect(ok(await web.open(id('demo')))).toEqual(opened);
    expect(ok(await zip.open(id('demo')))).toEqual(opened);

    // Editar con los mismos casos de uso.
    for (const storage of [android, web, zip]) expect(await applySameEdits(storage)).toBe('tarjeta-1');

    // Reabrir en sesiones nuevas: mismo workspace.
    const androidAfter = ok(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id('demo')));
    expect(ok(await new FolderStorage(new WebPort(new WebFolder(webFiles))).open(id('demo')))).toEqual(androidAfter);
    expect(ok(await zip.open(id('demo')))).toEqual(androidAfter);
    expect(androidAfter.cards.find((card) => card.id === 'tarjeta-1')).toMatchObject({ title: 'Desde cualquier plataforma', content: '## Markdown\r\n\n- [x] igual\n' });
    expect(androidAfter.relations.some((relation) => relation.from === 'tarjeta-1' && relation.to === 'idea-b')).toBe(true);
    expect(androidAfter.layouts[0]?.placements.find((placement) => placement.cardId === 'tarjeta-1')?.rect).toMatchObject({ x: 0, y: 6 });

    // Mismos bytes: Android y carpeta web idénticos; el ZIP exportado contiene los mismos textos y assets.
    const androidFiles = Object.fromEntries(Object.entries(tree.snapshot())
      .filter(([path]) => path.startsWith('demo/')).map(([path, bytes]) => [path.slice('demo/'.length), bytes]));
    expect(androidFiles).toEqual(Object.fromEntries(webFiles));
    const exported = ok(readWorkspaceArchive(ok(zip.exportArchive(id('demo'))).bytes));
    expect(exported.files).toEqual(textsOf(androidFiles));
    expect(exported.assets).toEqual(assetsOf(androidFiles));
    // Los assets y los documentos no editados conservan exactamente sus bytes de origen.
    expect(assetsOf(androidFiles)).toEqual(assetsOf(source));
    expect(androidFiles['cards/idea-a.md']).toEqual(source['cards/idea-a.md']);
    expect(androidFiles['README.md']).toEqual(source['README.md']);
  });
});
