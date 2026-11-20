import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';

async function openLab(page: Page) {
  const encoded = serializeWorkspace(canvasCardsWorkspace());
  if (!encoded.ok) throw new Error('fixture');
  await page.goto('./');
  await page.evaluate(async files => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('paste-lab', { create: true });
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/'); const name = parts.pop()!; let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close();
    }
    Object.defineProperty(FileSystemDirectoryHandle.prototype, 'queryPermission', { configurable: true, value: async () => 'granted' });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  }, encoded.value);
  await page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir el proyecto Laboratorio Canvas', exact: true }).click();
  await page.getByTestId('card-idea-a').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: /^Abrir el Inspector de / }).click();
}

test('image paste: durable bytes, successive previews and retained text', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openLab(page);
  const body = page.getByRole('textbox', { name: 'Contenido visual', exact: true });
  await body.fill('Texto anterior conservado');
  const results = [];
  for (const size of [64, 512, 1100, 1100]) {
    await body.focus(); await page.keyboard.press('Control+End');
    const sample = await body.evaluate(async (element, size) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!; const pixels = ctx.createImageData(size, size);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24; }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
      const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
      const expectedHash = await digest(await blob.arrayBuffer());
      const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], 'synthetic.png', { type: 'image/png' }));
      const reads: Record<string, number> = {}; const times: Record<string, number> = {};
      const original = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = async function () {
        const start = performance.now(); const file = await original.call(this);
        reads[this.name] = (reads[this.name] ?? 0) + 1; times[this.name] = (times[this.name] ?? 0) + performance.now() - start; return file;
      };
      const longTasks: number[] = [];
      const observer = new PerformanceObserver(entries => entries.getEntries().forEach(entry => longTasks.push(entry.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      const count = element.querySelectorAll('[data-testid^="rich-image-"]').length;
      const start = performance.now();
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('paste timed out')); }, 30_000);
        const timer = setInterval(() => {
          const images = element.querySelectorAll('[data-testid^="rich-image-"] img'); const last = images[images.length - 1] as HTMLImageElement | undefined;
          if (images.length > count && last?.complete && last.naturalWidth > 0) { clearInterval(timer); clearTimeout(deadline); resolve(); }
        }, 10);
      });
      observer.disconnect(); FileSystemFileHandle.prototype.getFile = original;
      const visibleMs = Math.round(performance.now() - start);
      const ref = element.querySelectorAll('[data-testid^="rich-image-"]')[count]!.getAttribute('data-testid')!.replace('rich-image-', '');
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('paste-lab');
      const parts = ref.split('/'); const name = parts.pop()!; let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      const savedHash = await digest(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
      const note = await (await (await (await root.getDirectoryHandle('cards')).getFileHandle('idea-a.md')).getFile()).text();
      return { size, bytes: blob.size, visibleMs, reads, readMs: times, longTasks, exactBytes: expectedHash === savedHash, durableReference: note.includes(ref) && note.includes('Texto anterior conservado') };
    }, size);
    results.push(sample);
    expect(sample.exactBytes).toBe(true);
    expect(sample.durableReference).toBe(true);
    // Existing immutable previews must not be reread/reencoded on every new paste.
    for (let previous = 1; previous < results.length; previous++) {
      expect(sample.reads[`idea-a-${previous}.png`] ?? 0).toBe(0);
    }
    await expect(body).toContainText('Texto anterior conservado');
  }
  console.log(JSON.stringify({ project: info.project.name, results: results.map(({ bytes, visibleMs, longTasks }) => ({ bytes, visibleMs, maxLongTaskMs: Math.max(0, ...longTasks) })) }));
  await info.attach('timings.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('paste.png') });
  await page.getByRole('button', { name: info.project.name === 'mobile' ? 'Volver al tablero' : 'Cerrar el editor de la tarjeta', exact: true }).click();
  await page.getByTestId('card-idea-a').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: /^Abrir el Inspector de / }).click();
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(4);
  await expect(body).toContainText('Texto anterior conservado');
});

test('image paste: failed write leaves no reference or lost text and can be retried', async ({ page }) => {
  await openLab(page);
  const body = page.getByRole('textbox', { name: 'Contenido visual', exact: true });
  await body.fill('Texto protegido ante fallo');
  await body.evaluate(element => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options) {
      if (this.name.endsWith('.png')) {
        FileSystemFileHandle.prototype.createWritable = original;
        throw new DOMException('Synthetic write failure', 'UnknownError');
      }
      return original.call(this, options);
    };
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], 'retry.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  await expect(page.getByText('No se pudo copiar la imagen a la carpeta.', { exact: true })).toBeVisible();
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(0);
  await expect(body).toContainText('Texto protegido ante fallo');
  await body.evaluate(element => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], 'retry.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(1);
  await expect(body).toContainText('Texto protegido ante fallo');
});

test('image paste: real Ctrl+V in quick edit preserves the image on transfer to Inspector', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Real desktop keyboard clipboard interaction. Mobile paste events are covered separately.');
  await openLab(page);
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  await page.getByTestId('card-idea-a').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: /^Editar .* dentro de la ficha$/ }).click();
  const body = page.getByRole('textbox', { name: 'Contenido visual', exact: true });
  await body.fill('Texto conservado en rápida');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  });
  await body.focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+v');
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar y cerrar la edición rápida', exact: true }).click();
  await page.getByTestId('card-idea-a').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: /^Abrir el Inspector de / }).click();
  await expect(body.locator('[data-testid^="rich-image-"]')).toHaveCount(1);
  await expect(body).toContainText('Texto conservado en rápida');
});
