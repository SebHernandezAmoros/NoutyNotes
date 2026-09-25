// Genera `sw.js` en un export web estático (ADR 0011): precachea todos sus archivos y responde
// desde la caché primero dentro del ámbito de la app. La versión es el hash del contenido: un export
// distinto produce otro worker, que el navegador instala al volver a haber red.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = 'sw.js';
const EXCLUDED = new Set([WORKER, '.nojekyll']);
/** Otros exports que pueden convivir dentro de `dist/` y no forman parte de esta web. */
const EXCLUDED_TOP = new Set(['android', 'pages']);

export function listExportFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const key = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (!(directory === root && EXCLUDED_TOP.has(entry.name))) walk(path);
      } else if (!EXCLUDED.has(key)) {
        files.push(key);
      }
    }
  };
  walk(root);
  return files.sort();
}

export function workerSource(files, version) {
  return `// Generado por scripts/write-offline-worker.mjs. No editar.
const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files)};
const CACHE = 'noutynotes-' + VERSION;
const SCOPE = new URL(self.registration.scope);
const KNOWN = new Set(FILES);
const urlOf = (file) => new URL(file, SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(urlOf))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('noutynotes-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

/** Archivo del export que corresponde a la petición, sin la consulta; null si no es de la app. */
function fileFor(request) {
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return null;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(SCOPE.pathname.length)); } catch { return null; }
  if (request.mode === 'navigate' && !KNOWN.has(path)) {
    if (path === '' || path.endsWith('/')) path += 'index.html';
    else if (KNOWN.has(path + '.html')) path += '.html';
    else path += '/index.html';
  }
  return KNOWN.has(path) ? path : null;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const file = fileFor(event.request);
  if (file === null) return;
  event.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(urlOf(file)))
    .then((cached) => cached || fetch(event.request)));
});
`;
}

export function writeOfflineWorker(root) {
  const files = listExportFiles(root);
  if (!files.includes('index.html')) throw new Error(`${root} no parece un export web: falta index.html.`);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  const version = hash.digest('hex').slice(0, 16);
  writeFileSync(join(root, WORKER), workerSource(files, version));
  return { files, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '');
  if (!statSync(root).isDirectory()) throw new Error(`No existe el export ${root}.`);
  const { files, version } = writeOfflineWorker(root);
  console.log(`Service worker sin conexión: ${files.length} archivos precacheados, versión ${version}.`);
}
