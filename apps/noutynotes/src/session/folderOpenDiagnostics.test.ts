import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveStorage } from '@noutynotes/storage';
import { chooseFolder, reopenHandle } from './folderAccess';
import { chooseFolderInto } from './folderSession';
import { captureFolderContext, describeFolderOpenFailure, folderDiagnostic } from './folderOpenDiagnostics';
import type { BrowserDirectory } from './folderAccess';
import type { WorkspaceStorage } from '@noutynotes/application';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
afterEach(() => vi.unstubAllGlobals());

it('AbortError del selector web no afirma una cancelación y conserva diagnóstico sin datos de carpeta', async () => {
  vi.stubGlobal('showDirectoryPicker', vi.fn(async () => { throw new DOMException('private-folder-name', 'AbortError'); }));
  const state = { storage: new ArchiveStorage(), mode: 'memory' as const, saved: null };
  const memory = { remember: vi.fn(), forget: vi.fn() };
  const result = await chooseFolderInto(state, async () => {
    const picked = await chooseFolder();
    return picked ? { storage: picked.storage, folder: null } : null;
  }, memory);
  expect(result.result).toMatchObject({ ok: false, diagnostic: { stage: 'picker', exception: 'AbortError', handleObtained: false, outcome: 'aborted' } });
  expect(JSON.stringify(result.result)).not.toContain('private-folder-name');
  expect(result.result).not.toMatchObject({ message: 'No se seleccionó ninguna carpeta.' });
  expect(result.state).toBe(state);
  expect(memory.remember).not.toHaveBeenCalled();
});

it.each([['SecurityError', 'security'], ['NotAllowedError', 'denied'], ['TypeError', 'technical']] as const)('clasifica %s sin confundirlo con cancelar', async (name, outcome) => {
  vi.stubGlobal('showDirectoryPicker', async () => { throw new DOMException('sensitive/path', name); });
  const state = { storage: new ArchiveStorage(), mode: 'memory' as const, saved: null };
  const result = await chooseFolderInto(state, async () => { await chooseFolder(); return null; }, { remember: vi.fn(), forget: vi.fn() });
  expect(result.result).toMatchObject({ ok: false, diagnostic: { outcome, stage: 'picker', handleObtained: false, exception: name } });
  expect(JSON.stringify(result.result)).not.toContain('sensitive/path');
  expect(result.state).toBe(state);
});

it.each(['invalid-stored-data', 'permission-denied', 'io-failure'] as const)('handle elegido y validación %s conserva sesión y diferencia la fase', async (code) => {
  const diagnostic = folderDiagnostic(captureFolderContext(), 'validation', null);
  const state = { storage: new ArchiveStorage(), mode: 'memory' as const, saved: null };
  const save = vi.fn(); const memory = { remember: vi.fn(), forget: vi.fn() };
  const storage = { list: async () => ({ ok: false, issues: [{ code, path: 'private/path', message: 'private detail' }] }), save } as unknown as WorkspaceStorage;
  const result = await chooseFolderInto(state, async () => ({ storage, folder: null, diagnostic }), memory);
  expect(result.result).toMatchObject({ ok: false, diagnostic: { stage: 'validation', handleObtained: true, outcome: code === 'permission-denied' ? 'denied' : code === 'invalid-stored-data' ? 'invalid' : 'technical' } });
  expect(result.state).toBe(state); expect(save).not.toHaveBeenCalled(); expect(memory.remember).not.toHaveBeenCalled();
  if (!result.result.ok) expect(describeFolderOpenFailure(result.result, 'en')).not.toContain('private');
});

it('AbortError después de obtener handle es fallo de lectura, no cancelación del selector', async () => {
  const state = { storage: new ArchiveStorage(), mode: 'memory' as const, saved: null };
  const storage = { list: async () => { throw new DOMException('private detail', 'AbortError'); } } as unknown as WorkspaceStorage;
  const result = await chooseFolderInto(state, async () => ({ storage, folder: null, diagnostic: folderDiagnostic(captureFolderContext(), 'validation', null) }), { remember: vi.fn(), forget: vi.fn() });
  expect(result.result).toMatchObject({ ok: false, diagnostic: { stage: 'validation', outcome: 'technical', exception: 'AbortError', handleObtained: true } });
});

it('invoca el picker inmediatamente y conserva exactamente el handle; reconexión solicita permiso solo si hace falta', async () => {
  const root = { name: 'lab', kind: 'directory', queryPermission: vi.fn(async () => 'prompt'), requestPermission: vi.fn(async () => 'denied') } as unknown as BrowserDirectory;
  const picker = vi.fn(async () => root); vi.stubGlobal('showDirectoryPicker', picker);
  const promise = chooseFolder();
  expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
  expect((await promise)?.handle).toBe(root);
  expect(await reopenHandle(root)).toEqual({ ok: false, reason: 'denied' });
  vi.mocked(root.queryPermission).mockResolvedValue('granted');
  expect(await reopenHandle(root)).toMatchObject({ ok: true, name: 'lab' });
  expect(root.requestPermission).toHaveBeenCalledTimes(1);
});
