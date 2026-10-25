import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

/** Inspect executable member access, not diagnostic strings or local RichTextDocument data. */
function hasGlobalDocumentAccess(source: string): boolean {
  const name = 'storage-check.ts';
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

describe('fronteras de storage', () => {
  it('existe código de storage que comprobar', () => {
    expect(storage.map(({ path }) => path)).toContain('workspace-codec.ts');
  });

  it('solo importa módulos propios, APIs públicos y adaptadores de formato declarados', () => {
    const allowed = new Set([
      '@noutynotes/application', '@noutynotes/domain', 'yaml', 'zod', 'fflate',
      'mdast', 'mdast-util-from-markdown', 'mdast-util-gfm', 'mdast-util-to-markdown', 'micromark-extension-gfm',
    ]);
    const external = storage.flatMap(({ path, source }) => imports(source)
      .filter((specifier) => !specifier.startsWith('./') && !allowed.has(specifier))
      .map((specifier) => `${path}: ${specifier}`));
    expect(external).toEqual([]);
  });

  it('no usa filesystem, red, almacenamiento real, reloj ni aleatoriedad', () => {
    const forbidden = /Date\.now|new Date\b|Math\.random|crypto|require\(|process\.|window\.|localStorage|fetch\(|indexedDB|\beval\(|new Function/;
    expect(storage.filter(({ source }) => forbidden.test(source) || hasGlobalDocumentAccess(source)).map(({ path }) => path)).toEqual([]);
  });

  it('el detector admite rutas literales y document como dato local sin confundirlos con DOM', () => {
    for (const source of [
      "export const issue = { path: 'document.schemaVersion' }; // document.body",
      'export function text(document: { blocks: string[] }) { return document.blocks; }',
      'export function text() { const document = { link: [] }; return document["link"]; }',
    ]) expect(hasGlobalDocumentAccess(source), source).toBe(false);
  });

  it('el detector rechaza accesos reales al documento del navegador sin excepciones por propiedad', () => {
    for (const source of [
      'document.body;', 'document["body"];', 'document.blocks;', 'document.link;',
      'globalThis.document.body;', 'self["document"].body;', 'window.document.body;',
      'declare const document: any; document.body;',
    ]) expect(hasGlobalDocumentAccess(source), source).toBe(true);
  });

  it('el dominio sigue sin depender de YAML, Zod ni storage', () => {
    const leaks = domain.flatMap(({ path, source }) => imports(source)
      .filter((specifier) => /^(yaml|zod)$|storage/.test(specifier))
      .map((specifier) => `${path}: ${specifier}`));
    expect(leaks).toEqual([]);
  });
});
