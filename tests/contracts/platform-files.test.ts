import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// En Android, Metro resuelve './x' desde x.android.ts a x.android.ts: importar VALORES de su propio
// nombre base crea un ciclo y el valor llega como undefined (el selector de imágenes fallaba así).
// Los tipos se borran al compilar y sí pueden importarse.
const root = fileURLToPath(new URL('../../apps/noutynotes/src/', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

describe('archivos por plataforma', () => {
  it('un archivo .android.ts no importa valores de su propio nombre base', () => {
    const offenders = walk(root).filter((path) => path.endsWith('.android.ts')).flatMap((path) => {
      const base = path.split(sep).pop()?.replace('.android.ts', '') ?? '';
      const source = readFileSync(path, 'utf8');
      const valueImports = [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*from\s+'\.\/([^']+)';/gm)]
        .filter((match) => match[1] === base);
      return valueImports.map((match) => `${relative(root, path)}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
