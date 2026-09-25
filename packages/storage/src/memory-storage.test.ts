import { describe, expect, it } from 'vitest';

import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';
import { ideaA, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { problems, unsafe, valueOf } from './__fixtures__/helpers';
import { MemoryStorage } from './memory-storage';
import type { TextFiles } from './text-files';
import { serializeWorkspace } from './workspace-codec';

const id = (value: string) => value as WorkspaceId;
const canonical = (): TextFiles => valueOf(serializeWorkspace(validWorkspace()));
function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Paquete editado a mano: comentarios, comillas y extras admitidos. */
function edited(): TextFiles {
  const files = canonical();
  return {
    ...files,
    'cards/idea-b.md': (files['cards/idea-b.md'] ?? '').replace('id: idea-b', '# escrito a mano\nid: "idea-b"'),
    '.nouty/relations.yaml': `# relaciones\n${files['.nouty/relations.yaml'] ?? ''}`,
    'README.md': '# Demo\r\n',
    'assets/notas.txt': 'notas',
  };
}

describe('MemoryStorage con paquetes v1', () => {
  it('carga paquetes existentes y los abre con el formato v1', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    expect(ok(await storage.list())).toEqual([{ id: 'demo', name: 'Demo' }]);
    expect(ok(await storage.open(id('demo')))).toEqual(validWorkspace());
  });

  it('exporta una copia exacta del paquete que no comparte estado', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    const exported = ok(storage.exportPackage(id('demo'))) as Record<string, string>;
    expect(exported).toEqual(edited());
    exported['README.md'] = 'cambiado';
    delete exported['cards/idea-a.md'];
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited());
    expect(problems(unsafe(storage.exportPackage(id('ghost'))))).toEqual(['workspace-not-found@id']);
    expect(problems(unsafe(storage.exportPackage(id('Mal ID'))))).toEqual(['invalid-workspace-id@id']);
  });

  it.each<[string, () => unknown]>([
    ['objeto sin prototipo', () => Object.create(null)],
    ['objeto cuyo toString lanza', () => ({ toString: () => { throw new Error('conversión ejecutada'); } })],
    ['símbolo', () => Symbol('id')],
  ])('exportPackage con %s devuelve invalid-workspace-id sin lanzar (cierre de fase 6)', (_case, hostile) => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    expect(() => storage.exportPackage(hostile() as WorkspaceId)).not.toThrow();
    expect(problems(unsafe(storage.exportPackage(hostile() as WorkspaceId)))).toEqual(['invalid-workspace-id@id']);
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited());
  });

  it('los mensajes de ID inválido citan textos y describen el resto solo por su tipo', async () => {
    const storage = new MemoryStorage();
    const message = async (value: unknown): Promise<string | undefined> => {
      const result = await storage.open(value as WorkspaceId);
      return result.ok ? undefined : result.issues[0]?.message;
    };
    expect(await message('Mal ID')).toBe('"Mal ID" no es un ID de workspace válido.');
    expect(await message(Object.create(null))).toBe('un valor de tipo object no es un ID de workspace válido.');
    expect(await message(['a'])).toBe('una lista no es un ID de workspace válido.');
    expect(await message(null)).toBe('null no es un ID de workspace válido.');
    expect(await message(Symbol('x'))).toBe('un valor de tipo symbol no es un ID de workspace válido.');
  });

  it('guardar sin cambios conserva el paquete byte a byte, comentarios y extras incluidos', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    ok(await storage.save(validWorkspace()));
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited());
  });

  it('guardar un cambio regenera solo el documento afectado', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    const workspace = validWorkspace();
    ok(await storage.save({ ...workspace, cards: workspace.cards.map((card) => (card.id === ideaA.id ? { ...card, title: 'Otra' } : card)) }));
    const after = ok(storage.exportPackage(id('demo')));
    const changed = Object.keys(after).filter((path) => after[path] !== edited()[path]);
    expect(changed).toEqual(['cards/idea-a.md']);
  });

  it('renombrar regenera solo el manifiesto y conserva el resto de bytes', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    ok(await storage.rename(id('demo'), id('demo-2')));
    const after = ok(storage.exportPackage(id('demo-2')));
    const changed = Object.keys(after).filter((path) => after[path] !== edited()[path]);
    expect(changed).toEqual(['.nouty/workspace.yaml']);
    expect(after['.nouty/workspace.yaml']).toContain('id: demo-2');
  });

  it('un error de guardado deja el paquete exactamente igual', async () => {
    const storage = valueOf(MemoryStorage.fromPackages({ demo: edited() }));
    const broken = unsafe<Workspace>({ ...validWorkspace(), relations: [{ id: 'r', typeId: 'references', from: 'idea-a', to: 'ghost' }] });
    const result = await storage.save(broken);
    expect(result.ok ? [] : result.issues[0]?.details?.map((found) => `${found.code}@${found.path}`)).toEqual(['missing-reference@relations[0].to']);
    expect(ok(storage.exportPackage(id('demo')))).toEqual(edited());
  });

  it.each<[string, () => unknown, string]>([
    ['contenedor no objeto', () => null, 'invalid-value@packages'],
    ['clave que no es un ID', () => ({ 'Mal ID': canonical() }), 'invalid-id@Mal ID'],
    ['paquete inválido', () => ({ demo: { ...canonical(), 'notes.txt': 'x' } }), 'unexpected-file@demo:notes.txt'],
    ['ID del manifiesto distinto de la clave', () => ({ other: canonical() }), 'identity-mismatch@other:.nouty/workspace.yaml#id'],
  ])('fromPackages rechaza %s', (_case, packages, expected) => {
    expect(problems(MemoryStorage.fromPackages(unsafe(packages())))).toContain(expected);
  });

  it('fromPackages no ejecuta getters y no conserva referencias al contenedor recibido', async () => {
    let read = false;
    const tricky = Object.defineProperty({}, 'demo', { enumerable: true, get: () => { read = true; return canonical(); } });
    expect(problems(MemoryStorage.fromPackages(tricky))).toEqual(['invalid-value@demo']);
    expect(read).toBe(false);
    const source: Record<string, TextFiles> = { demo: canonical() };
    const storage = valueOf(MemoryStorage.fromPackages(source));
    source.demo = {};
    expect(ok(await storage.open(id('demo')))).toEqual(validWorkspace());
  });
});
