/**
 * Suite contractual reutilizable de WorkspaceStorage (ADR 0008). Cualquier adaptador (memoria,
 * carpetas web, Android) debe pasarla con su propia fábrica. Solo usa el puerto de application y
 * datos del dominio: no conoce archivos ni detalles del adaptador.
 */
import { describe, expect, it } from 'vitest';

import type { WorkspaceStorage, WorkspaceStorageResult } from '../../packages/application/src/index';
import { ideaA, ideaB, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { assertValid, deleteCard, moveCard } from '../../packages/domain/src/index';
import type { BoardLayout, Workspace, WorkspaceId } from '../../packages/domain/src/index';

export type WorkspaceStorageFactory = () => WorkspaceStorage | Promise<WorkspaceStorage>;

const id = (value: string) => value as WorkspaceId;

/** Workspace válido con otro ID y nombre, a partir del fixture del dominio. */
export function sampleWorkspace(workspaceId: string, name = `Espacio ${workspaceId}`): Workspace {
  return { ...validWorkspace(), id: id(workspaceId), metadata: { name } };
}

function valueOf<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function codes(result: WorkspaceStorageResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

/** Estado observable completo: lista y cada workspace abierto. */
async function snapshot(storage: WorkspaceStorage): Promise<unknown> {
  const summaries = valueOf(await storage.list());
  const opened = await Promise.all(summaries.map(async ({ id: workspaceId }) => valueOf(await storage.open(workspaceId))));
  return JSON.parse(JSON.stringify({ summaries, opened })) as unknown;
}

export function workspaceStorageContract(adapter: string, factory: WorkspaceStorageFactory): void {
  describe(`contrato WorkspaceStorage: ${adapter}`, () => {
    describe('crear, abrir y listar', () => {
      it('empieza vacío', async () => {
        const storage = await factory();
        expect(valueOf(await storage.list())).toEqual([]);
      });

      it('crea un workspace, lo lista y lo abre igual', async () => {
        const storage = await factory();
        const workspace = sampleWorkspace('demo', 'Demo');
        expect(valueOf(await storage.create(workspace))).toEqual({ id: 'demo', name: 'Demo' });
        expect(valueOf(await storage.list())).toEqual([{ id: 'demo', name: 'Demo' }]);
        expect(valueOf(await storage.open(id('demo')))).toEqual(workspace);
      });

      it('lista por ID en orden determinista, sin depender del orden de creación', async () => {
        const storage = await factory();
        for (const workspaceId of ['zeta', 'alpha', 'mid-1', 'mid-0', 'b2']) {
          valueOf(await storage.create(sampleWorkspace(workspaceId)));
        }
        expect(valueOf(await storage.list()).map((summary) => summary.id)).toEqual(['alpha', 'b2', 'mid-0', 'mid-1', 'zeta']);
      });

      it('rechaza crear un ID existente y conserva el workspace original', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo', 'Original')));
        const before = await snapshot(storage);
        expect(codes(await storage.create(sampleWorkspace('demo', 'Otro')))).toEqual(['workspace-already-exists@workspace']);
        expect(await snapshot(storage)).toEqual(before);
      });

      it('rechaza abrir IDs inexistentes o inválidos sin rechazar la promesa', async () => {
        const storage = await factory();
        expect(codes(await storage.open(id('ghost')))).toEqual(['workspace-not-found@id']);
        expect(codes(await storage.open(id('Mal ID')))).toEqual(['invalid-workspace-id@id']);
        await expect(storage.open(undefined as unknown as WorkspaceId)).resolves.toMatchObject({ ok: false });
      });
    });

    describe('datos inválidos y fallos del formato', () => {
      it.each<[string, () => unknown]>([
        ['referencia colgante', () => ({ ...sampleWorkspace('bad'), relations: [{ id: 'r', typeId: 'references', from: 'idea-a', to: 'ghost' }] })],
        ['versión no admitida', () => ({ ...sampleWorkspace('bad'), schemaVersion: 2 })],
        ['clave que el formato no puede escribir', () => ({ ...sampleWorkspace('bad'), plugins: [] })],
        ['asset no portable', () => ({ ...sampleWorkspace('bad'), cards: [{ ...ideaA, assetRefs: ['assets/a?.png'] }, ideaB] })],
        ['no es un objeto', () => null],
        ['getter', () => Object.defineProperty(sampleWorkspace('bad'), 'metadata', { enumerable: true, get: () => ({ name: 'x' }) })],
      ])('create rechaza %s como invalid-workspace sin guardar nada', async (_case, workspace) => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo')));
        const before = await snapshot(storage);
        const result = await storage.create(workspace() as Workspace);
        expect(codes(result)).toEqual(['invalid-workspace@workspace']);
        expect(result.ok ? [] : result.issues[0]?.details?.length).toBeGreaterThan(0);
        expect(await snapshot(storage)).toEqual(before);
      });

      it('save rechaza un workspace inválido y conserva la versión anterior', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo')));
        const before = await snapshot(storage);
        const broken = { ...sampleWorkspace('demo'), cards: [{ ...ideaA, typeId: 'missing' }, ideaB] } as unknown as Workspace;
        expect(codes(await storage.save(broken))).toEqual(['invalid-workspace@workspace']);
        expect(await snapshot(storage)).toEqual(before);
      });
    });

    describe('guardar', () => {
      it('sustituye el contenido completo del workspace existente', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo', 'Demo')));
        const edited = assertValid(deleteCard({ ...sampleWorkspace('demo', 'Demo renombrado') }, ideaB.id, { relations: 'cascade' }));
        expect(valueOf(await storage.save(edited))).toEqual({ id: 'demo', name: 'Demo renombrado' });
        expect(valueOf(await storage.open(id('demo')))).toEqual(edited);
        expect(valueOf(await storage.list())).toEqual([{ id: 'demo', name: 'Demo renombrado' }]);
      });

      it('rechaza guardar un ID inexistente sin crearlo', async () => {
        const storage = await factory();
        expect(codes(await storage.save(sampleWorkspace('ghost')))).toEqual(['workspace-not-found@workspace']);
        expect(valueOf(await storage.list())).toEqual([]);
      });
    });

    describe('renombrar y borrar', () => {
      it('renombra el identificador y conserva el contenido', async () => {
        const storage = await factory();
        const workspace = sampleWorkspace('demo', 'Demo');
        valueOf(await storage.create(workspace));
        valueOf(await storage.create(sampleWorkspace('alpha')));
        expect(valueOf(await storage.rename(id('demo'), id('zz-demo')))).toEqual({ id: 'zz-demo', name: 'Demo' });
        expect(codes(await storage.open(id('demo')))).toEqual(['workspace-not-found@id']);
        expect(valueOf(await storage.open(id('zz-demo')))).toEqual({ ...workspace, id: 'zz-demo' });
        expect(valueOf(await storage.list()).map((summary) => summary.id)).toEqual(['alpha', 'zz-demo']);
      });

      it('renombrar al mismo ID no cambia nada', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo', 'Demo')));
        const before = await snapshot(storage);
        expect(valueOf(await storage.rename(id('demo'), id('demo')))).toEqual({ id: 'demo', name: 'Demo' });
        expect(await snapshot(storage)).toEqual(before);
      });

      it.each<[string, string, string, string]>([
        ['origen inexistente', 'ghost', 'nuevo', 'workspace-not-found@from'],
        ['destino existente', 'demo', 'alpha', 'workspace-already-exists@to'],
        ['destino inválido', 'demo', 'Nuevo ID', 'invalid-workspace-id@to'],
        ['origen inválido', '../demo', 'nuevo', 'invalid-workspace-id@from'],
      ])('rechaza renombrar con %s sin cambios', async (_case, from, to, expected) => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo')));
        valueOf(await storage.create(sampleWorkspace('alpha')));
        const before = await snapshot(storage);
        expect(codes(await storage.rename(id(from), id(to)))).toEqual([expected]);
        expect(await snapshot(storage)).toEqual(before);
      });

      it('borra solo el workspace indicado; borrar de nuevo es un error explícito', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo')));
        valueOf(await storage.create(sampleWorkspace('alpha')));
        expect(await storage.delete(id('demo'))).toEqual({ ok: true, value: null });
        expect(valueOf(await storage.list()).map((summary) => summary.id)).toEqual(['alpha']);
        expect(codes(await storage.delete(id('demo')))).toEqual(['workspace-not-found@id']);
        expect(codes(await storage.delete(id('Mal')))).toEqual(['invalid-workspace-id@id']);
        expect(valueOf(await storage.open(id('alpha')))).toEqual(sampleWorkspace('alpha'));
      });

      it('un ID borrado puede volver a crearse', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo', 'Primero')));
        valueOf(await storage.delete(id('demo')));
        expect(valueOf(await storage.create(sampleWorkspace('demo', 'Segundo')))).toEqual({ id: 'demo', name: 'Segundo' });
      });
    });

    describe('copias defensivas y aislamiento', () => {
      it('mutar el workspace entregado o el devuelto no altera lo guardado', async () => {
        const storage = await factory();
        const input = sampleWorkspace('demo') as unknown as { metadata: { name: string }; cards: { title?: string }[] };
        valueOf(await storage.create(input as unknown as Workspace));
        const stored = await snapshot(storage);
        input.metadata.name = 'mutado';
        (input.cards[0] as { title?: string }).title = 'mutado';
        const opened = valueOf(await storage.open(id('demo'))) as unknown as { cards: { title?: string }[]; relations: unknown[] };
        (opened.cards[0] as { title?: string }).title = 'también mutado';
        opened.relations.length = 0;
        const summaries = valueOf(await storage.list()) as unknown as unknown[];
        summaries.push({ id: 'ghost', name: 'x' });
        expect(await snapshot(storage)).toEqual(stored);
      });

      it('cada apertura devuelve objetos nuevos', async () => {
        const storage = await factory();
        valueOf(await storage.create(sampleWorkspace('demo')));
        const first = valueOf(await storage.open(id('demo')));
        const second = valueOf(await storage.open(id('demo')));
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        expect(second.cards[0]).not.toBe(first.cards[0]);
      });

      it('dos instancias de la fábrica no comparten estado', async () => {
        const first = await factory();
        const second = await factory();
        valueOf(await first.create(sampleWorkspace('demo')));
        expect(valueOf(await second.list())).toEqual([]);
        expect(codes(await second.open(id('demo')))).toEqual(['workspace-not-found@id']);
      });
    });

    it('flujo completo: crear, modificar, guardar, reabrir, listar, renombrar y borrar', async () => {
      const storage = await factory();
      valueOf(await storage.create(sampleWorkspace('project', 'Proyecto')));
      const opened = valueOf(await storage.open(id('project')));
      const [layout] = opened.layouts as [BoardLayout];
      const moved = assertValid(moveCard(layout, ideaA.id, { x: 0, y: 6 }, { columns: 12 }));
      const changed: Workspace = { ...opened, layouts: [moved], metadata: { name: 'Proyecto movido' } };
      valueOf(await storage.save(changed));
      expect(valueOf(await storage.open(id('project')))).toEqual(changed);
      valueOf(await storage.rename(id('project'), id('project-v2')));
      expect(valueOf(await storage.list())).toEqual([{ id: 'project-v2', name: 'Proyecto movido' }]);
      valueOf(await storage.delete(id('project-v2')));
      expect(valueOf(await storage.list())).toEqual([]);
    });

    it('una secuencia de operaciones fallidas no altera el estado', async () => {
      const storage = await factory();
      valueOf(await storage.create(sampleWorkspace('demo')));
      valueOf(await storage.create(sampleWorkspace('alpha')));
      const before = await snapshot(storage);
      const failures = await Promise.all([
        storage.create(sampleWorkspace('demo')),
        storage.save(sampleWorkspace('ghost')),
        storage.save({ ...sampleWorkspace('demo'), schemaVersion: 9 }),
        storage.rename(id('demo'), id('alpha')),
        storage.rename(id('ghost'), id('x')),
        storage.delete(id('ghost')),
        storage.open(id('ghost')),
      ]);
      expect(failures.every((result) => !result.ok)).toBe(true);
      expect(await snapshot(storage)).toEqual(before);
    });
  });
}
