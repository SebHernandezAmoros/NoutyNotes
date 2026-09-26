import { describe, expect, it } from 'vitest';

import {
  addBoardToWorkspace, addCardTag, addCardToBoard, createEmptyWorkspaceNamed, editCardContent, moveCardToTrash, removeCardTag,
  removeTagEverywhere, renameTag, searchWorkspace, workspaceTags,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { MemoryStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const codes = (result: WorkspaceStorageResult<unknown>) => (result.ok ? [] : result.issues.flatMap((item) => [item.code, ...(item.details ?? []).map((detail) => detail.code)]));

async function project() {
  const storage = new MemoryStorage();
  const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Viajes'));
  const kioto = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Kioto en otoño' }));
  ok(await editCardContent(storage, id, kioto, { content: 'Templos y <script>alert(1)</script> jardines' }));
  const second = ok(await addBoardToWorkspace(storage, id, { title: 'Ideas' }));
  const tokio = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Tokio', boardId: second }));
  const foto = ok(await addCardToBoard(storage, id, { kind: 'image', title: 'Foto del río', boardId: second }));
  return { storage, id, kioto, tokio, foto, second };
}

describe('etiquetas # por proyecto (ADR 0019)', () => {
  it('añadir normaliza lo que escribe la persona; quitar y un nombre inválido no escriben de más', async () => {
    const { storage, id, kioto } = await project();
    expect(ok(await addCardTag(storage, id, kioto, '  #Japón '))).toEqual(['japón']);
    expect(ok(await addCardTag(storage, id, kioto, 'viaje/otoño'))).toEqual(['japón', 'viaje/otoño']);
    expect(ok(await addCardTag(storage, id, kioto, 'JAPÓN'))).toEqual(['japón', 'viaje/otoño']);
    expect(codes(await addCardTag(storage, id, kioto, 'dos palabras'))).toContain('invalid-value');
    expect(ok(await removeCardTag(storage, id, kioto, 'viaje/otoño'))).toEqual(['japón']);
    // Quitar la última elimina la clave: la tarjeta vuelve a v1.
    expect(ok(await removeCardTag(storage, id, kioto, 'japón'))).toEqual([]);
    expect(ok(storage.exportPackage(id))[`cards/${kioto}.md`]).toContain('schemaVersion: 1');
  });

  it('renombrar cambia todas las tarjetas (también en la Papelera) y fusiona sin duplicados; quitar de todas', async () => {
    const { storage, id, kioto, tokio, foto } = await project();
    ok(await addCardTag(storage, id, kioto, 'japon'));
    ok(await addCardTag(storage, id, tokio, 'japon'));
    ok(await addCardTag(storage, id, tokio, 'japón'));
    ok(await addCardTag(storage, id, foto, 'japon'));
    ok(await moveCardToTrash(storage, id, foto));
    expect(workspaceTags(ok(await storage.open(id)))).toEqual([{ tag: 'japon', count: 2 }, { tag: 'japón', count: 1 }]);
    ok(await renameTag(storage, id, 'japon', 'Japón'));
    const renamed = ok(await storage.open(id));
    expect(renamed.cards.find((card) => card.id === tokio)?.tags).toEqual(['japón']);
    expect(renamed.trash?.[0]?.card.tags).toEqual(['japón']);
    expect(workspaceTags(renamed)).toEqual([{ tag: 'japón', count: 2 }]);
    expect(codes(await renameTag(storage, id, 'inexistente', 'x'))).toContain('missing-reference');
    ok(await removeTagEverywhere(storage, id, 'japón'));
    expect(workspaceTags(ok(await storage.open(id)))).toEqual([]);
  });
});

describe('búsqueda dentro del proyecto (ADR 0019)', () => {
  it('busca en título, texto, etiquetas y tipo sin distinguir mayúsculas ni acentos, e indica dónde está cada tarjeta', async () => {
    const { storage, id, kioto, tokio, foto, second } = await project();
    ok(await addCardTag(storage, id, tokio, 'japón'));
    const workspace = ok(await storage.open(id));
    expect(searchWorkspace(workspace, 'OTONO').map((result) => result.cardId)).toEqual([kioto]);
    expect(searchWorkspace(workspace, 'jardines')[0]).toMatchObject({ cardId: kioto, excerpt: expect.stringContaining('<script>alert(1)</script>') });
    expect(searchWorkspace(workspace, '#japon').map((result) => result.cardId)).toEqual([tokio]);
    expect(searchWorkspace(workspace, 'imagen').map((result) => result.cardId)).toEqual([foto]);
    expect(searchWorkspace(workspace, 'tokio #japón')[0]?.boards).toEqual([{ boardId: second, title: 'Ideas' }]);
    // Todas las palabras deben aparecer; el Markdown «#» del texto no es una etiqueta.
    expect(searchWorkspace(workspace, 'kioto tokio')).toEqual([]);
    ok(await editCardContent(storage, id, kioto, { content: 'Escribo #japon en el texto' }));
    expect(searchWorkspace(ok(await storage.open(id)), '#japon').map((result) => result.cardId)).toEqual([tokio]);
    expect(searchWorkspace(workspace, '   ')).toEqual([]);
  });

  it('las tarjetas en la Papelera no aparecen', async () => {
    const { storage, id, kioto } = await project();
    ok(await moveCardToTrash(storage, id, kioto));
    expect(searchWorkspace(ok(await storage.open(id)), 'kioto')).toEqual([]);
  });
});
