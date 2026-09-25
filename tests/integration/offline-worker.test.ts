import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error: script de build en JavaScript sin tipos.
import { listExportFiles, writeOfflineWorker } from '../../scripts/write-offline-worker.mjs';

function fakeExport(): string {
  const root = mkdtempSync(join(tmpdir(), 'nouty-sw-'));
  for (const [path, content] of Object.entries({
    'index.html': '<html></html>',
    'workspace/index.html': '<html>w</html>',
    '_expo/static/js/web/entry-1.js': 'console.log(1)',
    'assets/icon@2x.png': 'png',
    '.nojekyll': '',
    'sw.js': 'antiguo',
    'android/_expo/x.hbc': 'android',
    'pages/index.html': 'otro export',
  })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('generador del service worker sin conexión (fase 9)', () => {
  it('precachea solo los archivos de este export web', () => {
    expect(listExportFiles(fakeExport())).toEqual(['_expo/static/js/web/entry-1.js', 'assets/icon@2x.png', 'index.html', 'workspace/index.html']);
  });

  it('escribe sw.js con la lista y una versión que cambia con el contenido', () => {
    const root = fakeExport();
    const first = writeOfflineWorker(root);
    const source = readFileSync(join(root, 'sw.js'), 'utf8');
    expect(source).toContain(JSON.stringify(first.files));
    expect(source).toContain(`const VERSION = ${JSON.stringify(first.version)}`);
    expect(writeOfflineWorker(root).version).toBe(first.version);
    writeFileSync(join(root, '_expo/static/js/web/entry-1.js'), 'console.log(2)');
    expect(writeOfflineWorker(root).version).not.toBe(first.version);
  });

  it('rechaza una carpeta que no es un export web', () => {
    const root = mkdtempSync(join(tmpdir(), 'nouty-sw-empty-'));
    expect(() => writeOfflineWorker(root)).toThrow(/falta index.html/);
  });
});
