import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, stringify } from 'yaml';

import { fail, storageIssue, succeed } from './issues';
import type { StorageResult } from './issues';
import { MAX_DATA_DEPTH } from './text-files';

/**
 * YAML canónico: claves ordenadas en todos los niveles, listas en su orden, LF, sin partir líneas
 * y sin anchors/aliases. Los textos que un lector YAML 1.1 interpretaría como booleano, fecha o
 * número (`yes`, `on`, `2026-02-28`) se entrecomillan para que ninguno los reinterprete.
 */
export function stringifyYaml(data: unknown): string {
  return stringify(data, {
    sortMapEntries: true,
    lineWidth: 0,
    aliasDuplicateObjects: false,
    compat: 'yaml-1.1',
  });
}

type Pending = { readonly node: unknown; readonly depth: number };

/** Recorre el árbol sin recursión y rechaza construcciones fuera del subconjunto admitido. */
function unsupportedConstruct(root: unknown): { readonly code: 'invalid-yaml' | 'limit-exceeded'; readonly message: string } | null {
  const stack: Pending[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as Pending;
    if (node === null || node === undefined) continue;
    if (isAlias(node)) return { code: 'invalid-yaml', message: 'No se admiten aliases.' };
    if (!isScalar(node) && !isMap(node) && !isSeq(node)) return { code: 'invalid-yaml', message: 'Nodo YAML no admitido.' };
    if (node.anchor) return { code: 'invalid-yaml', message: 'No se admiten anchors.' };
    if (node.tag) return { code: 'invalid-yaml', message: 'No se admiten tags explícitos.' };
    if (isScalar(node)) continue;
    if (depth > MAX_DATA_DEPTH) return { code: 'limit-exceeded', message: `La profundidad máxima de datos es ${MAX_DATA_DEPTH}.` };
    if (isSeq(node)) {
      for (const item of node.items) stack.push({ node: item, depth: depth + 1 });
      continue;
    }
    for (const pair of node.items) {
      const key: unknown = pair.key;
      if (!isScalar(key) || typeof key.value !== 'string' || key.anchor || key.tag) {
        return { code: 'invalid-yaml', message: 'Las claves deben ser textos simples.' };
      }
      if (key.value === '__proto__') return { code: 'invalid-yaml', message: 'La clave "__proto__" no está permitida.' };
      stack.push({ node: pair.value, depth: depth + 1 });
    }
  }
  return null;
}

/**
 * YAML 1.2 core, un solo documento y datos simples. Rechaza claves duplicadas, tags, anchors,
 * aliases, directivas distintas de %YAML 1.2, claves no textuales, `__proto__` y BOM.
 */
export function parseYaml(text: string, file: string): StorageResult<unknown> {
  const invalid = (message: string): StorageResult<unknown> => fail([storageIssue('invalid-yaml', file, message)]);
  if (text.startsWith('\uFEFF')) return invalid('No se admite BOM; el texto debe empezar directamente por el contenido.');
  const documents = parseAllDocuments(text, { schema: 'core', merge: false, uniqueKeys: true, prettyErrors: true });
  if (documents.length === 0) return succeed(null);
  if (documents.length > 1) return invalid('Debe contener un solo documento YAML.');
  const [parsed] = documents;
  if (!parsed) return succeed(null);
  const [problem] = [...parsed.errors, ...parsed.warnings];
  if (problem) return invalid(problem.message);
  const { yaml, tags } = parsed.directives;
  if (yaml.explicit && yaml.version !== '1.2') return invalid(`No se admite la directiva %YAML ${yaml.version}.`);
  if (Object.keys(tags).some((handle) => handle !== '!!') || tags['!!'] !== 'tag:yaml.org,2002:') {
    return invalid('No se admiten directivas %TAG.');
  }
  const construct = unsupportedConstruct(parsed.contents);
  if (construct) return fail([storageIssue(construct.code, file, construct.message)]);
  return succeed(parsed.toJS({ maxAliasCount: 0 }));
}
