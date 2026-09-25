import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../packages/domain/src/__fixtures__/grid';
import { ideaB, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { assertValid, deleteCard } from '../../packages/domain/src/index';
import { parseWorkspace, serializeWorkspace } from '../../packages/storage/src/index';
import type { StorageResult, TextFiles } from '../../packages/storage/src/index';

/** Lee un directorio de fixture como TextFiles con rutas relativas y separador "/". */
function readPackage(name: string): TextFiles {
  const root = fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));
  const walk = (directory: string): [string, string][] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [[relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]];
  });
  return Object.fromEntries(walk(root));
}

function valueOf<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const canonical = readPackage('workspace-v1');
const edited = readPackage('workspace-v1-edited');

describe('formato v1 frente a fixtures escritos a mano', () => {
  it('la serialización produce exactamente los archivos esperados', () => {
    expect(valueOf(serializeWorkspace(deepFreeze(validWorkspace())))).toEqual(canonical);
  });

  it('lee el fixture canónico y la variante editada a mano como el mismo workspace', () => {
    expect(valueOf(parseWorkspace(canonical))).toEqual(validWorkspace());
    expect(valueOf(parseWorkspace(edited))).toEqual(validWorkspace());
    expect(edited['cards/idea-a.md']?.startsWith('---\r\n')).toBe(true);
  });

  it('guardar sin cambios sobre archivos editados no produce diferencias', () => {
    expect(valueOf(serializeWorkspace(validWorkspace(), edited))).toEqual(edited);
  });

  it('un cambio en una tarjeta regenera solo su documento', () => {
    const workspace = { ...validWorkspace(), cards: validWorkspace().cards.map((card) => (card.id === ideaB.id ? { ...card, title: 'Otra idea' } : card)) };
    const next = valueOf(serializeWorkspace(workspace, edited));
    const changed = Object.keys(next).filter((path) => next[path] !== edited[path]);
    expect(changed).toEqual(['cards/idea-b.md']);
    expect(next['cards/idea-b.md']).toBe(canonical['cards/idea-b.md']?.replace('id: idea-b', 'id: idea-b').replace('schemaVersion: 1\n', 'schemaVersion: 1\ntitle: Otra idea\n'));
  });

  it('borrar una tarjeta en cascada retira su documento y actualiza referencias sin tocar extras', () => {
    const reduced = assertValid(deleteCard(validWorkspace(), ideaB.id, { relations: 'cascade' }));
    const next = valueOf(serializeWorkspace(reduced, edited));
    expect(Object.keys(next).sort()).toEqual(Object.keys(edited).filter((path) => path !== 'cards/idea-b.md').sort());
    for (const path of ['README.md', 'assets/notes/lista de ideas.txt', 'cards/idea-a.md', 'boards/research.md']) {
      expect(next[path]).toBe(edited[path]);
    }
    expect(valueOf(parseWorkspace(next))).toEqual(reduced);
  });

  it('rechaza extras desconocidos en el paquete anterior en lugar de descartarlos', () => {
    const unknown = { ...edited, 'notas.docx.txt': 'x' };
    const result = serializeWorkspace(validWorkspace(), unknown);
    expect(result.ok ? [] : result.issues.map((found) => `${found.code}@${found.path}`)).toEqual(['unexpected-file@previousFiles:notas.docx.txt']);
  });
});
