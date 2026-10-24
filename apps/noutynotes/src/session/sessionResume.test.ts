import { describe, expect, it, vi } from 'vitest';

import { parseResumeIntent, SessionResume } from './sessionResume';
import type { PreparedResume, ResumeIntent } from './sessionResume';
import { isReload, readResumeIntent, writeResumeIntent } from './sessionResumeStore';

const intent: ResumeIntent = { version: 1, backend: 'web', folderId: 'web-folder-a', workspaceId: 'project-a' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
function fixture(permission = 'granted') {
  const services = {
    loadHandle: vi.fn(async (_id: string) => ({ name: 'same-name' })),
    queryPermission: vi.fn(async () => permission),
    prepare: vi.fn(async (_handle: { name: string }, target: ResumeIntent): Promise<PreparedResume<string>> => ({ state: 'ready', candidate: target.workspaceId })),
    activate: vi.fn(),
  };
  return { services, resume: new SessionResume(services) };
}

describe('F5: intención y coordinación localizada', () => {
  it('valida backend/versión/identificadores y guarda solo la identidad mínima', () => {
    expect(parseResumeIntent(JSON.stringify({ ...intent, name: 'no persistir', granted: true }))).toEqual(intent);
    for (const value of [null, '{', JSON.stringify({ ...intent, backend: 'unknown' }), JSON.stringify({ ...intent, version: 9 }), JSON.stringify({ ...intent, folderId: '../another' })]) {
      expect(parseResumeIntent(value)).toBeNull();
    }
  });
  it('prepara identidad exacta antes de activar; no solicita permisos implícitos', async () => {
    const { resume, services } = fixture();
    expect(await resume.start(intent)).toBe('ready');
    expect(services.loadHandle).toHaveBeenCalledWith(intent.folderId);
    expect(services.activate).toHaveBeenCalledExactlyOnceWith('project-a', intent);
  });
  it('prompt/denied requieren acción y conservan el mismo destino; cancelar evita activación tardía', async () => {
    const { resume, services } = fixture('prompt');
    const request = vi.fn(async () => 'denied');
    expect(await resume.start(intent)).toBe('permission');
    expect(request).not.toHaveBeenCalled();
    expect(await resume.reconnect(request)).toBe('permission');
    expect(services.prepare).not.toHaveBeenCalled();
    const pending = deferred<string>();
    const reconnecting = resume.reconnect(() => pending.promise);
    resume.cancel();
    pending.resolve('granted');
    expect(await reconnecting).toBe('idle');
    expect(services.activate).not.toHaveBeenCalled();
  });
  it('cambiar de A a B descarta el candidato A que termina tarde', async () => {
    const { resume, services } = fixture();
    const old = deferred<PreparedResume<string>>();
    services.prepare.mockImplementationOnce(() => old.promise);
    const first = resume.start(intent);
    await vi.waitFor(() => expect(services.prepare).toHaveBeenCalledTimes(1));
    const second = { ...intent, workspaceId: 'project-b' };
    expect(await resume.start(second)).toBe('ready');
    old.resolve({ state: 'ready', candidate: 'project-a' });
    expect(await first).toBe('idle');
    expect(services.activate).toHaveBeenCalledExactlyOnceWith('project-b', second);
  });
  it('cierre/cancelación durante carga de handle no prepara ni activa', async () => {
    const { resume, services } = fixture();
    const loading = deferred<{ name: string }>();
    services.loadHandle.mockImplementationOnce(() => loading.promise);
    const pending = resume.start(intent);
    resume.cancel();
    loading.resolve({ name: 'same-name' });
    expect(await pending).toBe('idle');
    expect(services.prepare).not.toHaveBeenCalled();
    expect(services.activate).not.toHaveBeenCalled();
  });
  it('fallo de acceso/proyecto y transacción pendiente nunca activan candidatos', async () => {
    const { resume, services } = fixture();
    services.loadHandle.mockRejectedValueOnce(new Error('unavailable'));
    expect(await resume.start(intent)).toBe('unavailable');
    services.prepare.mockResolvedValueOnce({ state: 'unavailable' });
    expect(await resume.start(intent)).toBe('unavailable');
    services.prepare.mockResolvedValueOnce({ state: 'recovery' });
    expect(await resume.start(intent)).toBe('recovery');
    expect(services.activate).not.toHaveBeenCalled();
  });
  it('sessionStorage separa pestañas y cierre; registro corrupto/bloqueado degrada sin selección global', () => {
    const tab = () => {
      const entries = new Map<string, string>();
      return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) };
    };
    const a = tab(); const b = tab();
    try {
      vi.stubGlobal('sessionStorage', a); writeResumeIntent(intent);
      vi.stubGlobal('sessionStorage', b); expect(readResumeIntent()).toBeNull();
      writeResumeIntent({ ...intent, workspaceId: 'project-b' });
      vi.stubGlobal('sessionStorage', a); expect(readResumeIntent()).toEqual(intent);
      writeResumeIntent(null); expect(readResumeIntent()).toBeNull();
      a.setItem('noutynotes.session-resume.v1', '{'); expect(readResumeIntent()).toBeNull();
      vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); } });
      expect(readResumeIntent()).toBeNull(); expect(() => writeResumeIntent(intent)).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
  it('solo reload es señal de reanudación; opener/navigate y back_forward no lo son', () => {
    try {
      for (const type of ['navigate', 'back_forward', 'reload']) {
        vi.stubGlobal('performance', { getEntriesByType: () => [{ type }] });
        expect(isReload()).toBe(type === 'reload');
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('la selección de arranque descarta copia de opener/identidad obsoleta y permite reinicio de efecto sin reabrir tras cierre', () => {
    const inherited = fixture().resume;
    expect(inherited.claimReload(intent, intent.workspaceId, false, true)).toEqual({ target: null, discard: true });
    expect(inherited.claimReload(intent, intent.workspaceId, true, true).target).toBeNull();
    expect(fixture().resume.claimReload(intent, 'another-project', true, true).target).toBeNull();
    expect(fixture().resume.claimReload(intent, intent.workspaceId, true, false).target).toBeNull();
    const live = fixture().resume;
    expect(live.claimReload(intent, intent.workspaceId, true, true).target).toEqual(intent);
    live.cancel(); // limpieza/repetición de efecto, sin cierre explícito
    expect(live.claimReload(intent, intent.workspaceId, true, true).target).toEqual(intent);
    live.abandon();
    expect(live.claimReload(intent, intent.workspaceId, true, true).target).toBeNull();
  });
});
