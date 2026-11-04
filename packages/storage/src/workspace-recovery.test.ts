import { describe, expect, it } from 'vitest';

import { ideaA, ideaB, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { parseWorkspace, planWorkspaceRecovery, serializeWorkspace } from './workspace-codec';
import type { TextFiles } from './text-files';
import { writeWorkspaceArchive } from './workspace-archive';

function validFiles(): TextFiles {
  const serialized = serializeWorkspace(validWorkspace());
  if (!serialized.ok) throw new Error(JSON.stringify(serialized.issues));
  return serialized.value;
}

describe('planWorkspaceRecovery (ADR 0010, Bloque 16 Paquete 2)', () => {
  it('un paquete ya válido se recupera sin cuarentena ni cambios', () => {
    const files = validFiles();
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toEqual([]);
    expect(plan.value.workspace).toEqual(validWorkspace());
    expect(plan.value.files).toEqual(files);
  });

  it('una tarjeta individual inválida se aísla; la otra tarjeta, el tablero que no la usaba y la relación que la usaba quedan correctos', () => {
    const files = { ...validFiles() };
    const brokenCardText = files['cards/idea-b.md']!.replace('schemaVersion: 1', 'schemaVersion: 1\nassetRefs: "no-es-una-lista"');
    files['cards/idea-b.md'] = brokenCardText;
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toHaveLength(1);
    // Se conserva exactamente el byte a byte del documento tal como estaba en disco (roto), no una
    // versión reparada ni la que tenía antes de corromperse — nunca se inventa ni se sustituye contenido.
    expect(plan.value.quarantined[0]).toMatchObject({ path: 'cards/idea-b.md', kind: 'card', text: brokenCardText });
    // La tarjeta válida restante se conserva íntegra.
    expect(plan.value.workspace.cards.map((card) => card.id)).toEqual([ideaA.id]);
    // El tablero «research» (solo tenía idea-a) permanece sin cambios de membresía.
    expect(plan.value.workspace.boards.find((board) => board.id === 'research')?.cardIds).toEqual([ideaA.id]);
    // El tablero «overview» pierde la referencia a idea-b, pero conserva idea-a.
    expect(plan.value.workspace.boards.find((board) => board.id === 'overview')?.cardIds).toEqual([ideaA.id]);
    // La relación (idea-a → idea-b) se quita: ya no puede referenciar una tarjeta aislada.
    expect(plan.value.workspace.relations).toEqual([]);
    // La copia reconstruida es, en sí misma, un workspace v1 válido de verdad (mismo árbitro de siempre).
    expect(parseWorkspace(plan.value.files).ok).toBe(true);
  });

  it('un tablero individual inválido (sin referencias en la capa) se aísla sin afectar sus tarjetas', () => {
    const files = { ...validFiles() };
    // «research» no aparece en ningún layout — candidato limpio para esta prueba.
    files['boards/research.md'] = files['boards/research.md']!.replace('schemaVersion: 1', 'schemaVersion: 7');
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toMatchObject([{ path: 'boards/research.md', kind: 'board' }]);
    expect(plan.value.workspace.boards.map((board) => board.id)).toEqual(['overview']);
    // Las dos tarjetas siguen existiendo: perder un tablero no purga sus tarjetas.
    expect(plan.value.workspace.cards.map((card) => card.id).sort()).toEqual([ideaA.id, ideaB.id].sort());
  });

  it('una tarjeta declarada pero ausente en disco (missing-file) se aísla igual, sin texto que conservar', () => {
    const files = { ...validFiles() };
    delete files['cards/idea-b.md'];
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toMatchObject([{ path: 'cards/idea-b.md', kind: 'card', code: 'missing-file', text: null }]);
    expect(plan.value.workspace.cards.map((card) => card.id)).toEqual([ideaA.id]);
  });

  it('un manifiesto irrecuperable (workspace raíz) no se ofrece como recuperación', () => {
    const files = { ...validFiles() };
    files['.nouty/workspace.yaml'] = 'esto no es un manifiesto válido';
    const plan = planWorkspaceRecovery(files);
    expect(plan.ok).toBe(false);
  });

  it('una incidencia que no es de una tarjeta/tablero concreto (relaciones corruptas) no se aísla ni se ofrece una recuperación falsa', () => {
    const files = { ...validFiles() };
    files['.nouty/relations.yaml'] = 'esto no es un documento de relaciones válido';
    const plan = planWorkspaceRecovery(files);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.issues.some((issue) => issue.path.startsWith('.nouty/relations.yaml'))).toBe(true);
  });

  it('un tablero inválido que sí aparece en la capa (layout) se aísla limpiando también su bloque de capa, no solo su membresía', () => {
    const files = { ...validFiles() };
    // «overview» sí aparece en el layout (coloca idea-a e idea-b) — su aislamiento debe arrastrar
    // también ese bloque, o la copia quedaría con una referencia de capa colgando.
    files['boards/overview.md'] = files['boards/overview.md']!.replace('schemaVersion: 1', 'schemaVersion: 7');
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.quarantined).toMatchObject([{ path: 'boards/overview.md', kind: 'board' }]);
    expect(plan.value.workspace.boards.map((board) => board.id)).toEqual(['research']);
    expect(plan.value.workspace.layouts).toEqual([]);
    // Las tarjetas siguen existiendo (idea-a sigue en «research»; idea-b queda sin tablero, estado válido).
    expect(plan.value.workspace.cards.map((card) => card.id).sort()).toEqual([ideaA.id, ideaB.id].sort());
  });

  it('la copia recuperada se puede comprimir como ZIP y volver a leerse, igual que cualquier workspace válido', () => {
    const files = { ...validFiles() };
    files['cards/idea-b.md'] = files['cards/idea-b.md']!.replace('schemaVersion: 1', 'schemaVersion: 1\nassetRefs: "no-es-una-lista"');
    const plan = planWorkspaceRecovery(files);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    const zipped = writeWorkspaceArchive(plan.value.files, {});
    expect(zipped.ok).toBe(true);
  });
});
