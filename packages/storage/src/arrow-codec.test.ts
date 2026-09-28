import type { Workspace } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const RELATIONS = '.nouty/relations.yaml';
const arrowed = (source: Workspace, arrow: string): Workspace => ({
  ...source, relations: source.relations.map((relation, index) => (index === 0 ? { ...relation, arrow } : relation)),
} as Workspace);

describe('estilo de flecha en .nouty/relations.yaml (ADR 0034)', () => {
  it('con una flecha distinta de «forward» pasa a v2 y vuelve igual; «forward» explícito no fuerza v2', () => {
    const source = workspaceFixture();
    const before = ok(serializeWorkspace(source));
    expect(before[RELATIONS]).toContain('schemaVersion: 1');
    const files = ok(serializeWorkspace(arrowed(source, 'both'), before));
    expect(files[RELATIONS]).toContain('schemaVersion: 2');
    expect(files[RELATIONS]).toContain('arrow: both');
    expect(ok(parseWorkspace(files)).relations[0]?.arrow).toBe('both');
    // «forward» es el valor por defecto: no cambia el significado ni fuerza v2.
    expect(ok(serializeWorkspace(arrowed(source, 'forward'), before))[RELATIONS]).toBe(before[RELATIONS]);
    // Quitar la flecha explícita devuelve los bytes de antes.
    expect(ok(serializeWorkspace(source, files))[RELATIONS]).toBe(before[RELATIONS]);
  });

  it('una flecha inválida o una v2 en un lector v1 son documentos inválidos', () => {
    const files = ok(serializeWorkspace(arrowed(workspaceFixture(), 'both')));
    const text = files[RELATIONS] ?? '';
    const invalid = (candidate: string) => !parseWorkspace({ ...files, [RELATIONS]: candidate }).ok;
    expect(invalid(text.replace('schemaVersion: 2', 'schemaVersion: 1'))).toBe(true);
    expect(invalid(text.replace('arrow: both', 'arrow: diagonal'))).toBe(true);
    expect(invalid(text.replace('schemaVersion: 2', 'schemaVersion: 3'))).toBe(true);
  });
});
