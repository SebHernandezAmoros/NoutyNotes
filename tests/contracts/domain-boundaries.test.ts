import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const domainRoot = fileURLToPath(new URL('../../packages/domain/src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(domainRoot).map((path) => ({
  path: relative(domainRoot, path).replaceAll('\\', '/'),
  source: readFileSync(path, 'utf8'),
}));

describe('fronteras del dominio', () => {
  it('existe código de dominio que comprobar', () => {
    expect(files.map(({ path }) => path)).toContain('workspace/workspace.ts');
  });

  it('solo importa módulos propios mediante rutas relativas', () => {
    const external = files.flatMap(({ path, source }) =>
      [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)]
        .map((match) => match[1] ?? '')
        .filter((specifier) => !specifier.startsWith('./') && !specifier.startsWith('../'))
        .map((specifier) => `${path}: ${specifier}`));
    expect(external).toEqual([]);
  });

  it('no genera IDs ni fechas ocultas ni accede a plataforma o I/O', () => {
    const forbidden = /Date\.now|new Date\b|Math\.random|crypto|require\(|process\.|window\.|document\.|localStorage|fetch\(|indexedDB|\beval\(|new Function/;
    const offenders = files.filter(({ source }) => forbidden.test(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('carga el punto de entrada del paquete en el entorno Node de Vitest', async () => {
    // Con imports exclusivamente relativos, cargarlo no arrastra React Native ni Expo.
    const domain = await import('../../packages/domain/src/index');
    expect(typeof domain.validateWorkspace).toBe('function');
    expect(typeof domain.validateTemplate).toBe('function');
  });
});
