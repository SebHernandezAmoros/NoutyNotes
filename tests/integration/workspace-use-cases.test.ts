import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createEmptyWorkspace, createWorkspaceFromTemplate, modifyWorkspace } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { ideaA, ideaB, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { assertValid, deleteCard, importTemplate, instantiateTemplate, moveCard } from '../../packages/domain/src/index';
import type { BoardLayout, Template, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryStorage, parseWorkspace } from '../../packages/storage/src/index';
import type { StorageResult, TextFiles } from '../../packages/storage/src/index';

const id = (value: string) => value as WorkspaceId;

function ok<T>(result: WorkspaceStorageResult<T> | StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function codes(result: WorkspaceStorageResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

function readPackage(name: string): TextFiles {
  const root = fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));
  const walk = (directory: string): [string, string][] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [[relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]];
  });
  return Object.fromEntries(walk(root));
}

const template = (name: string): Template =>
  assertValid(importTemplate(readFileSync(new URL(`../fixtures/templates/${name}.json`, import.meta.url), 'utf8')));

describe('crear un workspace vacío', () => {
  it('guarda un workspace válido sin tarjetas y solo sus documentos administrados', async () => {
    const storage = new MemoryStorage();
    expect(ok(await createEmptyWorkspace(storage, { id: id('ideas'), name: 'Ideas' }))).toEqual({ id: 'ideas', name: 'Ideas' });
    expect(ok(await storage.open(id('ideas')))).toEqual({
      schemaVersion: 1, id: 'ideas', metadata: { name: 'Ideas' },
      cardTypes: [], relationTypes: [], cards: [], boards: [], layouts: [], relations: [],
    });
    expect(Object.keys(ok(storage.exportPackage(id('ideas'))))).toEqual(['.nouty/layout.yaml', '.nouty/relations.yaml', '.nouty/workspace.yaml']);
  });

  it('rechaza IDs inválidos o repetidos y nombres vacíos sin guardar nada', async () => {
    const storage = new MemoryStorage();
    ok(await createEmptyWorkspace(storage, { id: id('ideas'), name: 'Ideas' }));
    expect(codes(await createEmptyWorkspace(storage, { id: id('ideas'), name: 'Otra' }))).toEqual(['workspace-already-exists@workspace']);
    expect(codes(await createEmptyWorkspace(storage, { id: id('Mis Ideas'), name: 'X' }))).toEqual(['invalid-workspace-id@id']);
    const unnamed = await createEmptyWorkspace(storage, { id: id('vacio'), name: '  ' });
    expect(codes(unnamed)).toEqual(['invalid-workspace@workspace']);
    expect(unnamed.ok ? [] : unnamed.issues[0]?.details?.map((found) => `${found.code}@${found.path}`)).toEqual(['invalid-value@metadata.name']);
    expect(codes(await createEmptyWorkspace(storage, null as unknown as { id: WorkspaceId; name: string }))).toEqual(['invalid-workspace@input']);
    expect(ok(await storage.list())).toEqual([{ id: 'ideas', name: 'Ideas' }]);
  });
});

describe('crear un workspace vacío con IDs hostiles (cierre de fase 6)', () => {
  it.each<[string, () => unknown]>([
    ['objeto sin prototipo', () => Object.create(null)],
    ['objeto cuyo toString lanza', () => ({ toString: () => { throw new Error('conversión ejecutada'); } })],
    ['objeto con Symbol.toPrimitive que lanza', () => ({ [Symbol.toPrimitive]: () => { throw new Error('conversión ejecutada'); } })],
    ['símbolo', () => Symbol('id')],
  ])('con %s resuelve invalid-workspace-id sin guardar nada', async (_case, hostile) => {
    const storage = new MemoryStorage();
    const result = createEmptyWorkspace(storage, { id: hostile() as WorkspaceId, name: 'X' });
    await expect(result).resolves.toMatchObject({ ok: false, issues: [{ code: 'invalid-workspace-id', path: 'id' }] });
    expect(ok(await storage.list())).toEqual([]);
  });
});

describe.each(['gdd', 'storyboard', 'research'])('crear desde la plantilla %s', (name) => {
  it('guarda la instancia y la reabre igual', async () => {
    const storage = new MemoryStorage();
    const input = { workspaceId: id(`${name}-project`), name: `Proyecto ${name}`, namespace: 'p' };
    expect(ok(await createWorkspaceFromTemplate(storage, template(name), input))).toEqual({ id: `${name}-project`, name: `Proyecto ${name}` });
    const expected = assertValid(instantiateTemplate(template(name), input)).workspace;
    expect(ok(await storage.open(input.workspaceId))).toEqual(expected);
  });
});

describe('crear desde plantilla: errores', () => {
  it('una instanciación inválida devuelve invalid-template y no guarda nada', async () => {
    const storage = new MemoryStorage();
    const result = await createWorkspaceFromTemplate(storage, template('gdd'), { workspaceId: id('p'), name: 'P', namespace: 'Bad Namespace' });
    expect(codes(result)).toEqual(['invalid-template@template']);
    expect(ok(await storage.list())).toEqual([]);
  });

  it('un ID ya usado devuelve workspace-already-exists y conserva el existente', async () => {
    const storage = new MemoryStorage();
    ok(await createEmptyWorkspace(storage, { id: id('p'), name: 'Existente' }));
    const result = await createWorkspaceFromTemplate(storage, template('research'), { workspaceId: id('p'), name: 'Nuevo', namespace: 'r' });
    expect(codes(result)).toEqual(['workspace-already-exists@workspace']);
    expect(ok(await storage.list())).toEqual([{ id: 'p', name: 'Existente' }]);
  });
});

describe('modificar un workspace guardado', () => {
  const edited = readPackage('workspace-v1-edited');

  it('abre, transforma con el dominio y guarda conservando los documentos no modificados', async () => {
    const storage = ok(MemoryStorage.fromPackages({ demo: edited }));
    const summary = await modifyWorkspace(storage, id('demo'), (workspace) => {
      const [layout] = workspace.layouts as [BoardLayout];
      const moved = moveCard(layout, ideaA.id, { x: 0, y: 5 }, { columns: 12 });
      return moved.ok ? { ok: true, value: { ...workspace, layouts: [moved.value] } } : moved;
    });
    expect(ok(summary)).toEqual({ id: 'demo', name: 'Demo' });
    const after = ok(storage.exportPackage(id('demo')));
    expect(Object.keys(after).filter((path) => after[path] !== edited[path])).toEqual(['.nouty/layout.yaml']);
    expect(ok(parseWorkspace(after)).layouts[0]?.placements[0]?.rect).toEqual({ x: 0, y: 5, w: 4, h: 3 });
  });

  it('un borrado en cascada retira el documento de la tarjeta y conserva README y assets', async () => {
    const storage = ok(MemoryStorage.fromPackages({ demo: edited }));
    ok(await modifyWorkspace(storage, id('demo'), (workspace) => deleteCard(workspace, ideaB.id, { relations: 'cascade' })));
    const after = ok(storage.exportPackage(id('demo')));
    expect(after['cards/idea-b.md']).toBeUndefined();
    expect(after['README.md']).toBe(edited['README.md']);
    expect(after['assets/notes/lista de ideas.txt']).toBe(edited['assets/notes/lista de ideas.txt']);
    expect(ok(await storage.open(id('demo')))).toEqual(assertValid(deleteCard(validWorkspace(), ideaB.id, { relations: 'cascade' })));
  });

  it('si la transformación falla o cambia el ID, no se guarda nada', async () => {
    const storage = ok(MemoryStorage.fromPackages({ demo: edited }));
    const collision = await modifyWorkspace(storage, id('demo'), (workspace) => {
      const [layout] = workspace.layouts as [BoardLayout];
      const moved = moveCard(layout, ideaB.id, { x: 0, y: 0 }, { columns: 12 });
      return moved.ok ? { ok: true, value: { ...workspace, layouts: [moved.value] } } : moved;
    });
    expect(codes(collision)).toEqual(['invalid-workspace@transform']);
    expect(collision.ok ? [] : collision.issues[0]?.details?.map((found) => found.code)).toEqual(['grid-collision']);
    expect(codes(await modifyWorkspace(storage, id('demo'), (workspace) => ({ ok: true, value: { ...workspace, id: id('otro') } }))))
      .toEqual(['invalid-workspace@transform']);
    expect(codes(await modifyWorkspace(storage, id('demo'), (workspace) => ({ ok: true, value: { ...workspace, schemaVersion: 7 } }))))
      .toEqual(['invalid-workspace@workspace']);
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited);
  });

  it('un ID inexistente devuelve workspace-not-found sin ejecutar la transformación', async () => {
    const storage = new MemoryStorage();
    let called = false;
    const result = await modifyWorkspace(storage, id('ghost'), (workspace) => { called = true; return { ok: true, value: workspace }; });
    expect(codes(result)).toEqual(['workspace-not-found@id']);
    expect(called).toBe(false);
  });

  it('la transformación recibe una copia: mutarla sin devolverla no altera lo guardado', async () => {
    const storage = ok(MemoryStorage.fromPackages({ demo: edited }));
    const result = await modifyWorkspace(storage, id('demo'), (workspace) => {
      (workspace.metadata as { name: string }).name = 'mutado en sitio';
      return { ok: false, issues: [{ code: 'invalid-value', path: 'metadata', message: 'cancelado' }] };
    });
    expect(codes(result)).toEqual(['invalid-workspace@transform']);
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited);
    expect(ok(await storage.open(id('demo'))).metadata.name).toBe('Demo');
  });
});
