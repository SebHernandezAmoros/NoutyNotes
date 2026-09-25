import { describe, expect, it } from 'vitest';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { valueOf } from './__fixtures__/helpers';
import { buildZip, entriesOf } from './__fixtures__/zip';
import type { FixtureEntry } from './__fixtures__/zip';
import { ARCHIVE_LIMITS, readWorkspaceArchive } from './workspace-archive';
import { serializeWorkspace } from './workspace-codec';

const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
const base = () => entriesOf(valueOf(serializeWorkspace(validWorkspace())));

describe('motivo exacto de rechazo de cada entrada ZIP hostil (fase 9)', () => {
  it.each<[string, Partial<FixtureEntry>, string, RegExp]>([
    ['cifrada', { flags: 1 }, 'invalid-archive@assets/a.png', /cifradas/],
    ['método no admitido', { method: 12 }, 'invalid-archive@assets/a.png', /Método de compresión/],
    ['CRC incorrecto', { crc: 1234 }, 'invalid-archive@assets/a.png', /CRC-32/],
    ['enlace simbólico', { versionMadeBy: 0x031e, externalAttributes: (0o120777 << 16) >>> 0 }, 'invalid-archive@assets/a.png', /simbólicos/],
    ['ZIP64', { declaredSize: 0xffffffff }, 'invalid-archive@assets/a.png', /ZIP64/],
    ['cabecera local distinta', { localName: 'otro.png' }, 'invalid-archive@assets/a.png', /cabecera local/],
  ])('%s', (_case, override, expected, message) => {
    const result = readWorkspaceArchive(buildZip([...base(), { name: 'assets/a.png', data: binary, ...override }]), ARCHIVE_LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(({ code, path }) => `${code}@${path}`)).toEqual([expected]);
    expect(result.issues[0]?.message).toMatch(message);
  });
});

describe('cabecera local incoherente con el directorio central (auditoría de fase 9)', () => {
  const zipWith = (override: Partial<FixtureEntry>) =>
    readWorkspaceArchive(buildZip([...base(), { name: 'assets/a.png', data: binary, ...override }]), ARCHIVE_LIMITS);
  const reasons = (result: ReturnType<typeof zipWith>) => (result.ok ? [] : result.issues.map(({ code, path, message }) => `${code}@${path}: ${message}`));

  it.each<[string, Partial<FixtureEntry>]>([
    ['cifrado solo en la cabecera local', { localFlags: 1 }],
    ['método distinto (local deflate, central stored)', { method: 0, localMethod: 8 }],
    ['método distinto (local stored, central deflate)', { localMethod: 0 }],
    ['CRC local distinto sin descriptor de datos', { localCrc: 1234 }],
    ['tamaño comprimido local distinto sin descriptor', { localCompressedSize: 1 }],
    ['tamaño local distinto sin descriptor', { localSize: 9_999_999 }],
    ['bit de descriptor solo en la cabecera local', { localFlags: 0x8 }],
  ])('rechaza %s', (_case, override) => {
    expect(reasons(zipWith(override))).toEqual([
      'invalid-archive@assets/a.png: La cabecera local no coincide con el directorio central.',
    ]);
  });

  it('rechaza datos que se solapan con el directorio central', () => {
    expect(reasons(zipWith({ method: 0, compressedSizeOverride: 900, declaredSize: 900 }))).toEqual([
      'invalid-archive@assets/a.png: Los datos de la entrada se salen de su zona del ZIP.',
    ]);
  });

  it('acepta ZIP válidos con descriptor de datos (bit 3), en stored y en deflate', () => {
    for (const method of [0, 8]) {
      const result = zipWith({ method, dataDescriptor: true });
      expect(reasons(result)).toEqual([]);
      expect(result.ok ? result.value.assets['assets/a.png'] : null).toEqual(binary);
    }
  });
});
