import { trashCard } from '@noutynotes/domain';
import type { CardId, Workspace } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('Papelera en el formato v1: .nouty/trash.yaml (ADR 0015)', () => {
  it('declara v2 si una tarjeta retirada conserva una posición negativa', () => {
    const source = workspaceFixture();
    const moved: Workspace = { ...source, layouts: source.layouts.map((layout) => ({ ...layout, placements: layout.placements.map((placement, index) => index === 0
      ? { ...placement, rect: { ...placement.rect, x: -4, y: -2 } } : placement) })) };
    const trashed = ok(trashCard(moved, moved.cards[0]?.id as CardId));
    const files = ok(serializeWorkspace(trashed));
    expect(files['.nouty/trash.yaml']).toContain('schemaVersion: 2');
    expect(ok(parseWorkspace(files)).trash).toEqual(trashed.trash);
    const mislabeled = { ...files, '.nouty/trash.yaml': files['.nouty/trash.yaml']?.replace('schemaVersion: 2', 'schemaVersion: 1') ?? '' };
    expect(parseWorkspace(mislabeled).ok).toBe(false);
  });
  it('sin Papelera no hay archivo; con ella, ida y vuelta exacta y la tarjeta deja de tener cards/<id>.md', () => {
    const source = workspaceFixture();
    expect(Object.keys(ok(serializeWorkspace(source)))).not.toContain('.nouty/trash.yaml');

    const withMarkdown: Workspace = { ...source, cards: source.cards.map((card, index) => (index === 0 ? { ...card, content: '# Título\r\n\n- uno: «dos»\n' } : card)) };
    const trashed = ok(trashCard(withMarkdown, withMarkdown.cards[0]?.id as CardId));
    const files = ok(serializeWorkspace(trashed));
    // Claves ordenadas como el resto de documentos v1.
    expect(files['.nouty/trash.yaml']).toMatch(/^items:[\s\S]*\nschemaVersion: 1\n$/);
    expect(Object.keys(files)).not.toContain(`cards/${withMarkdown.cards[0]?.id}.md`);
    const reopened = ok(parseWorkspace(files));
    expect(reopened.trash).toEqual(trashed.trash);
    expect(reopened.trash?.[0]?.card.content).toBe('# Título\r\n\n- uno: «dos»\n');

    // Vaciar la Papelera quita el archivo.
    expect(Object.keys(ok(serializeWorkspace({ ...trashed, trash: [] }, files)))).not.toContain('.nouty/trash.yaml');
  });

  it('claves cerradas: una clave desconocida en la Papelera se rechaza con su ruta', () => {
    const source = workspaceFixture();
    const files = ok(serializeWorkspace(ok(trashCard(source, source.cards[0]?.id as CardId))));
    const tampered = { ...files, '.nouty/trash.yaml': `${files['.nouty/trash.yaml']}extra: true\n` };
    const parsed = parseWorkspace(tampered);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((issue) => issue.path)).toContain('.nouty/trash.yaml#extra');
  });
});
