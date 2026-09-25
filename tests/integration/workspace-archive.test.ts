import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { addCardToBoard, connectCards, editCardContent, moveCardOnBoard } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, WorkspaceId } from '../../packages/domain/src/index';
import { ArchiveStorage, readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/index';
import type { StorageResult, TextFiles } from '../../packages/storage/src/index';

const id = (value: string) => value as WorkspaceId;

function ok<T>(result: WorkspaceStorageResult<T> | StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Fixture editado a mano (comentarios, CRLF, README y asset de texto), leído como bytes. */
function fixture(): { files: TextFiles; assets: Record<string, Uint8Array> } {
  const root = fileURLToPath(new URL('../fixtures/workspace-v1-edited/', import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  for (const path of walk(root)) {
    const key = relative(root, path).replaceAll('\\', '/');
    if (key.startsWith('assets/')) assets[key] = new Uint8Array(readFileSync(path));
    else files[key] = readFileSync(path, 'utf8');
  }
  // Un asset binario real además del de texto del fixture.
  assets['assets/images/pixel.png'] = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff, 0xfe]);
  return { files, assets };
}

describe('fallback ZIP con los casos de uso (fase 9)', () => {
  it('importar → editar tarjetas, Markdown, layout y relaciones → exportar → importar en otra sesión, sin pérdidas', async () => {
    const source = fixture();
    const first = new ArchiveStorage();
    ok(await first.importArchive(ok(writeWorkspaceArchive(source.files, source.assets))));
    const cardId = ok(await addCardToBoard(first, id('demo'), { kind: 'note' }));
    ok(await editCardContent(first, id('demo'), cardId, { title: 'Nueva', content: '## Markdown\r\n\n- [x] literal\n' }));
    ok(await moveCardOnBoard(first, id('demo'), { boardId: 'overview' as BoardId, cardId, to: { x: 0, y: 6 } }));
    ok(await connectCards(first, id('demo'), { from: cardId, to: 'idea-a' as never }));
    const edited = ok(await first.open(id('demo')));
    expect(first.hasUnexportedChanges(id('demo'))).toBe(true);

    const exported = ok(first.exportArchive(id('demo')));
    // Preparar el ZIP no demuestra que se guardó: sigue pendiente hasta la confirmación del usuario.
    expect(first.hasUnexportedChanges(id('demo'))).toBe(true);
    expect(ok(first.confirmExported(id('demo'), exported.revision))).toBe('confirmed');
    expect(first.hasUnexportedChanges(id('demo'))).toBe(false);

    // Otra sesión (otra pestaña o tras recargar): solo existe el ZIP.
    const second = new ArchiveStorage();
    expect(ok(await second.importArchive(exported.bytes))).toEqual({ summary: { id: 'demo', name: 'Demo' } });
    expect(ok(await second.open(id('demo')))).toEqual(edited);
    const reread = ok(readWorkspaceArchive(ok(second.exportArchive(id('demo'))).bytes));
    expect(reread.assets).toEqual(source.assets);
    expect(reread.files['README.md']).toBe(source.files['README.md']);
    // Los documentos que no cambiaron conservan sus bytes, incluidos comentarios y CRLF.
    expect(reread.files['cards/idea-b.md']).toBe(source.files['cards/idea-b.md']);
    expect(reread.workspace.cards.find((card) => card.id === cardId)?.content).toBe('## Markdown\r\n\n- [x] literal\n');
    expect(reread.workspace.relations.some((relation) => relation.from === cardId && relation.to === 'idea-a')).toBe(true);
    expect(reread.workspace.layouts[0]?.placements.find((placement) => placement.cardId === cardId)?.rect).toMatchObject({ x: 0, y: 6 });
  });
});
