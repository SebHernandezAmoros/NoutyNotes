import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertValid, DESKTOP_GRID, duplicateTemplate, exportTemplate, getOutgoingRelations,
  importTemplate, instantiateTemplate, MOBILE_GRID, projectLayout, validateGridLayout, validateTemplate, validateWorkspace,
} from '../../packages/domain/src/index';
import type { TemplateId, WorkspaceId } from '../../packages/domain/src/index';
import { deepFreeze } from '../../packages/domain/src/__fixtures__/grid';

describe.each(['gdd', 'storyboard', 'research'])('flujo de plantilla local %s', name => {
  const fixtureUrl = new URL(`../fixtures/templates/${name}.json`, import.meta.url);
  const template = deepFreeze(assertValid(importTemplate(readFileSync(fixtureUrl, 'utf8'))));

  it('importa, instancia y genera tipos, campos, relaciones y layouts válidos', () => {
    const result = assertValid(instantiateTemplate(template, { workspaceId: `${name}-project` as WorkspaceId, name: `Proyecto ${name}`, namespace: 'instance' }));
    const workspace = result.workspace;
    expect(validateWorkspace(workspace).ok).toBe(true);
    expect(workspace.cards.length).toBeGreaterThan(0);
    expect(workspace.relations.length).toBeGreaterThan(0);
    expect(workspace.layouts.length).toBeGreaterThan(0);
    workspace.cardTypes.forEach((type, i) => expect(type.fields).toEqual(template.cardTypes[i]!.fields));
    for (const relation of workspace.relations) {
      expect(assertValid(getOutgoingRelations(workspace, relation.from))).toContainEqual(relation);
      expect(workspace.cards.some(card => card.id === relation.to)).toBe(true);
    }
    for (const layout of workspace.layouts) {
      expect(validateGridLayout(layout, DESKTOP_GRID).ok).toBe(true);
      const mobile = assertValid(projectLayout(layout, DESKTOP_GRID, MOBILE_GRID));
      expect(mobile.items.map(item => item.cardId).sort()).toEqual(layout.placements.map(p => p.cardId).sort());
    }
    expect(result.readme).toBe(template.readme);
    expect(result.preview).toBe(template.preview);
    for (const path of result.assets) {
      const file = readFileSync(new URL(path, fixtureUrl), 'utf8');
      expect(file.startsWith('<svg')).toBe(true);
    }
  });

  it('exporta, reimporta y duplica sin perder datos ni compartir referencias', () => {
    const serialized = assertValid(exportTemplate(template));
    const restored = assertValid(importTemplate(serialized));
    expect(restored).toEqual(template);
    expect(assertValid(exportTemplate(restored))).toBe(serialized);
    const copy = assertValid(duplicateTemplate(restored, { manifest: { ...restored.template, id: `${name}-copy` as TemplateId }, namespace: 'dup' }));
    expect(validateTemplate(copy).ok).toBe(true);
    expect(copy.cards![0]!.fields).not.toBe(restored.cards![0]!.fields);
    expect(copy.cards![0]!.fields).toEqual(restored.cards![0]!.fields);
    const a = assertValid(instantiateTemplate(copy, { workspaceId: 'a' as WorkspaceId, name: 'A', namespace: 'a' }));
    const b = assertValid(instantiateTemplate(copy, { workspaceId: 'b' as WorkspaceId, name: 'B', namespace: 'b' }));
    expect(validateWorkspace(a.workspace).ok).toBe(true);
    expect(validateWorkspace(b.workspace).ok).toBe(true);
    expect(a.workspace.cards.some(card => b.workspace.cards.some(other => other.id === card.id))).toBe(false);
    expect(assertValid(exportTemplate(template))).toBe(serialized);
  });
});
