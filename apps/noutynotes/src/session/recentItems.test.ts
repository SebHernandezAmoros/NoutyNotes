import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REGISTRY, forgetFolder, forgetProject, orderedFolders, orderedProjects,
  parseRegistry, serializeRegistry, upsertFolder, upsertProject,
} from './recentItems';
import type { RecentRegistry } from './recentItems';

describe('historial local de carpetas y proyectos recientes (UX7-E1)', () => {
  it('lee lo guardado con tolerancia: ausente, corrupto o con forma inválida cae al vacío', () => {
    expect(parseRegistry(null)).toEqual(DEFAULT_REGISTRY);
    expect(parseRegistry('{no es json')).toEqual(DEFAULT_REGISTRY);
    expect(parseRegistry(JSON.stringify({ folders: 'no es un array', projects: null }))).toEqual(DEFAULT_REGISTRY);
    expect(parseRegistry(JSON.stringify({
      folders: [{ id: 'web:x', backend: 'web', key: 'x', name: 'X' }, { backend: 'web' }],
      projects: [{ id: 'memory:memory:a', workspaceId: 'a', name: 'A', backend: 'memory', folderKey: null, lastUsedAt: 1 }],
    }))).toEqual({
      version: 1,
      folders: [], // sin lastUsedAt numérico, la primera entrada también se descarta
      projects: [{ id: 'memory:memory:a', workspaceId: 'a', name: 'A', backend: 'memory', folderKey: null, lastUsedAt: 1 }],
    });
  });

  it('serializa y vuelve a leer el mismo registro sin pérdidas', () => {
    const registry = upsertFolder(DEFAULT_REGISTRY, { backend: 'web', key: 'Historias', name: 'Historias' }, 100);
    expect(parseRegistry(serializeRegistry(registry))).toEqual(registry);
  });

  it('reabrir la misma carpeta actualiza la entrada existente en vez de duplicarla', () => {
    const first = upsertFolder(DEFAULT_REGISTRY, { backend: 'web', key: 'Historias', name: 'Historias' }, 100);
    const second = upsertFolder(first, { backend: 'web', key: 'Historias', name: 'Historias' }, 200);
    expect(second.folders).toHaveLength(1);
    expect(second.folders[0]).toEqual({ id: 'web:Historias', backend: 'web', key: 'Historias', name: 'Historias', lastUsedAt: 200 });
  });

  it('RECENT-E04: dos proyectos con el mismo nombre en carpetas distintas no colisionan', () => {
    const withFirst = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'demo', name: 'Demo', backend: 'web', folderKey: 'Mis proyectos' }, 100);
    const withBoth = upsertProject(withFirst, { workspaceId: 'demo', name: 'Demo', backend: 'web', folderKey: 'Otra carpeta' }, 100);
    expect(withBoth.projects).toHaveLength(2);
    expect(new Set(withBoth.projects.map((entry) => entry.id)).size).toBe(2);
  });

  it('RECENT-E05: reabrir A, luego B y después A deja A primero por fecha de uso, no por orden de inserción', () => {
    const a = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'a', name: 'A', backend: 'memory', folderKey: null }, 100);
    const ab = upsertProject(a, { workspaceId: 'b', name: 'B', backend: 'memory', folderKey: null }, 200);
    const aba = upsertProject(ab, { workspaceId: 'a', name: 'A', backend: 'memory', folderKey: null }, 300);
    expect(orderedProjects(aba).map((entry) => entry.workspaceId)).toEqual(['a', 'b']);
  });

  it('olvidar quita solo la entrada indicada del registro, sin tocar el resto', () => {
    const withA = upsertFolder(DEFAULT_REGISTRY, { backend: 'web', key: 'A', name: 'A' }, 100);
    const withBoth = upsertFolder(withA, { backend: 'android', key: 'content://b', name: 'B' }, 200);
    const afterForget = forgetFolder(withBoth, 'web:A');
    expect(afterForget.folders).toEqual([{ id: 'android:content://b', backend: 'android', key: 'content://b', name: 'B', lastUsedAt: 200 }]);

    const projects = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'a', name: 'A', backend: 'memory', folderKey: null }, 100);
    expect(forgetProject(projects, 'memory:memory:a').projects).toEqual([]);
  });

  it('el historial no crece sin límite: conserva como mucho los 12 más recientes', () => {
    let registry: RecentRegistry = DEFAULT_REGISTRY;
    for (let index = 0; index < 20; index += 1) {
      registry = upsertFolder(registry, { backend: 'web', key: `carpeta-${index}`, name: `Carpeta ${index}` }, index);
    }
    expect(registry.folders).toHaveLength(12);
    expect(orderedFolders(registry)[0]?.key).toBe('carpeta-19');
  });
});
