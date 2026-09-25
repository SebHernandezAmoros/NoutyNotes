import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { moveCardOnBoard } from '../../packages/application/src/index';
import type { BoardId, CardId, WorkspaceId } from '../../packages/domain/src/index';
import { DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { describe, expect, it } from 'vitest';

import { SafTree } from '../../apps/noutynotes/src/session/safTree';
import type { SafApi } from '../../apps/noutynotes/src/session/safTree';

/** SAF simulado que cuenta los listados: en el dispositivo cada uno cuesta una consulta por hijo. */
interface Dir { kind: 'dir'; uri: string; children: Map<string, Dir | Doc> }
interface Doc { kind: 'file'; uri: string; bytes: Uint8Array }

function countingSaf() {
  let counter = 0;
  const stats = { listings: 0 };
  const api: SafApi<Dir, Doc> = {
    exists: () => true,
    children(dir) {
      stats.listings += 1;
      return { names: [...dir.children.keys()], entries: [...dir.children.values()] };
    },
    isDirectory: (entry): entry is Dir => entry.kind === 'dir',
    uriOf: (entry) => entry.uri,
    createDirectory(dir, name) {
      const created: Dir = { kind: 'dir', uri: `content://doc/${(counter += 1)}`, children: new Map() };
      dir.children.set(name, created);
      return created;
    },
    createFile(dir, name) {
      const created: Doc = { kind: 'file', uri: `content://doc/${(counter += 1)}`, bytes: new Uint8Array() };
      dir.children.set(name, created);
      return created;
    },
    readBytes: async (file) => file.bytes.slice(),
    writeTruncating(file, bytes) { file.bytes = bytes.slice(); },
    deleteFile(file) {
      for (const dir of all) for (const [name, child] of dir.children) if (child === file) dir.children.delete(name);
    },
  };
  const root: Dir = { kind: 'dir', uri: 'content://tree/root', children: new Map() };
  const all: Dir[] = [root];
  const put = (path: string, bytes: Uint8Array) => {
    const segments = path.split('/');
    const name = segments.pop() as string;
    let dir = root;
    for (const segment of segments) {
      let next = dir.children.get(segment);
      if (!next) {
        next = { kind: 'dir', uri: `content://doc/${(counter += 1)}`, children: new Map() };
        dir.children.set(segment, next);
        all.push(next);
      }
      dir = next as Dir;
    }
    dir.children.set(name, { kind: 'file', uri: `content://doc/${(counter += 1)}`, bytes: bytes.slice() });
  };
  return { api, root, stats, put, all };
}

function fixture(): Record<string, Uint8Array> {
  const root = fileURLToPath(new URL('../fixtures/workspace-v1-edited/', import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  const files: Record<string, Uint8Array> = {};
  for (const path of walk(root)) files[relative(root, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  return files;
}

describe('coste del árbol SAF (fase 10, guardado lento en el emulador)', () => {
  it('abrir y mover una tarjeta lista cada carpeta como mucho una vez por operación de almacenamiento', async () => {
    const saf = countingSaf();
    for (const [path, bytes] of Object.entries(fixture())) saf.put(`demo/${path}`, bytes);
    const storage = new FolderStorage(new DocumentTreeFolderPort(new SafTree(saf.api, saf.root)));
    // Cada operación lista una vez cada carpeta; la raíz y el paquete, dos: antes de listarlos se
    // comprueba si la raíz es un paquete y si hay una recuperación pendiente (entries() siempre relista).
    const perOperation = saf.all.length + 2;

    saf.stats.listings = 0;
    const opened = await storage.open('demo' as WorkspaceId);
    expect(opened.ok).toBe(true);
    expect(saf.stats.listings).toBeLessThanOrEqual(perOperation);

    saf.stats.listings = 0;
    const moved = await moveCardOnBoard(storage, 'demo' as WorkspaceId, { boardId: 'overview' as BoardId, cardId: 'idea-a' as CardId, to: { x: 0, y: 6 } });
    expect(moved).toMatchObject({ ok: true });
    // moveCardOnBoard abre y guarda (2 operaciones). Crear el marcador de transacción cuesta 2 más: el
    // nombre no está en el listado guardado (se relista por si apareció fuera) y se verifica al crearlo.
    expect(saf.stats.listings).toBeLessThanOrEqual(2 * perOperation + 2);
  });
});
