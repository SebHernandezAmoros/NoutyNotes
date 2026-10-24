import { describe, expect, it, vi } from 'vitest';
import { MemoryDraftPersistence, PersistentDraftStore, createDraftKey, draftRevision } from '../../packages/application/src/draft-store';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { FolderStorage } from '../../packages/storage/src/folder-storage';
import type { FolderPort, WorkspaceDirectory } from '../../packages/storage/src/folder-storage';
import { resolveResumeBoard, SessionResume } from '../../apps/noutynotes/src/session/sessionResume';
import type { ResumeIntent } from '../../apps/noutynotes/src/session/sessionResume';

async function fixture() {
  const source = validWorkspace();
  const files = new Map<string, Uint8Array>();
  const directory: WorkspaceDirectory = {
    listPaths: async () => [...files.keys()], read: async (path) => files.get(path)?.slice(),
    write: vi.fn(async (path, bytes) => { files.set(path, bytes.slice()); }),
    remove: vi.fn(async (path) => { files.delete(path); }),
  };
  const port: FolderPort = { permission: async () => true, folders: async () => [{ key: 'folder', folder: directory }], createFolder: vi.fn(async () => directory) };
  expect((await new FolderStorage(port).create(source)).ok).toBe(true);
  vi.mocked(directory.write).mockClear(); vi.mocked(directory.remove).mockClear(); vi.mocked(port.createFolder).mockClear();
  const intent: ResumeIntent = { version: 1, backend: 'web', folderId: 'web-a', workspaceId: source.id };
  const services = {
    loadHandle: vi.fn(async () => port), queryPermission: vi.fn(async () => 'granted'),
    prepare: async (candidatePort: FolderPort, target: ResumeIntent) => {
      const candidate = new FolderStorage(candidatePort, { readRecovery: 'defer' });
      const opened = await candidate.open(target.workspaceId as typeof source.id);
      return opened.ok ? { state: 'ready' as const, candidate }
        : { state: candidate.recoveryRequired ? 'recovery' as const : 'unavailable' as const };
    },
    activate: vi.fn(),
  };
  return { intent, source, port, files, directory, services, resume: new SessionResume(services) };
}

describe('F5 integración de sesión/carpeta y protección editorial', () => {
  it('INT-AB-01/02/04: después del permiso y apertura resuelve tablero o fallback, sin escrituras', async () => {
    const f = await fixture();
    const before = new Map(f.files);
    const selected = { ...f.intent, activeBoardId: f.source.boards[1]!.id };
    const applied: (string | null)[] = [];
    f.services.activate.mockImplementation(async (storage: FolderStorage, target: ResumeIntent) => {
      const opened = await storage.open(f.source.id);
      if (opened.ok) applied.push(resolveResumeBoard(target, f.intent, opened.value.boards));
    });
    f.services.queryPermission.mockResolvedValue('prompt');
    expect(await f.resume.start(selected)).toBe('permission');
    expect(applied).toEqual([]);
    expect(await f.resume.reconnect(async () => 'granted')).toBe('ready');
    await vi.waitFor(() => expect(applied).toEqual([f.source.boards[1]!.id]));
    f.services.queryPermission.mockResolvedValue('granted');
    expect(await f.resume.start({ ...selected, activeBoardId: 'no-longer-active' })).toBe('ready');
    await vi.waitFor(() => expect(applied).toEqual([f.source.boards[1]!.id, f.source.boards[0]!.id]));
    expect(f.files).toEqual(before);
    expect(f.directory.write).not.toHaveBeenCalled();
    expect(f.directory.remove).not.toHaveBeenCalled();
  });
  it('INT-01/05: activa el proyecto existente, sin escrituras ni confirmaciones de borrador', async () => {
    const f = await fixture();
    const persistence = new MemoryDraftPersistence();
    const drafts = new PersistentDraftStore(persistence, { now: () => '2026-10-23T12:00:00Z' });
    const key = createDraftKey(f.source.id, f.source.cards[0]!.id, 'body');
    expect((await drafts.save({ key, source: { format: 'html', value: '<p>Borrador protegido</p>' }, baseRevision: draftRevision('anterior'), validation: { status: 'valid' } })).ok).toBe(true);
    const beforeDrafts = await persistence.read();
    const beforeFiles = new Map(f.files);
    expect(await f.resume.start(f.intent)).toBe('ready');
    const candidate = f.services.activate.mock.calls[0]![0] as FolderStorage;
    expect(await candidate.open(f.source.id)).toEqual({ ok: true, value: f.source });
    expect(await persistence.read()).toBe(beforeDrafts);
    expect(f.files).toEqual(beforeFiles);
    expect(f.directory.write).not.toHaveBeenCalled();
    expect(f.directory.remove).not.toHaveBeenCalled();
    expect(f.port.createFolder).not.toHaveBeenCalled();
  });
  it('INT-02/03: prompt/denied no preparan la carpeta ni escriben; el gesto reintenta solo ese destino', async () => {
    const f = await fixture();
    f.services.queryPermission.mockResolvedValue('prompt');
    expect(await f.resume.start(f.intent)).toBe('permission');
    expect(await f.resume.reconnect(async () => 'denied')).toBe('permission');
    expect(f.services.activate).not.toHaveBeenCalled();
    expect(f.directory.write).not.toHaveBeenCalled();
    expect(await f.resume.reconnect(async () => 'granted')).toBe('ready');
    expect(f.services.activate.mock.calls[0]![1]).toEqual(f.intent);
  });
  it('INT-04: un journal pendiente detiene la reanudación; abrir explícitamente conserva recuperación', async () => {
    const f = await fixture();
    f.files.set('.nouty-transaction.json', new TextEncoder().encode(JSON.stringify({ version: 1, committed: false, old: {} })));
    const before = new Map(f.files);
    expect(await f.resume.start(f.intent)).toBe('recovery');
    expect(f.services.activate).not.toHaveBeenCalled();
    expect(f.files).toEqual(before);
    expect(f.directory.remove).not.toHaveBeenCalled();
    expect(f.directory.write).not.toHaveBeenCalled();
    expect((await new FolderStorage(f.port).open(f.source.id)).ok).toBe(true);
    expect(f.files.has('.nouty-transaction.json')).toBe(false);
  });
  it('proyecto inexistente nunca se crea como sustituto', async () => {
    const f = await fixture();
    expect(await f.resume.start({ ...f.intent, workspaceId: 'missing' })).toBe('unavailable');
    expect(f.services.activate).not.toHaveBeenCalled();
    expect(f.port.createFolder).not.toHaveBeenCalled();
    expect(f.directory.write).not.toHaveBeenCalled();
  });
});
