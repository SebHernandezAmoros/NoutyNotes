import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { writeOfflineWorker } from './write-offline-worker.mjs';

const appDirectory = new URL('../apps/noutynotes/', import.meta.url);
const appRequire = createRequire(new URL('package.json', appDirectory));
const result = spawnSync(process.execPath, [
  appRequire.resolve('expo/bin/cli'),
  'export', '--platform', 'web', '--output-dir', 'dist/pages',
], {
  cwd: fileURLToPath(appDirectory),
  stdio: 'inherit',
  env: { ...process.env, NOUTYNOTES_PAGES: '1', EXPO_NO_TELEMETRY: '1' },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(new URL('dist/pages/.nojekyll', appDirectory), '');
const { files, version } = writeOfflineWorker(fileURLToPath(new URL('dist/pages/', appDirectory)));
console.log(`Service worker sin conexión: ${files.length} archivos precacheados, versión ${version}.`);
