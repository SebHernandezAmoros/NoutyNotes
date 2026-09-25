import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../packages/application/src/', import.meta.url));
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return walk(path);
  return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
});
const files = walk(root).map((path) => ({ path: relative(root, path).replaceAll('\\', '/'), source: readFileSync(path, 'utf8') }));
const imports = (source: string): string[] => [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('fronteras de application', () => {
  it('existen el puerto y los casos de uso', () => {
    expect(files.map(({ path }) => path).sort()).toEqual(['index.ts', 'workspace-storage.ts', 'workspace-use-cases.ts']);
  });

  it('solo depende del API público del dominio: nunca de storage, UI ni plataforma', () => {
    const external = files.flatMap(({ path, source }) => imports(source)
      .filter((specifier) => !specifier.startsWith('./') && specifier !== '@noutynotes/domain')
      .map((specifier) => `${path}: ${specifier}`));
    expect(external).toEqual([]);
  });

  it('no usa filesystem, red, almacenamiento real, reloj ni aleatoriedad', () => {
    const forbidden = /Date\.now|new Date\b|Math\.random|crypto|require\(|process\.|window\.|document\.|localStorage|fetch\(|indexedDB|\beval\(|new Function/;
    expect(files.filter(({ source }) => forbidden.test(source)).map(({ path }) => path)).toEqual([]);
  });
});
