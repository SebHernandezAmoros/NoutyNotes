import { trashCard } from '@noutynotes/domain';
import type { CardId, Workspace } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const tagged = (source: Workspace, tags: readonly string[]): Workspace =>
  ({ ...source, cards: source.cards.map((card, index) => (index === 0 ? { ...card, tags } : card)) });

describe('etiquetas en cards/<id>.md (ADR 0019)', () => {
  it('solo una tarjeta con etiquetas pasa a schemaVersion 2; las demás conservan sus bytes v1', () => {
    const source = workspaceFixture();
    const before = ok(serializeWorkspace(source));
    const withTags = tagged(source, ['idea', 'viaje/japón']);
    const files = ok(serializeWorkspace(withTags, before));
    const first = `cards/${source.cards[0]?.id}.md`;
    const second = `cards/${source.cards[1]?.id}.md`;
    expect(files[first]).toContain('schemaVersion: 2');
    expect(files[first]).toMatch(/tags:\n\s+- idea\n\s+- viaje\/japón\n/);
    expect(files[second]).toBe(before[second]);
    expect(ok(parseWorkspace(files)).cards[0]?.tags).toEqual(['idea', 'viaje/japón']);
    // Quitar la última etiqueta devuelve la tarjeta a v1, sin la clave.
    const cleared = ok(serializeWorkspace(source, files));
    expect(cleared[first]).toBe(before[first]);
  });

  it('una v1 con etiquetas o una v2 sin ellas es un documento inválido, y las etiquetas deben estar normalizadas', () => {
    const source = workspaceFixture();
    const files = ok(serializeWorkspace(tagged(source, ['idea'])));
    const first = `cards/${source.cards[0]?.id}.md`;
    const text = files[first] ?? '';
    const paths = (candidate: string) => {
      const parsed = parseWorkspace({ ...files, [first]: candidate });
      return parsed.ok ? [] : parsed.issues.map((issue) => `${issue.code}@${issue.path}`);
    };
    expect(paths(text.replace('schemaVersion: 2', 'schemaVersion: 1'))).not.toEqual([]);
    expect(paths(text.replace(/tags:\n\s+- idea\n/, ''))).not.toEqual([]);
    expect(paths(text.replace('- idea', '- Idea'))).not.toEqual([]);
  });

  it('la Papelera conserva las etiquetas y pasa a v2 si alguna tarjeta retirada las tiene', () => {
    const source = tagged(workspaceFixture(), ['idea']);
    const trashed = ok(trashCard(source, source.cards[0]?.id as CardId));
    const files = ok(serializeWorkspace(trashed));
    expect(files['.nouty/trash.yaml']).toContain('schemaVersion: 2');
    expect(ok(parseWorkspace(files)).trash?.[0]?.card.tags).toEqual(['idea']);
  });
});
