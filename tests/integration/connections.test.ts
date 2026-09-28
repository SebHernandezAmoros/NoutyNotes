import { describe, expect, it } from 'vitest';

import { addCardToBoard, connectCards, createEmptyWorkspaceNamed, updateConnection } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('Contrato e interacción de conexiones (ADR 0034)', () => {
  it('conectar con un tipo nuevo lo añade a relationTypes; sin indicarlo, sigue siendo «Relacionada con»', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Mapa'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'A' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'B' }));
    const c = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'C' }));

    const r1 = ok(await connectCards(storage, id, { from: a, to: b }));
    const r2 = ok(await connectCards(storage, id, { from: b, to: c, typeLabel: 'Bloquea', label: 'hasta el jueves', arrow: 'both' }));
    const workspace = ok(await storage.open(id));
    expect(workspace.relationTypes.map((type) => type.label)).toEqual(['Relacionada con', 'Bloquea']);
    expect(workspace.relations.find((relation) => relation.id === r1)).toMatchObject({ typeId: 'relacionada' });
    expect(workspace.relations.find((relation) => relation.id === r2)).toMatchObject({ label: 'hasta el jueves', arrow: 'both' });

    // Un segundo «Bloquea» reutiliza el mismo tipo: no se duplica.
    ok(await connectCards(storage, id, { from: a, to: c, typeLabel: 'Bloquea' }));
    expect(ok(await storage.open(id)).relationTypes.map((type) => type.label)).toEqual(['Relacionada con', 'Bloquea']);
  });

  it('editar tipo, rótulo y flecha de una conexión existente, en una transacción', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Mapa'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'A' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'B' }));
    const r = ok(await connectCards(storage, id, { from: a, to: b }));

    ok(await updateConnection(storage, id, r, { typeLabel: 'Depende de', label: 'crítico', arrow: 'none' }));
    const workspace = ok(await storage.open(id));
    expect(workspace.relationTypes.map((type) => type.label)).toContain('Depende de');
    expect(workspace.relations.find((relation) => relation.id === r)).toMatchObject({ label: 'crítico', arrow: 'none' });

    // Una conexión que no existe falla y no cambia nada.
    const before = ok(await storage.open(id));
    expect((await updateConnection(storage, id, 'no-existe' as typeof r, { arrow: 'both' })).ok).toBe(false);
    expect(ok(await storage.open(id))).toEqual(before);
  });
});
