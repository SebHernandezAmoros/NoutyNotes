import { DESKTOP_GRID, archiveBoard, archiveCard, restoreArchivedBoard } from '@noutynotes/domain';
import type { BoardId, CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const at = '2026-09-26T10:00:00.000Z';

describe('.nouty/archive.yaml (ADR 0023)', () => {
  it('solo existe con tarjetas archivadas; ida y vuelta con fecha, instantánea y relaciones', () => {
    const source = workspaceFixture();
    const plain = ok(serializeWorkspace(source));
    expect(plain['.nouty/archive.yaml']).toBeUndefined();
    const archived = ok(archiveCard(source, source.cards[0]!.id as CardId, at));
    const files = ok(serializeWorkspace(archived, plain));
    expect(files['.nouty/archive.yaml']).toContain('schemaVersion: 1');
    // Entre comillas: sin ellas, YAML la leería como fecha y no como texto.
    expect(files[".nouty/archive.yaml"]).toContain(`archivedAt: "${at}"`);
    expect(files[`cards/${source.cards[0]!.id}.md`]).toBeUndefined();
    const parsed = ok(parseWorkspace(files));
    expect(parsed.archive).toEqual(archived.archive);
    // Sin archivados otra vez, el archivo desaparece.
    const { archive: _archive, ...restored } = archived;
    expect(ok(serializeWorkspace({ ...restored, cards: source.cards, boards: source.boards, layouts: source.layouts, relations: source.relations }, files))['.nouty/archive.yaml']).toBeUndefined();
  });

  it('tablero archivado como unidad (ADR 0039): v4 solo con archivedBoards; ida y vuelta; v4 rechazada por un lector que solo admite hasta v3', () => {
    const source = workspaceFixture();
    // «research» solo tiene idea-a (también en «overview»): una unidad de un tablero.
    const archived = ok(archiveBoard(source, 'research' as BoardId, at));
    const files = ok(serializeWorkspace(archived));
    expect(files['.nouty/archive.yaml']).toContain('schemaVersion: 4');
    const parsed = ok(parseWorkspace(files));
    expect(parsed.archivedBoards).toEqual(archived.archivedBoards);
    expect(parsed.archive).toEqual(archived.archive);

    // Restaurar el tablero deja archivedBoards vacío: el archivo vuelve a una versión anterior.
    const restored = ok(restoreArchivedBoard(archived, 'research' as BoardId, DESKTOP_GRID)).workspace;
    const filesAfter = ok(serializeWorkspace(restored, files));
    expect(filesAfter['.nouty/archive.yaml']).toBeUndefined();

    // Una v4 en un lector que solo admite hasta v3 (ya no aplica aquí, pero comprueba el aviso de versión).
    const tooNew = (files['.nouty/archive.yaml'] ?? '').replace('schemaVersion: 4', 'schemaVersion: 5');
    const rejected = parseWorkspace({ ...files, '.nouty/archive.yaml': tooNew });
    expect(rejected.ok).toBe(false);
  });

  it('una fecha inválida o un ID que ya es una tarjeta activa es un documento inválido', () => {
    const source = workspaceFixture();
    const files = ok(serializeWorkspace(ok(archiveCard(source, source.cards[0]!.id as CardId, at))));
    const text = files['.nouty/archive.yaml'] ?? '';
    expect(parseWorkspace({ ...files, '.nouty/archive.yaml': text.replace(at, 'ayer') }).ok).toBe(false);
    // La archivada pasa a llamarse como una tarjeta activa: ID duplicado.
    const clash = parseWorkspace({ ...files, '.nouty/archive.yaml': text.replace(`id: ${source.cards[0]!.id}\n`, `id: ${source.cards[1]!.id}\n`) });
    expect(clash.ok ? [] : clash.issues.map((issue) => issue.code)).toContain('duplicate-id');
  });
});
