import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

/** Distinguish an actual browser global from a pure parameter with the same name. */
function hasGlobalDocumentAccess(source: string): boolean {
  const name = 'domain-check.ts';
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (path) => path === name ? file : undefined;
  const checker = ts.createProgram([name], options, host).getTypeChecker();
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const target = node.expression;
      if (ts.isIdentifier(target) && target.text === 'document') {
        const local = checker.getSymbolAtLocation(target)?.declarations?.some((declaration) =>
          (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient) === 0);
        if (!local) found = true;
      }
      const member = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (ts.isIdentifier(target) && ['globalThis', 'window', 'self'].includes(target.text) && member === 'document') found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

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
    const forbidden = /Date\.now|new Date\b|Math\.random|crypto|require\(|process\.|window\.|localStorage|fetch\(|indexedDB|\beval\(|new Function/;
    const offenders = files.filter(({ source }) => forbidden.test(source) || hasGlobalDocumentAccess(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('el detector admite document como dato local sin confundirlo con el DOM', () => {
    expect(hasGlobalDocumentAccess('export function text(document: { blocks: string[] }) { return document.blocks; }')).toBe(false);
    expect(hasGlobalDocumentAccess('export function text() { const document = { blocks: [] }; return document.blocks; }')).toBe(false);
  });

  it('el detector conserva la prohibición de acceso real al documento del navegador', () => {
    for (const source of ['document.body;', 'document["body"];', 'globalThis.document.body;', 'declare const document: any; document.body;']) {
      expect(hasGlobalDocumentAccess(source), source).toBe(true);
    }
  });

  it('carga el punto de entrada del paquete en el entorno Node de Vitest', async () => {
    // Con imports exclusivamente relativos, cargarlo no arrastra React Native ni Expo.
    const domain = await import('../../packages/domain/src/index');
    expect(typeof domain.validateWorkspace).toBe('function');
    expect(typeof domain.validateTemplate).toBe('function');
  });
});
