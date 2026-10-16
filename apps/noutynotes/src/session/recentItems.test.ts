import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REGISTRY, forgetFolder, forgetProject, orderedFolders, orderedProjects,
  parseRegistry, resolveProjectStatus, serializeRegistry, upsertFolder, upsertProject,
} from './recentItems';
import type { RecentProjectEntry, RecentRegistry } from './recentItems';

const folder = (id: string, name: string, overrides: Partial<Parameters<typeof upsertFolder>[1]> = {}) => ({
  id, backend: 'web' as const, name, origin: 'created' as const, androidUri: null, ...overrides,
});

describe('historial local de carpetas y proyectos recientes (UX7-E1/E2A)', () => {
  it('lee lo guardado con tolerancia: ausente, corrupto o con forma inválida cae al vacío', () => {
    expect(parseRegistry(null)).toEqual(DEFAULT_REGISTRY);
    expect(parseRegistry('{no es json')).toEqual(DEFAULT_REGISTRY);
    expect(parseRegistry(JSON.stringify({ folders: 'no es un array', projects: null }))).toEqual(DEFAULT_REGISTRY);
  });

  it('serializa y vuelve a leer el mismo registro sin pérdidas', () => {
    const registry = upsertFolder(DEFAULT_REGISTRY, folder('web-abc123', 'Historias'), 100);
    expect(parseRegistry(serializeRegistry(registry))).toEqual(registry);
  });

  it('actualizar la misma carpeta (mismo id) reemplaza la entrada en vez de duplicarla', () => {
    const first = upsertFolder(DEFAULT_REGISTRY, folder('web-abc123', 'Historias'), 100);
    const second = upsertFolder(first, folder('web-abc123', 'Historias'), 200);
    expect(second.folders).toHaveLength(1);
    expect(second.folders[0]?.lastUsedAt).toBe(200);
  });

  it('E2A-01: dos carpetas homónimas conectadas por separado reciben identidades distintas y no se fusionan', () => {
    const withA = upsertFolder(DEFAULT_REGISTRY, folder('web-conn-1', 'PROYECTOS'), 100);
    const withBoth = upsertFolder(withA, folder('web-conn-2', 'PROYECTOS'), 200);
    expect(withBoth.folders).toHaveLength(2);
    expect(new Set(withBoth.folders.map((entry) => entry.id)).size).toBe(2);
    expect(orderedFolders(withBoth).map((entry) => entry.id)).toEqual(['web-conn-2', 'web-conn-1']);
  });

  it('E2A-03: dos proyectos homónimos en carpetas distintas (folderId distinto) no colisionan', () => {
    const withFirst = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'historias', name: 'Historias', backend: 'web', folderId: 'web-conn-1' }, 100);
    const withBoth = upsertProject(withFirst, { workspaceId: 'historias', name: 'Historias', backend: 'web', folderId: 'web-conn-2' }, 100);
    expect(withBoth.projects).toHaveLength(2);
    expect(new Set(withBoth.projects.map((entry) => entry.id)).size).toBe(2);
    // Ningún proyecto apunta a la carpeta del otro.
    const forConn1 = withBoth.projects.find((entry) => entry.folderId === 'web-conn-1');
    const forConn2 = withBoth.projects.find((entry) => entry.folderId === 'web-conn-2');
    expect(forConn1?.id).not.toBe(forConn2?.id);
  });

  it('reordena por fecha de uso, no por orden de inserción', () => {
    const a = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'a', name: 'A', backend: 'memory', folderId: null }, 100);
    const ab = upsertProject(a, { workspaceId: 'b', name: 'B', backend: 'memory', folderId: null }, 200);
    const aba = upsertProject(ab, { workspaceId: 'a', name: 'A', backend: 'memory', folderId: null }, 300);
    expect(orderedProjects(aba).map((entry) => entry.workspaceId)).toEqual(['a', 'b']);
  });

  it('E2A-08: olvidar quita solo la entrada indicada del registro, sin tocar el resto ni fusionar carpetas homónimas', () => {
    const withA = upsertFolder(DEFAULT_REGISTRY, folder('web-conn-1', 'A'), 100);
    const withBoth = upsertFolder(withA, folder('android-conn-2', 'B', { backend: 'android', androidUri: 'content://b' }), 200);
    const afterForget = forgetFolder(withBoth, 'web-conn-1');
    expect(afterForget.folders).toEqual([{ id: 'android-conn-2', backend: 'android', name: 'B', origin: 'created', androidUri: 'content://b', lastUsedAt: 200 }]);

    const projects = upsertProject(DEFAULT_REGISTRY, { workspaceId: 'a', name: 'A', backend: 'web', folderId: 'web-conn-1' }, 100);
    const projectsWithTwo = upsertProject(projects, { workspaceId: 'b', name: 'B', backend: 'web', folderId: 'web-conn-1' }, 200);
    const afterForgetProject = forgetProject(projectsWithTwo, projects.projects[0]?.id ?? '');
    expect(afterForgetProject.projects).toHaveLength(1);
    expect(afterForgetProject.projects[0]?.workspaceId).toBe('b');
  });

  it('el historial no crece sin límite: conserva como mucho los 12 más recientes', () => {
    let registry: RecentRegistry = DEFAULT_REGISTRY;
    for (let index = 0; index < 20; index += 1) {
      registry = upsertFolder(registry, folder(`web-conn-${index}`, `Carpeta ${index}`), index);
    }
    expect(registry.folders).toHaveLength(12);
    expect(orderedFolders(registry)[0]?.id).toBe('web-conn-19');
  });

  describe('E2A-04/E2A-05: migración de registros E1 (sin `origin`/`folderId`)', () => {
    const legacyJson = JSON.stringify({
      version: 1,
      folders: [
        { id: 'web:Historias', backend: 'web', key: 'Historias', name: 'Historias', lastUsedAt: 100 },
        { id: 'android:content://tree/b', backend: 'android', key: 'content://tree/b', name: 'Videojuegos', lastUsedAt: 200 },
      ],
      projects: [
        { id: 'web:Historias:guion', workspaceId: 'guion', name: 'Guion', backend: 'web', folderKey: 'Historias', lastUsedAt: 100 },
        { id: 'memory:memory:temporal', workspaceId: 'temporal', name: 'Temporal', backend: 'memory', folderKey: null, lastUsedAt: 50 },
      ],
    });

    it('lee el formato antiguo, marca las carpetas como `legacy` y conserva toda la información', () => {
      const registry = parseRegistry(legacyJson);
      expect(registry.folders).toHaveLength(2);
      const web = registry.folders.find((entry) => entry.backend === 'web');
      expect(web).toMatchObject({ id: 'web:Historias', name: 'Historias', origin: 'legacy', androidUri: null });
      const android = registry.folders.find((entry) => entry.backend === 'android');
      // La URI SAF antigua era una identidad real, no un nombre — se conserva como `androidUri`.
      expect(android).toMatchObject({ id: 'android:content://tree/b', name: 'Videojuegos', origin: 'legacy', androidUri: 'content://tree/b' });
    });

    it('reconstruye `folderId` de cada proyecto a partir del `folderKey` antiguo sin inventar una carpeta nueva', () => {
      const registry = parseRegistry(legacyJson);
      const guion = registry.projects.find((entry) => entry.workspaceId === 'guion');
      expect(guion?.folderId).toBe('web:Historias');
      // Corresponde exactamente a la carpeta migrada de arriba — ninguna asociación inventada.
      expect(registry.folders.some((entry) => entry.id === guion?.folderId)).toBe(true);
      const temporal = registry.projects.find((entry) => entry.workspaceId === 'temporal');
      expect(temporal?.folderId).toBeNull();
    });

    it('la migración es idempotente: leer y volver a guardar varias veces no duplica ni pierde metadatos', () => {
      const once = parseRegistry(legacyJson);
      const roundTrip1 = parseRegistry(serializeRegistry(once));
      const roundTrip2 = parseRegistry(serializeRegistry(roundTrip1));
      expect(roundTrip1).toEqual(once);
      expect(roundTrip2).toEqual(once);
      expect(roundTrip2.folders).toHaveLength(2);
      expect(roundTrip2.projects).toHaveLength(2);
    });

    it('una reconexión confirmada actualiza la entrada heredada a `created` sin perder su `id`', () => {
      const migrated = parseRegistry(legacyJson);
      const confirmed = upsertFolder(migrated, { id: 'web:Historias', backend: 'web', name: 'Historias', origin: 'created', androidUri: null }, 300);
      expect(confirmed.folders).toHaveLength(2);
      const entry = confirmed.folders.find((candidate) => candidate.id === 'web:Historias');
      expect(entry).toMatchObject({ origin: 'created', lastUsedAt: 300 });
    });
  });

  describe('E2A-02/06/07: estado de un proyecto reciente no confunde "cargando" con "perdido"', () => {
    const project: RecentProjectEntry = { id: 'web:folder-1:guion', workspaceId: 'guion', name: 'Guion', backend: 'web', folderId: 'folder-1', lastUsedAt: 100 };
    const baseContext = { currentBackend: 'web' as const, currentFolderId: 'folder-1', knownFolderIds: ['folder-1'], workspacesLoading: false, knownWorkspaceIds: [] as string[] };

    it('E2A-06: la carpeta correcta está conectada pero la lista todavía no respondió → "loading", nunca "reconnect"', () => {
      expect(resolveProjectStatus(project, { ...baseContext, workspacesLoading: true, knownWorkspaceIds: [] })).toBe('loading');
      // Incluso si por una carrera la lista YA trae el id (orden de resolución no garantizado), mientras
      // `workspacesLoading` siga en curso no se afirma disponibilidad todavía.
      expect(resolveProjectStatus(project, { ...baseContext, workspacesLoading: true, knownWorkspaceIds: ['guion'] })).toBe('loading');
    });

    it('E2A-07: lista completa — abre si existe, "missing" (no "reconnect") si la carpeta correcta confirma que no está', () => {
      expect(resolveProjectStatus(project, { ...baseContext, workspacesLoading: false, knownWorkspaceIds: ['guion'] })).toBe('available');
      expect(resolveProjectStatus(project, { ...baseContext, workspacesLoading: false, knownWorkspaceIds: ['otro'] })).toBe('missing');
    });

    it('carpeta distinta de la activa, con entrada de carpeta conocida → "reconnect"; sin ella → "unavailable"', () => {
      expect(resolveProjectStatus(project, { ...baseContext, currentFolderId: 'folder-2', knownFolderIds: ['folder-1', 'folder-2'] })).toBe('reconnect');
      expect(resolveProjectStatus(project, { ...baseContext, currentFolderId: 'folder-2', knownFolderIds: ['folder-2'] })).toBe('unavailable');
    });

    it('memoria no entra en la carrera de carga: disponible solo en la misma sesión en memoria, si no, temporal', () => {
      const memoryProject: RecentProjectEntry = { id: 'memory:memory:temp', workspaceId: 'temp', name: 'Temp', backend: 'memory', folderId: null, lastUsedAt: 100 };
      expect(resolveProjectStatus(memoryProject, { ...baseContext, currentBackend: 'memory', workspacesLoading: true, knownWorkspaceIds: ['temp'] })).toBe('available');
      expect(resolveProjectStatus(memoryProject, { ...baseContext, currentBackend: 'memory', knownWorkspaceIds: [] })).toBe('temporary');
      expect(resolveProjectStatus(memoryProject, { ...baseContext, currentBackend: 'web' })).toBe('temporary');
    });
  });
});
