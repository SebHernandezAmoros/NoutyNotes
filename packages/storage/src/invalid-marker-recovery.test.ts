import { describe, expect, it, vi } from 'vitest';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { prepareInvalidMarkerCopy } from './invalid-marker-recovery';
import { serializeWorkspace } from './workspace-codec';
import type { WorkspaceDirectory } from './folder-storage';
import { readZip } from './zip';
import { ARCHIVE_LIMITS } from './workspace-archive';

const bytes = (text: string) => new TextEncoder().encode(text);

class Directory implements WorkspaceDirectory {
  readonly files = new Map<string, Uint8Array>();
  async listPaths() { return [...this.files.keys()]; }
  async read(path: string) { return this.files.get(path)?.slice(); }
  write = vi.fn(async () => { throw new Error('No debe escribir'); });
  remove = vi.fn(async () => { throw new Error('No debe borrar'); });
}

function fixture(marker = '{"version":1,"committed":fal'): Directory {
  const directory = new Directory();
  const serialized = serializeWorkspace(validWorkspace());
  if (!serialized.ok) throw new Error('Fixture inválido');
  for (const [path, text] of Object.entries(serialized.value)) directory.files.set(path, bytes(text));
  directory.files.set('assets/images/a.png', new Uint8Array([0, 255, 8]));
  directory.files.set('.nouty-transaction.json', bytes(marker));
  return directory;
}

describe('copia ante marcador inválido', () => {
  it('prepara una copia estructuralmente válida y conserva el marcador y Assets byte a byte sin escribir', async () => {
    const directory = fixture();
    const before = new Map([...directory.files].map(([path, value]) => [path, value.slice()]));
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status === 'candidate' ? result.status : result.reason).toBe('candidate');
    if (result.status !== 'candidate') return;
    const evidence = readZip(result.evidence, ARCHIVE_LIMITS);
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(evidence.value.find((entry) => entry.name === 'source/.nouty-transaction.json')?.bytes).toEqual(before.get('.nouty-transaction.json'));
      expect(evidence.value.find((entry) => entry.name === 'source/assets/images/a.png')?.bytes).toEqual(before.get('assets/images/a.png'));
    }
    expect(directory.files).toEqual(before);
    expect(directory.write).not.toHaveBeenCalled();
    expect(directory.remove).not.toHaveBeenCalled();
  });

  it('declina la copia editable ante un temporal ambiguo y conserva evidencia', async () => {
    const directory = fixture();
    directory.files.set('cards/idea-a.md.crswap', bytes('posible escritura'));
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('ambiguous-artifact');
    expect(result.evidence).toBeInstanceOf(Uint8Array);
    expect(directory.write).not.toHaveBeenCalled();
    expect(directory.remove).not.toHaveBeenCalled();
  });

  it('no reabre como editable un proyecto marcado como eliminado', async () => {
    const directory = fixture();
    directory.files.set('.nouty-deleted', bytes('deleted'));
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status === 'blocked' && result.reason).toBe('deleted-source');
    expect(result.evidence).toBeInstanceOf(Uint8Array);
  });

  it('bloquea una versión futura, aunque conserve la evidencia exacta', async () => {
    const directory = fixture('{"version":2,"committed":false,"old":{}}');
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toBe('incompatible-version');
    expect(result.evidence).toBeInstanceOf(Uint8Array);
  });

  it('bloquea cuando faltan documentos o un Asset referenciado', async () => {
    const missingDocument = fixture();
    missingDocument.files.delete('boards/overview.md');
    const badPackage = await prepareInvalidMarkerCopy(missingDocument);
    expect(badPackage.status === 'blocked' && badPackage.reason).toBe('invalid-workspace');
    const missingAsset = fixture();
    missingAsset.files.delete('assets/images/a.png');
    const badAsset = await prepareInvalidMarkerCopy(missingAsset);
    expect(badAsset.status === 'blocked' && badAsset.reason).toBe('missing-asset');
    expect(missingDocument.write).not.toHaveBeenCalled();
    expect(missingAsset.remove).not.toHaveBeenCalled();
  });

  it('declina un snapshot que cambia entre las dos lecturas', async () => {
    const directory = fixture();
    let reads = 0;
    const original = directory.read.bind(directory);
    vi.spyOn(directory, 'read').mockImplementation(async (path) => {
      if (path === '.nouty/workspace.yaml' && ++reads === 2) return bytes('cambio concurrente');
      return original(path);
    });
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status === 'blocked' && result.reason).toBe('snapshot-changed');
    expect(directory.write).not.toHaveBeenCalled();
  });

  it('informa evidencia parcial si un archivo no se puede leer, sin ofrecer edición', async () => {
    const directory = fixture();
    vi.spyOn(directory, 'read').mockImplementation(async (path) => {
      if (path === 'cards/idea-a.md') throw new Error('permiso revocado');
      return directory.files.get(path)?.slice();
    });
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status === 'blocked' && result.reason).toBe('read-failure');
    expect(result.status === 'blocked' && result.unreadableCount).toBe(1);
    expect(result.evidence).toBeInstanceOf(Uint8Array);
    if (result.evidence) {
      const unpacked = readZip(result.evidence, ARCHIVE_LIMITS);
      expect(unpacked.ok).toBe(true);
      if (unpacked.ok) expect(new TextDecoder().decode(unpacked.value.find((entry) => entry.name === 'diagnostic.json')?.bytes)).toContain('cards/idea-a.md');
    }
  });

  it('no permite edición cuando la evidencia excede los límites del ZIP', async () => {
    const directory = fixture();
    directory.files.set('assets/large.bin', new Uint8Array(ARCHIVE_LIMITS.maxEntryBytes + 1));
    const result = await prepareInvalidMarkerCopy(directory);
    expect(result.status === 'blocked' && result.reason).toBe('evidence-unavailable');
    expect(result.evidence).toBeUndefined();
    expect(directory.write).not.toHaveBeenCalled();
  });
});
