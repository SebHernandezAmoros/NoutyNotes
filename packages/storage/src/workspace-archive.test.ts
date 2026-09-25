import { describe, expect, it } from 'vitest';

import { deflateSync } from 'fflate';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { valueOf } from './__fixtures__/helpers';
import { buildZip, crc32, entriesOf, text } from './__fixtures__/zip';
import type { FixtureEntry } from './__fixtures__/zip';
import type { StorageResult } from './issues';
import type { TextFiles } from './text-files';
import { ARCHIVE_LIMITS, readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import { serializeWorkspace } from './workspace-codec';

const files = (): TextFiles => ({ ...valueOf(serializeWorkspace(validWorkspace())), 'README.md': '# Demo\r\n' });
/** Bytes arbitrarios que no son UTF-8 válido: deben conservarse tal cual. */
const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
const assets = () => ({ 'assets/images/a.png': binary, 'assets/notas.txt': text('notas\n') });

function problems(result: StorageResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map(({ code, path }) => `${code}@${path}`);
}

function read(entries: readonly FixtureEntry[], limits = ARCHIVE_LIMITS) {
  return readWorkspaceArchive(buildZip(entries), limits);
}

describe('ZIP de workspace: exportar e importar (fase 9)', () => {
  it('ida y vuelta sin pérdidas: workspace, textos exactos y assets binarios', () => {
    const zip = valueOf(writeWorkspaceArchive(files(), assets()));
    const archive = valueOf(readWorkspaceArchive(zip));
    expect(archive.workspace).toEqual(validWorkspace());
    expect(archive.files).toEqual(files());
    expect(archive.assets).toEqual(assets());
    expect(Object.keys(archive.assets).sort()).toEqual(['assets/images/a.png', 'assets/notas.txt']);
  });

  it('la exportación es determinista y ordenada', () => {
    const first = valueOf(writeWorkspaceArchive(files(), assets()));
    expect(valueOf(writeWorkspaceArchive({ ...files() }, { ...assets() }))).toEqual(first);
  });

  it('lee ZIP de otras herramientas: método stored, carpeta envolvente y metadatos de sistema ignorados', () => {
    const entries: FixtureEntry[] = [
      { name: 'Mi espacio/', data: new Uint8Array(), method: 0 },
      ...entriesOf(files(), assets(), 'Mi espacio/').map((entry) => ({ ...entry, method: 0 })),
      { name: '__MACOSX/Mi espacio/._README.md', data: text('x') },
      { name: 'Mi espacio/.DS_Store', data: binary },
      { name: 'Mi espacio/assets/Thumbs.db', data: binary },
    ];
    const archive = valueOf(read(entries));
    expect(archive.files).toEqual(files());
    expect(archive.assets).toEqual(assets());
  });

  it('no inventa assets: un workspace sin assets exporta e importa sin ellos', () => {
    expect(valueOf(readWorkspaceArchive(valueOf(writeWorkspaceArchive(files(), {})))).assets).toEqual({});
  });
});

describe('ZIP hostiles o inválidos (fase 9)', () => {
  const base = () => entriesOf(files());
  it.each<[string, FixtureEntry, string]>([
    ['traversal', { name: '../fuera.md', data: text('x') }, 'invalid-path@../fuera.md'],
    ['traversal en assets', { name: 'assets/../../fuera.png', data: binary }, 'invalid-path@assets/../../fuera.png'],
    ['ruta absoluta', { name: '/etc/passwd', data: text('x') }, 'invalid-path@/etc/passwd'],
    ['unidad', { name: 'C:/x.png', data: binary }, 'invalid-path@C:/x.png'],
    ['barra invertida', { name: 'assets\\a.png', data: binary }, 'invalid-path@assets\\a.png'],
    ['archivo inesperado', { name: 'notes.txt', data: text('x') }, 'unexpected-file@notes.txt'],
  ])('%s', (_case, hostile, expected) => {
    const result = read([...base(), hostile]);
    expect(problems(result)).toContain(expected);
  });

  it('nombres repetidos, exactos o que solo difieren en mayúsculas', () => {
    expect(problems(read([...base(), { name: 'README.md', data: text('a') }, { name: 'README.md', data: text('b') }])))
      .toContain('path-collision@README.md');
    expect(problems(read([...base(), { name: 'assets/A.png', data: binary }, { name: 'assets/a.png', data: binary }])))
      .toContain('path-collision@assets/a.png');
  });

  it('nombres que no son UTF-8 válido', () => {
    expect(problems(read([...base(), { name: Uint8Array.from([0x61, 0x73, 0x73, 0x65, 0x74, 0x73, 0x2f, 0xff]), data: binary, flags: 0x800 }])))
      .toEqual(['invalid-path@entrada 8']);
  });

  it('documentos de texto que no son UTF-8 válido', () => {
    const [manifest, ...rest] = base();
    expect(problems(read([{ ...manifest!, data: Uint8Array.from([0xc3, 0x28]) }, ...rest]))).toEqual(['invalid-archive@.nouty/layout.yaml']);
  });

  it.each<[string, Partial<FixtureEntry>]>([
    ['cifrada', { flags: 1 }],
    ['método no admitido', { method: 12 }],
    ['CRC incorrecto', { crc: 1234 }],
    ['enlace simbólico', { versionMadeBy: 0x031e, externalAttributes: (0o120777 << 16) >>> 0 }],
    ['ZIP64', { declaredSize: 0xffffffff }],
    ['cabecera local distinta', { localName: 'otro.png' }],
  ])('entrada %s', (_case, override) => {
    const result = read([...base(), { name: 'assets/a.png', data: binary, ...override }]);
    expect(result.ok).toBe(false);
    expect(problems(result).some((found) => found.startsWith('invalid-archive@') || found.startsWith('limit-exceeded@'))).toBe(true);
  });

  it('no es un ZIP, está vacío o truncado', () => {
    expect(problems(readWorkspaceArchive(text('no es un zip')))).toEqual(['invalid-archive@archivo']);
    expect(problems(readWorkspaceArchive(new Uint8Array()))).toEqual(['invalid-archive@archivo']);
    const zip = buildZip(base());
    expect(problems(readWorkspaceArchive(zip.slice(0, zip.length - 10)))).toEqual(['invalid-archive@archivo']);
    expect(problems(readWorkspaceArchive(zip.slice(40)))).toEqual(['invalid-archive@archivo']);
  });

  it('falta el manifiesto', () => {
    expect(problems(read(base().filter((entry) => entry.name !== '.nouty/workspace.yaml')))).toContain('missing-file@.nouty/workspace.yaml');
  });

  it('límites de tamaño y cantidad antes de descomprimir', () => {
    const small = { ...ARCHIVE_LIMITS, maxEntries: 3 };
    expect(problems(read(base(), small))).toEqual(['limit-exceeded@archivo']);
    expect(problems(readWorkspaceArchive(buildZip(base()), { ...ARCHIVE_LIMITS, maxArchiveBytes: 100 }))).toEqual(['limit-exceeded@archivo']);
    expect(problems(read([...base(), { name: 'assets/big.bin', data: binary, declaredSize: 17 * 1024 * 1024 }]))).toEqual(['limit-exceeded@assets/big.bin']);
    const baseBytes = base().reduce((sum, entry) => sum + entry.data.length, 0);
    const total = { ...ARCHIVE_LIMITS, maxTotalBytes: baseBytes + 1000 };
    expect(valueOf(read([...base(), { name: 'assets/a.bin', data: new Uint8Array(1000) }], total)).assets['assets/a.bin']).toHaveLength(1000);
    expect(problems(read([...base(), { name: 'assets/a.bin', data: new Uint8Array(1001) }], total))).toEqual(['limit-exceeded@archivo']);
  });

  it('bomba de descompresión: la salida real no puede superar lo declarado', () => {
    const zeros = new Uint8Array(40 * 1024 * 1024);
    const bomb: FixtureEntry = { name: 'assets/bomba.bin', data: zeros, declaredSize: 1024, crc: crc32(zeros.subarray(0, 1024)) };
    const started = performance.now();
    const result = read([...base(), bomb]);
    expect(problems(result)).toEqual(['limit-exceeded@assets/bomba.bin']);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(deflateSync(zeros).length).toBeLessThan(ARCHIVE_LIMITS.maxArchiveBytes);
  });
});

describe('exportación: validación de entrada (fase 9)', () => {
  it('rechaza paquetes inválidos y assets fuera de assets/ o con rutas no portables', () => {
    expect(writeWorkspaceArchive({ 'notes.txt': 'x' }, {}).ok).toBe(false);
    expect(problems(writeWorkspaceArchive(files(), { 'cards/x.png': binary }))).toEqual(['unexpected-file@cards/x.png']);
    expect(problems(writeWorkspaceArchive(files(), { 'assets/../x.png': binary }))).toEqual(['invalid-path@assets/../x.png']);
    expect(problems(writeWorkspaceArchive({ ...files(), 'assets/a.png': 'texto' }, { 'assets/A.png': binary }))).toEqual(['path-collision@assets/A.png']);
  });
});
