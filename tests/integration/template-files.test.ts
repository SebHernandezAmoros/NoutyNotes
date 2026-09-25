import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../packages/domain/src/__fixtures__/grid';
import { assertValid, importTemplate, instantiateTemplate } from '../../packages/domain/src/index';
import type { WorkspaceId } from '../../packages/domain/src/index';
import { parseTemplate, parseWorkspace, serializeTemplate, serializeWorkspace } from '../../packages/storage/src/index';
import type { StorageResult, TextFiles } from '../../packages/storage/src/index';

function valueOf<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe.each(['gdd', 'storyboard', 'research'])('plantilla local %s en formato de archivos', (name) => {
  const fixtureUrl = new URL(`../fixtures/templates/${name}.json`, import.meta.url);
  const template = deepFreeze(assertValid(importTemplate(readFileSync(fixtureUrl, 'utf8'))));
  const assets: TextFiles = Object.fromEntries((template.assets ?? []).map((path) => [path, readFileSync(new URL(path, fixtureUrl), 'utf8')]));

  it('hace round-trip completo y conserva README y assets de texto', () => {
    const files = valueOf(serializeTemplate(template));
    expect(files['README.md']).toBe(template.readme);
    expect(valueOf(parseTemplate(files))).toEqual(template);
    const withAssets = { ...files, ...assets };
    expect(valueOf(serializeTemplate(template, withAssets))).toEqual(withAssets);
  });

  it('la plantilla leída de archivos instancia un workspace que también hace round-trip', () => {
    const parsed = valueOf(parseTemplate(valueOf(serializeTemplate(template))));
    const { workspace } = assertValid(instantiateTemplate(parsed, { workspaceId: `${name}-project` as WorkspaceId, name: `Proyecto ${name}`, namespace: 'p' }));
    const files = valueOf(serializeWorkspace(workspace));
    expect(valueOf(parseWorkspace(files))).toEqual(workspace);
    expect(valueOf(serializeWorkspace(workspace, files))).toEqual(files);
  });
});
