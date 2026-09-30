import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, statSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { resolve, relative as relativePath, sep, isAbsolute } from 'node:path';

const root = 'C:\\Users\\Pc\\AppData\\Local\\Temp\\claude\\c--SEBASTIAN-5--EMPRENDIMIENTO-REACT-NoutyNotes\\8143cc2c-70e9-4ab5-891d-09c094e8922b\\scratchpad\\drop-glitch\\notes2';
mkdirSync(root, { recursive: true });

function confinedPath(relative) {
  if (relative === '') return root;
  if (relative.startsWith('/')) throw new Error('abs rejected');
  const trimmed = relative.endsWith('/') ? relative.slice(0, -1) : relative;
  const segments = trimmed.split('/');
  const target = resolve(root, ...segments);
  const inside = relativePath(root, target);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('escape rejected');
  return target;
}

const diskBridge = `
(() => {
  const missing = () => Object.assign(new Error('Missing'), { name: 'NotFoundError' });
  const directory = (path) => ({
    kind: 'directory', name: path.split('/').filter(Boolean).pop() || 'notes',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(name, options = {}) {
      const child = path + name + '/';
      if (!(await window.__disk('isDir', child))) { if (!options.create) throw missing(); await window.__disk('mkdir', child); }
      return directory(child);
    },
    async getFileHandle(name, options = {}) {
      const file = path + name;
      if (!(await window.__disk('isFile', file))) { if (!options.create) throw missing(); await window.__disk('write', file, []); }
      return {
        getFile: async () => new Blob([new Uint8Array(await window.__disk('read', file))]),
        createWritable: async () => {
          await window.__disk('write', file + '.crswap', []);
          let bytes = [];
          return {
            write: async (value) => { bytes = Array.from(value); },
            close: async () => { await window.__disk('write', file, bytes); await window.__disk('remove', file + '.crswap'); },
          };
        },
      };
    },
    async removeEntry(name) { if (!(await window.__disk('remove', path + name))) throw missing(); },
    async *entries() {
      for (const [name, kind] of await window.__disk('list', path)) yield [name, kind === 'directory' ? directory(path + name + '/') : { kind: 'file' }];
    },
  });
  window.showDirectoryPicker = async () => directory('');
})();`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.exposeFunction('__disk', async (operation, relative, bytes) => {
  const target = confinedPath(relative);
  if (operation === 'write' && !relative.endsWith('.crswap')) await new Promise((r) => setTimeout(r, 800));
  switch (operation) {
    case 'isDir': return existsSync(target) && statSync(target).isDirectory();
    case 'isFile': return existsSync(target) && statSync(target).isFile();
    case 'mkdir': mkdirSync(target, { recursive: true }); return true;
    case 'read': return Array.from(readFileSync(target));
    case 'write': writeFileSync(target, Uint8Array.from(bytes ?? [])); return true;
    case 'remove': if (!existsSync(target)) return false; unlinkSync(target); return true;
    case 'list': return readdirSync(target, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? 'directory' : 'file']);
    default: throw new Error(`unknown ${operation}`);
  }
});
await page.addInitScript({ content: diskBridge });
page.on('console', (msg) => { if (msg.text().includes('DEBUG')) console.log('CONSOLE:', msg.text()); });
page.on('pageerror', (err) => console.log('PAGEERROR-early:', err.message));
await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'C:\\Users\\Pc\\AppData\\Local\\Temp\\claude\\c--SEBASTIAN-5--EMPRENDIMIENTO-REACT-NoutyNotes\\8143cc2c-70e9-4ab5-891d-09c094e8922b\\scratchpad\\drop-glitch\\loaded.png' });
await page.getByRole('button', { name: 'Abrir una carpeta', exact: true }).click();
await page.getByLabel('Nombre del nuevo espacio').fill('Salto2');
await page.getByRole('button', { name: 'Crear un espacio', exact: true }).click();
await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
await page.getByTestId('card-tarjeta-1').waitFor();
await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
await page.getByTestId('card-tarjeta-2').waitFor();

page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
const card1 = page.getByTestId('card-tarjeta-1');
const card2 = page.getByTestId('card-tarjeta-2');
const b1 = await card1.boundingBox();
const b2 = await card2.boundingBox();
console.log('origen 1:', b1, 'origen 2:', b2);

await page.evaluate(() => {
  window.__samples = [];
  const e1 = document.querySelector('[data-testid="card-tarjeta-1"]');
  const e2 = document.querySelector('[data-testid="card-tarjeta-2"]');
  const t0 = performance.now();
  const tick = () => {
    window.__samples.push({ t: Math.round(performance.now() - t0), x1: Math.round(e1.getBoundingClientRect().x), x2: Math.round(e2.getBoundingClientRect().x) });
    if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.mouse.move(b1.x + 20, b1.y + 12);
await page.mouse.down();
for (let step = 1; step <= 10; step += 1) await page.mouse.move(b1.x + 20 + (300 * step) / 10, b1.y + 12);
await page.mouse.up();

await page.mouse.move(b2.x + 20, b2.y + 12);
await page.mouse.down();
for (let step = 1; step <= 10; step += 1) await page.mouse.move(b2.x + 20 + (250 * step) / 10, b2.y + 200 * step / 10);
await page.mouse.up();

await page.waitForTimeout(2600);
const samples = await page.evaluate(() => window.__samples);
console.log('muestras (rAF):', samples.map((s) => `${s.t}:[${s.x1},${s.x2}]`).join(' '));
const o1 = Math.round(b1.x);
const o2 = Math.round(b2.x);
const after1 = samples.findIndex((s) => Math.abs(s.x1 - o1) > 5);
const back1 = samples.some((s, i) => i > after1 && after1 >= 0 && Math.abs(s.x1 - o1) < 5);
const after2 = samples.findIndex((s) => Math.abs(s.x2 - o2) > 5);
const back2 = samples.some((s, i) => i > after2 && after2 >= 0 && Math.abs(s.x2 - o2) < 5);
console.log('¿tarjeta1 volvió al origen tras moverse?', back1);
console.log('¿tarjeta2 volvió al origen tras moverse?', back2);
await browser.close();
