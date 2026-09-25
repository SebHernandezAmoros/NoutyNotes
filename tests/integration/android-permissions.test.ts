import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// La configuración se resuelve con la misma herramienta que usa `expo prebuild`, incluido app.config.ts.
const projectRoot = fileURLToPath(new URL('../../apps/noutynotes/', import.meta.url));
const { getConfig } = createRequire(`${projectRoot}package.json`)('expo/config') as {
  getConfig(root: string, options: { skipSDKVersionRequirement: boolean }): { exp: { android?: { blockedPermissions?: string[] } } };
};

describe('permisos Android (ADR 0012)', () => {
  it('bloquea los permisos de almacenamiento del manifiesto: el SAF no los necesita', () => {
    const { exp } = getConfig(projectRoot, { skipSDKVersionRequirement: true });
    expect(exp.android?.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']),
    );
  });
});
