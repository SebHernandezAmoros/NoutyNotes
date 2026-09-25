import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/noutynotes/dist/pages/', import.meta.url));
const prefix = '/NoutyNotes/';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

// Serve only exported files under the Pages prefix; never fall back to the app.
export async function startPagesPreview() {
  const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/NoutyNotes') {
      response.writeHead(301, { Location: prefix }).end();
      return;
    }
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    let file = resolve(root, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(resolve(root) + sep)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(8082, '127.0.0.1', () => {
      server.off('error', reject);
      resolveReady();
    });
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPagesPreview().then(() => {
    console.log('Pages preview: http://127.0.0.1:8082/NoutyNotes/');
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
