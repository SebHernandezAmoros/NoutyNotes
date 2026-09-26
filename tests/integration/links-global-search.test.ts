import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, createEmptyWorkspaceNamed, linkCardTypeFor, modifyWorkspace, placeCardOnBoard, searchAllWorkspaces, searchWorkspace, setCardLink,
} from '../../packages/application/src/index';
import type { WorkspaceStorage, WorkspaceStorageResult } from '../../packages/application/src/index';
import type { CardTypeDefinition, CardTypeId, Workspace, WorkspaceId } from '../../packages/domain/src/index';
import { MemoryStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const codes = (result: WorkspaceStorageResult<unknown>) => (result.ok ? [] : result.issues.flatMap((item) => [item.code, ...(item.details ?? []).map((detail) => detail.code)]));
const withTypes = (storage: WorkspaceStorage, id: WorkspaceId, types: CardTypeDefinition[]) =>
  modifyWorkspace(storage, id, (workspace) => ({ ok: true, value: { ...workspace, cardTypes: [...workspace.cardTypes, ...types] } }));
const source: CardTypeDefinition = {
  id: 'source' as CardTypeId, label: 'Fuente', base: 'link',
  fields: [{ key: 'url', kind: 'url', required: true }, { key: 'accessed', kind: 'date' }] as unknown as CardTypeDefinition['fields'],
};

describe('tarjetas de enlace (ADR 0020)', () => {
  it('se crean con la URL normalizada, el dominio como título y el tipo «enlace»; una URL peligrosa no escribe nada', async () => {
    const storage = new MemoryStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Lecturas'));
    expect(codes(await addCardToBoard(storage, id, { kind: 'link', url: 'javascript:alert(1)' }))).toContain('invalid-value');
    expect(ok(await storage.open(id)).cards).toEqual([]);
    const card = ok(await addCardToBoard(storage, id, { kind: 'link', url: ' ejemplo.com/guia ' }));
    const workspace = ok(await storage.open(id));
    expect(workspace.cards[0]).toMatchObject({ id: card, typeId: 'enlace', title: 'ejemplo.com', fields: { url: 'https://ejemplo.com/guia' } });
    // Sin cambio de formato: la URL va en `fields` de una tarjeta v1.
    expect(ok(storage.exportPackage(id))[`cards/${card}.md`]).toContain('schemaVersion: 1');
    expect(ok(await setCardLink(storage, id, card, 'https://otro.org'))).toBe('https://otro.org');
    expect(codes(await setCardLink(storage, id, card, 'file:///etc/passwd'))).toContain('invalid-value');
    expect(ok(await storage.open(id)).cards[0]?.fields).toEqual({ url: 'https://otro.org' });
  });

  it('reutiliza un tipo de enlace compatible (Research) y no pisa un «enlace» incompatible', async () => {
    const storage = new MemoryStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Investigación'));
    ok(await withTypes(storage, id, [source]));
    const card = ok(await addCardToBoard(storage, id, { kind: 'link', url: 'https://revista.org/articulo', title: 'Artículo' }));
    expect(ok(await storage.open(id)).cards.find((candidate) => candidate.id === card)?.typeId).toBe('source');

    const other = ok(await createEmptyWorkspaceNamed(storage, 'Choque'));
    ok(await withTypes(storage, other.id, [{ id: 'enlace' as CardTypeId, label: 'Enlace interno', base: 'note', fields: [] }]));
    const opened: Workspace = ok(await storage.open(other.id));
    expect(linkCardTypeFor(opened).id).toBe('enlace-2');
  });

  it('la búsqueda local encuentra una tarjeta por su enlace y filtra por tipo', async () => {
    const storage = new MemoryStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Lecturas'));
    ok(await addCardToBoard(storage, id, { kind: 'link', url: 'https://ejemplo.com/guia', title: 'Guía' }));
    ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Guía de estilo' }));
    const workspace = ok(await storage.open(id));
    expect(searchWorkspace(workspace, 'ejemplo.com').map((result) => result.title)).toEqual(['Guía']);
    expect(searchWorkspace(workspace, 'guia').map((result) => result.title)).toEqual(['Guía', 'Guía de estilo']);
    expect(searchWorkspace(workspace, 'guia', { typeId: 'nota' as CardTypeId }).map((result) => result.title)).toEqual(['Guía de estilo']);
    // Solo el tipo, sin palabras: todas las de ese tipo.
    expect(searchWorkspace(workspace, '', { typeId: 'enlace' as CardTypeId }).map((result) => result.title)).toEqual(['Guía']);
  });
});

describe('búsqueda en todos los proyectos (ADR 0020)', () => {
  it('agrupa por proyecto, usa el abierto tal como está en memoria e informa de los ilegibles', async () => {
    const memory = new MemoryStorage();
    const a = ok(await createEmptyWorkspaceNamed(memory, 'Alfa'));
    const b = ok(await createEmptyWorkspaceNamed(memory, 'Beta'));
    const c = ok(await createEmptyWorkspaceNamed(memory, 'Gamma'));
    ok(await addCardToBoard(memory, a.id, { kind: 'note', title: 'Mapa del río' }));
    ok(await addCardToBoard(memory, b.id, { kind: 'link', url: 'https://rio.example.org' }));
    ok(await addCardToBoard(memory, c.id, { kind: 'note', title: 'Río oculto' }));
    const opens: string[] = [];
    // Gamma no se puede leer: aparece como ilegible, nunca se omite en silencio.
    const storage: WorkspaceStorage = {
      ...memory, list: () => memory.list(), create: (w) => memory.create(w), save: (w) => memory.save(w), rename: (f, t) => memory.rename(f, t), delete: (i) => memory.delete(i),
      open: async (workspaceId) => {
        opens.push(workspaceId);
        return workspaceId === c.id ? { ok: false, issues: [{ code: 'io-failure', path: 'id', message: 'No se pudo leer la carpeta.' }] } : memory.open(workspaceId);
      },
    };
    // El proyecto abierto se busca con su estado en memoria (aquí, con un cambio aún no leído del disco).
    const current = ok(await memory.open(a.id));
    const edited: Workspace = { ...current, cards: current.cards.map((card) => ({ ...card, title: 'Mapa del RÍO actualizado' })) };
    const found = await searchAllWorkspaces(storage, 'rio', edited);
    expect(found.searched).toBe(3);
    expect(found.projects.map((project) => [project.name, project.results.map((result) => result.title)])).toEqual([
      ['Alfa', ['Mapa del RÍO actualizado']],
      ['Beta', ['rio.example.org']],
    ]);
    expect(found.unreadable).toEqual([{ workspaceId: c.id, name: 'Gamma', message: 'No se pudo leer la carpeta.' }]);
    expect(opens).not.toContain(a.id);
  });
});

describe('colocar una tarjeta sin posición (deuda de ADR 0019, ADR 0020)', () => {
  it('la pone en el primer hueco libre de su tablero; si ya tiene posición o no está en el tablero, no cambia nada', async () => {
    const storage = new MemoryStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Mesa'));
    const first = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Primera' }));
    const loose = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Suelta' }));
    // Una tarjeta del tablero sin posición (p. ej. un archivo editado a mano).
    ok(await modifyWorkspace(storage, id, (workspace) => ({ ok: true, value: {
      ...workspace, layouts: workspace.layouts.map((layout) => ({ ...layout, placements: layout.placements.filter((placement) => placement.cardId !== loose) })),
    } })));
    const boardId = ok(await storage.open(id)).boards[0]!.id;
    const at = ok(await placeCardOnBoard(storage, id, { boardId, cardId: loose }));
    const placements = ok(await storage.open(id)).layouts[0]!.placements;
    expect(placements.find((placement) => placement.cardId === loose)).toMatchObject({ rect: { x: at.x, y: at.y, w: 4, h: 3 }, display: 'expanded' });
    // Sin solaparse con la que ya estaba.
    const other = placements.find((placement) => placement.cardId === first)!.rect;
    expect(at.x >= other.x + other.w || at.y >= other.y + other.h || at.x + 4 <= other.x || at.y + 3 <= other.y).toBe(true);
    expect(codes(await placeCardOnBoard(storage, id, { boardId, cardId: loose }))).toContain('invalid-value');
  });
});
