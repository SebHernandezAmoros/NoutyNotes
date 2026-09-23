import { describe, expect, it } from 'vitest';

import { problems, unsafe, validWorkspace } from './__fixtures__/workspace';
import { CURRENT_SCHEMA_VERSION, isSupportedSchemaVersion } from './schema-version';
import type { Workspace } from './workspace/workspace';
import { validateWorkspace } from './workspace/workspace';

describe('versión de esquema', () => {
  it('admite la versión actual', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(isSupportedSchemaVersion(1)).toBe(true);
    expect(validateWorkspace(validWorkspace()).ok).toBe(true);
  });

  it.each([0, 2, 1.5, '1', null, undefined])('rechaza %s y detiene la validación', (version) => {
    // El resto también es inválido, pero no se interpreta con reglas de otra versión.
    const workspace = unsafe<Workspace>({ ...validWorkspace(), schemaVersion: version, id: 'Mal ID', cards: 'x' });
    expect(isSupportedSchemaVersion(version)).toBe(false);
    expect(problems(validateWorkspace(workspace))).toEqual(['unsupported-schema-version@schemaVersion']);
  });
});
