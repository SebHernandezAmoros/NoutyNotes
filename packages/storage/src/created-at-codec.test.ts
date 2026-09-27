import type { Workspace } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const at = '2026-09-26T08:30:00.000Z';
const dated = (source: Workspace, extra: Record<string, unknown>): Workspace =>
  ({ ...source, cards: source.cards.map((card, index) => (index === 0 ? { ...card, ...extra } : card)) }) as Workspace;

describe('fecha de creación en cards/<id>.md (ADR 0024)', () => {
  it('solo la tarjeta con createdAt pasa a v3 (con o sin etiquetas); las demás conservan sus bytes', () => {
    const source = workspaceFixture();
    const before = ok(serializeWorkspace(source));
    const first = `cards/${source.cards[0]?.id}.md`;
    const second = `cards/${source.cards[1]?.id}.md`;
    const files = ok(serializeWorkspace(dated(source, { createdAt: at }), before));
    expect(files[first]).toContain('schemaVersion: 3');
    expect(files[first]).toContain(`createdAt: "${at}"`);
    expect(files[second]).toBe(before[second]);
    expect(ok(parseWorkspace(files)).cards[0]?.createdAt).toBe(at);
    const both = ok(serializeWorkspace(dated(source, { createdAt: at, tags: ['idea'] }), before));
    expect(both[first]).toContain('schemaVersion: 3');
    expect(ok(parseWorkspace(both)).cards[0]).toMatchObject({ createdAt: at, tags: ['idea'] });
  });

  it('una v2 con fecha, una v3 sin ella o una fecha no válida son documentos inválidos', () => {
    const source = workspaceFixture();
    const files = ok(serializeWorkspace(dated(source, { createdAt: at })));
    const first = `cards/${source.cards[0]?.id}.md`;
    const text = files[first] ?? '';
    const invalid = (candidate: string) => !parseWorkspace({ ...files, [first]: candidate }).ok;
    expect(invalid(text.replace('schemaVersion: 3', 'schemaVersion: 2'))).toBe(true);
    expect(invalid(text.replace(`createdAt: "${at}"\n`, ''))).toBe(true);
    expect(invalid(text.replace(at, 'ayer'))).toBe(true);
  });
});
