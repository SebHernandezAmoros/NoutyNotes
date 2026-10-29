import { describe, expect, it } from 'vitest';

import { ArchiveStorage } from '@noutynotes/storage';
import type { WorkspaceStorage } from '@noutynotes/application';

import { createProjectAtTarget } from './projectCreation';

describe('creación segura desde Inicio', () => {
  it('no crea en memoria cuando el destino local todavía no está autorizado', async () => {
    const storage = new ArchiveStorage();
    const result = await createProjectAtTarget({ name: 'Local pendiente',
      target: { kind: 'local-pending', storage } as never,
      activate: async () => ({ ok: true, folderId: 'never' }),
    });
    expect(result).toMatchObject({ ok: false, stage: 'validation', reason: 'destination' });
    expect(await storage.list()).toMatchObject({ ok: true, value: [] });
  });
  it('crea en el destino pendiente antes de activarlo', async () => {
    const target = new ArchiveStorage();
    const order: string[] = [];
    const result = await createProjectAtTarget({
      name: 'Proyecto destino',
      target: { kind: 'selected-web-folder', storage: target, folderName: 'DESTINO', handle: {} as never },
      activate: async () => { order.push('activate'); return { ok: true, folderId: 'folder-1' }; },
      beforeActivate: () => { order.push('created'); },
    });

    expect(result).toMatchObject({ ok: true, backend: 'web', folderId: 'folder-1' });
    expect(order).toEqual(['created', 'activate']);
    const listed = await target.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it('informa una creación parcial sin activar ni volver a crear el proyecto', async () => {
    const target = new ArchiveStorage();
    const first = await createProjectAtTarget({
      name: 'Proyecto recuperable',
      target: { kind: 'selected-web-folder', storage: target, folderName: 'DESTINO', handle: {} as never },
      activate: async () => ({ ok: false, message: 'Permiso perdido' }),
    });
    expect(first).toMatchObject({ ok: false, stage: 'activate', created: { name: 'Proyecto recuperable' } });

    const listed = await target.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it('rechaza un nombre vacío antes de escribir', async () => {
    const target = new ArchiveStorage();
    const result = await createProjectAtTarget({
      name: '   ',
      target: { kind: 'current', storage: target, backend: 'memory', folderId: null, folderName: 'Sesión' },
      activate: async () => ({ ok: true, folderId: 'unused' }),
    });
    expect(result).toEqual({ ok: false, stage: 'validation', reason: 'required' });
    const listed = await target.list();
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it('rechaza caracteres de control antes de escribir', async () => {
    const target = new ArchiveStorage();
    const result = await createProjectAtTarget({
      name: 'Nombre\u0000inválido',
      target: { kind: 'current', storage: target, backend: 'memory', folderId: null, folderName: 'Sesión' },
      activate: async () => ({ ok: true, folderId: 'unused' }),
    });
    expect(result).toEqual({ ok: false, stage: 'validation', reason: 'invalid' });
  });

  it('expone el fallo de escritura sin activar la carpeta ni registrar un éxito', async () => {
    let activated = false;
    const failing = {
      list: async () => ({ ok: false, issues: [{ code: 'permission-denied', path: 'root', message: 'Sin permiso' }] }),
    } as unknown as WorkspaceStorage;
    const result = await createProjectAtTarget({
      name: 'Proyecto bloqueado',
      target: { kind: 'selected-web-folder', storage: failing, folderName: 'BLOQUEADA', handle: {} as never },
      activate: async () => { activated = true; return { ok: true, folderId: 'unused' }; },
    });
    expect(result).toMatchObject({ ok: false, stage: 'create', issues: [{ code: 'permission-denied' }] });
    expect(activated).toBe(false);
  });
});
