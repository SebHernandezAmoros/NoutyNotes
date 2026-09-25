import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function sources(root: string): { path: string; source: string }[] {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : walk(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
  return walk(root).map((path) => ({ path: relative(root, path).replaceAll('\\', '/'), source: readFileSync(path, 'utf8') }));
}

const imports = (source: string): string[] => [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

const storage = sources(fileURLToPath(new URL('../../packages/storage/src/', import.meta.url)));
const domain = sources(fileURLToPath(new URL('../../packages/domain/src/', import.meta.url)));

describe('fronteras de storage', () => {
  it('existe código de storage que comprobar', () => {
    expect(storage.map(({ path }) => path)).toContain('workspace-codec.ts');
  });

  it('solo importa módulos propios, el API público del dominio y de application (puerto), yaml, zod y fflate (ZIP, ADR 0011)', () => {
    const allowed = new Set(['@noutynotes/application', '@noutynotes/domain', 'yaml', 'zod', 'fflate']);
    const external = storage.flatMap(({ path, source }) => imports(source)
      .filter((specifier) => !specifier.startsWith('./') && !allowed.has(specifier))
      .map((specifier) => `${path}: ${specifier}`));
    expect(external).toEqual([]);
  });

  it('no usa filesystem, red, almacenamiento real, reloj ni aleatoriedad', () => {
    const forbidden = /Date\.now|new Date\b|Math\.random|crypto|require\(|process\.|window\.|document\.|localStorage|fetch\(|indexedDB|\beval\(|new Function/;
    expect(storage.filter(({ source }) => forbidden.test(source)).map(({ path }) => path)).toEqual([]);
  });

  it('el dominio sigue sin depender de YAML, Zod ni storage', () => {
    const leaks = domain.flatMap(({ path, source }) => imports(source)
      .filter((specifier) => /^(yaml|zod)$|storage/.test(specifier))
      .map((specifier) => `${path}: ${specifier}`));
    expect(leaks).toEqual([]);
  });
});
