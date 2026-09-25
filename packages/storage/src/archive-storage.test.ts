import { describe, expect, it } from 'vitest';

import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { valueOf } from './__fixtures__/helpers';
import { text } from './__fixtures__/zip';
import { ArchiveStorage } from './archive-storage';
import { readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import { serializeWorkspace } from './workspace-codec';

const id = (value: string) => value as WorkspaceId;
const binary = Uint8Array.from({ length: 256 }, (_, index) => 255 - index);
const readme = '# Demo\r\n\nComentario manual.\n';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function codes(result: WorkspaceStorageResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

/** ZIP de otro navegador: paquete v1 con README y un asset binario. */
function demoZip(workspace: Workspace = validWorkspace()): Uint8Array {
  const files = { ...valueOf(serializeWorkspace(workspace)), 'README.md': readme };
  return valueOf(writeWorkspaceArchive(files, { 'assets/images/a.png': binary }));
}

describe('ArchiveStorage: importar, editar y exportar (fase 9)', () => {
  it('importa un ZIP, lo abre como workspace y lo exporta sin perder README ni assets', async () => {
    const storage = new ArchiveStorage();
    expect(ok(await storage.importArchive(demoZip()))).toEqual({ summary: { id: 'demo', name: 'Demo' } });
    expect(ok(await storage.open(id('demo')))).toEqual(validWorkspace());
    const exported = ok(storage.exportArchive(id('demo')));
    expect(exported.fileName).toBe('demo.zip');
    const archive = valueOf(readWorkspaceArchive(exported.bytes));
    expect(archive.files['README.md']).toBe(readme);
    expect(archive.assets).toEqual({ 'assets/images/a.png': binary });
    expect(archive.workspace).toEqual(validWorkspace());
  });

  it('las ediciones se guardan con el formato v1 y se exportan conservando lo demás', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.importArchive(demoZip()));
    const edited: Workspace = { ...validWorkspace(), metadata: { name: 'Demo editado' } };
    ok(await storage.save(edited));
    const archive = valueOf(readWorkspaceArchive(ok(storage.exportArchive(id('demo'))).bytes));
    expect(archive.workspace).toEqual(edited);
    expect(archive.files['README.md']).toBe(readme);
    expect(archive.assets['assets/images/a.png']).toEqual(binary);
  });

  it('nunca sobrescribe: un ID repetido se importa como copia con el primer ID libre', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.importArchive(demoZip()));
    ok(await storage.save({ ...validWorkspace(), metadata: { name: 'Original modificado' } }));
    expect(ok(await storage.importArchive(demoZip()))).toEqual({ summary: { id: 'demo-2', name: 'Demo' }, renamedFrom: 'demo' });
    expect(ok(await storage.importArchive(demoZip()))).toEqual({ summary: { id: 'demo-3', name: 'Demo' }, renamedFrom: 'demo' });
    expect(ok(await storage.open(id('demo'))).metadata.name).toBe('Original modificado');
    const copy = valueOf(readWorkspaceArchive(ok(storage.exportArchive(id('demo-2'))).bytes));
    expect(copy.workspace.id).toBe('demo-2');
    expect(copy.files['README.md']).toBe(readme);
    expect(copy.assets['assets/images/a.png']).toEqual(binary);
  });

  it('una importación inválida no cambia nada y devuelve los motivos', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.importArchive(demoZip()));
    const before = ok(storage.exportArchive(id('demo'))).bytes;
    const invalid = await storage.importArchive(text('no es un zip'));
    expect(codes(invalid)).toEqual(['invalid-workspace@archivo']);
    expect(invalid.ok ? [] : invalid.issues[0]?.details?.map(({ code }) => code)).toEqual(['invalid-archive']);
    expect(ok(await storage.list())).toEqual([{ id: 'demo', name: 'Demo' }]);
    expect(ok(storage.exportArchive(id('demo'))).bytes).toEqual(before);
    expect(storage.unexportedIds()).toEqual([]);
  });

  it('registra los cambios sin exportar y avisa a los suscriptores', async () => {
    const storage = new ArchiveStorage();
    const events: string[][] = [];
    const unsubscribe = storage.subscribe(() => events.push([...storage.unexportedIds()]));
    ok(await storage.importArchive(demoZip()));
    expect(storage.hasUnexportedChanges(id('demo'))).toBe(false);
    ok(await storage.save({ ...validWorkspace(), metadata: { name: 'Cambio' } }));
    expect(storage.unexportedIds()).toEqual(['demo']);
    ok(await storage.create({ ...validWorkspace(), id: id('nuevo'), metadata: { name: 'Nuevo' } }));
    expect(storage.unexportedIds()).toEqual(['demo', 'nuevo']);
    const exported = ok(storage.exportArchive(id('demo')));
    expect(storage.unexportedIds()).toEqual(['demo', 'nuevo']);
    expect(ok(storage.confirmExported(id('demo'), exported.revision))).toBe('confirmed');
    expect(storage.unexportedIds()).toEqual(['nuevo']);
    ok(await storage.rename(id('nuevo'), id('renombrado')));
    expect(storage.unexportedIds()).toEqual(['renombrado']);
    ok(await storage.delete(id('renombrado')));
    expect(storage.unexportedIds()).toEqual([]);
    unsubscribe();
    ok(await storage.save({ ...validWorkspace(), metadata: { name: 'Sin oyentes' } }));
    expect(events).toEqual([[], ['demo'], ['demo', 'nuevo'], ['nuevo'], ['renombrado'], []]);
  });

  it('exportar solo prepara los bytes: el espacio sigue pendiente hasta confirmar que se guardó (auditoría de fase 9)', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.create({ ...validWorkspace(), id: id('nuevo'), metadata: { name: 'Nuevo' } }));
    let notified = 0;
    storage.subscribe(() => { notified += 1; });
    const exported = ok(storage.exportArchive(id('nuevo')));
    // Si la descarga falla o se cancela, no se confirma nada: sigue pendiente.
    expect(storage.hasUnexportedChanges(id('nuevo'))).toBe(true);
    expect(notified).toBe(0);
    expect(ok(storage.confirmExported(id('nuevo'), exported.revision))).toBe('confirmed');
    expect(storage.hasUnexportedChanges(id('nuevo'))).toBe(false);
    expect(notified).toBe(1);
  });

  it('una edición posterior a la exportación no queda marcada como exportada por una confirmación anterior', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.importArchive(demoZip()));
    ok(await storage.save({ ...validWorkspace(), metadata: { name: 'Antes de exportar' } }));
    const stale = ok(storage.exportArchive(id('demo')));
    ok(await storage.save({ ...validWorkspace(), metadata: { name: 'Después de exportar' } }));
    expect(ok(storage.confirmExported(id('demo'), stale.revision))).toBe('changed-since-export');
    expect(storage.hasUnexportedChanges(id('demo'))).toBe(true);
    // Exportar de nuevo y confirmar esa revisión sí conserva el estado actual.
    const fresh = ok(storage.exportArchive(id('demo')));
    expect(fresh.revision).not.toBe(stale.revision);
    expect(valueOf(readWorkspaceArchive(fresh.bytes)).workspace.metadata.name).toBe('Después de exportar');
    expect(ok(storage.confirmExported(id('demo'), fresh.revision))).toBe('confirmed');
    expect(storage.hasUnexportedChanges(id('demo'))).toBe(false);
  });

  it('confirmar una exportación de un ID ausente o inválido falla sin cambiar nada', async () => {
    const storage = new ArchiveStorage();
    expect(codes(storage.confirmExported(id('ghost'), 0))).toEqual(['workspace-not-found@id']);
    expect(codes(storage.confirmExported(id('Mal ID'), 0))).toEqual(['invalid-workspace-id@id']);
  });

  it('una copia renombrada queda pendiente de exportar; exportar un ID ausente falla', async () => {
    const storage = new ArchiveStorage();
    ok(await storage.importArchive(demoZip()));
    ok(await storage.importArchive(demoZip()));
    expect(storage.unexportedIds()).toEqual(['demo-2']);
    expect(codes(storage.exportArchive(id('ghost')))).toEqual(['workspace-not-found@id']);
    expect(codes(storage.exportArchive(id('Mal ID')))).toEqual(['invalid-workspace-id@id']);
  });

  it('los assets importados no comparten memoria con quien llamó ni con lo exportado', async () => {
    const storage = new ArchiveStorage();
    const zip = demoZip();
    ok(await storage.importArchive(zip));
    zip.fill(0);
    const first = valueOf(readWorkspaceArchive(ok(storage.exportArchive(id('demo'))).bytes));
    (first.assets['assets/images/a.png'] as Uint8Array).fill(7);
    const second = valueOf(readWorkspaceArchive(ok(storage.exportArchive(id('demo'))).bytes));
    expect(second.assets['assets/images/a.png']).toEqual(binary);
  });
});
