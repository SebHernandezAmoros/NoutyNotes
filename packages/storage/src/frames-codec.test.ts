import type { Workspace } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import { validWorkspace as workspaceFixture } from '../../domain/src/__fixtures__/workspace';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const LAYOUT = '.nouty/layout.yaml';
// Un marco lejos de las tarjetas del fixture: no pisa ninguna.
const framed = (source: Workspace): Workspace => ({
  ...source,
  layouts: source.layouts.map((layout, index) => (index === 0 ? { ...layout, frames: [{ id: 'marco-1', title: 'Viaje', rect: { x: 40, y: 40, w: 4, h: 3 } }] } : layout)),
});

describe('marcos en .nouty/layout.yaml (ADR 0027)', () => {
  it('con marcos el layout pasa a v3 y vuelve igual; sin ellos conserva sus bytes', () => {
    const source = workspaceFixture();
    const before = ok(serializeWorkspace(source));
    expect(before[LAYOUT]).not.toContain('schemaVersion: 3');
    const files = ok(serializeWorkspace(framed(source), before));
    expect(files[LAYOUT]).toContain('schemaVersion: 3');
    expect(files[LAYOUT]).toContain('title: Viaje');
    expect(ok(parseWorkspace(files)).layouts[0]?.frames).toEqual([{ id: 'marco-1', title: 'Viaje', rect: { x: 40, y: 40, w: 4, h: 3 } }]);
    // Quitar el marco devuelve los bytes de antes.
    expect(ok(serializeWorkspace(source, files))[LAYOUT]).toBe(before[LAYOUT]);
  });

  it('marcos en una versión anterior, sin título o solapados son documentos inválidos', () => {
    const files = ok(serializeWorkspace(framed(workspaceFixture())));
    const text = files[LAYOUT] ?? '';
    const invalid = (candidate: string) => !parseWorkspace({ ...files, [LAYOUT]: candidate }).ok;
    expect(invalid(text.replace('schemaVersion: 3', 'schemaVersion: 2'))).toBe(true);
    expect(invalid(text.replace('title: Viaje', 'title: ""'))).toBe(true);
    expect(invalid(text.replace('schemaVersion: 3', 'schemaVersion: 4'))).toBe(true);
  });
});
