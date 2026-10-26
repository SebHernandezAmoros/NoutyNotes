import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { detachmentPng, detachmentPdf, detachmentPdfRef, detachmentRef } from '../fixtures/asset-detachment';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
async function openLab(page: Page, workspace = canvasCardsWorkspace()) {
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(workspace)), {
    [detachmentRef]: new Uint8Array(Buffer.from(detachmentPng, 'base64')), [detachmentPdfRef]: new Uint8Array(Buffer.from(detachmentPdf)),
  }));
  if (JSON.stringify(workspace) === JSON.stringify(canvasCardsWorkspace())) writeFileSync('artifacts/block7-fixture.zip', zip);
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'canvas-lab.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.getByRole('heading', { name: 'Laboratorio Canvas', exact: true })).toBeVisible();
}

async function select(page: Page, id: string) {
  await page.getByTestId(`card-${id}`).focus();
  await page.keyboard.press('Enter');
}

async function openCardActions(page: Page, id: string) {
  const card = page.getByTestId(`card-${id}`);
  if (!test.info().project.use.hasTouch) {
    await card.focus();
    await page.keyboard.press('Shift+F10');
    return;
  }
  const box = (await card.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 8, y: box.y + box.height - 8 }] });
  // Intentional hold duration for the gesture, not a delay to mask an application update.
  try { await page.waitForTimeout(600); }
  finally { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); }
  await expect(page.getByTestId('card-menu')).toBeVisible();
}

async function rect(page: Page, id = 'idea-a') {
  return page.getByTestId(`card-${id}`).evaluate((node) => {
    const style = node.parentElement!.style;
    return { x: parseFloat(style.left), y: parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) };
  });
}

async function zoom(page: Page, target: number) {
  const content = page.getByTestId('canvas-content');
  const current = await content.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a);
  await page.getByTestId('board-canvas').evaluate((node, deltaY) => {
    const box = node.getBoundingClientRect();
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: box.left + 20, clientY: box.top + 20 }));
  }, -1200 * Math.log(target / current));
  await expect.poll(() => content.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBeCloseTo(target, 3);
}

async function drag(page: Page, testId: string, dx: number, dy: number, release = true) {
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) throw new Error(`Sin geometría: ${testId}`);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  if (release) await page.mouse.up();
}

async function touchDrag(page: Page, testId: string, dx: number, dy: number, nativeScroll = false) {
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) throw new Error(`Sin geometría táctil: ${testId}`);
  const x = Math.round(bounds.x + bounds.width / 2);
  const y = Math.round(bounds.y + bounds.height / 2);
  const hit = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    const path: string[] = [];
    for (let parent = node; parent; parent = parent.parentElement) path.push(`${parent.getAttribute('data-testid') ?? parent.tagName}:${getComputedStyle(parent).touchAction}`);
    return path;
  }, { x, y });
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    const trace: string[] = [];
    (window as unknown as { b7PointerTrace: string[] }).b7PointerTrace = trace;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend']) {
      window.addEventListener(type, (event) => trace.push(`${type}:${(event.target as HTMLElement)?.closest('[data-testid]')?.getAttribute('data-testid')}`), { capture: true, once: true });
    }
  });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + dx * step / 6), y: Math.round(y + dy * step / 6) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  const events = await page.evaluate(() => (window as unknown as { b7PointerTrace: string[] }).b7PointerTrace);
  if (!nativeScroll) expect(events.some((event) => event.startsWith('pointercancel:')), JSON.stringify({ hit, events })).toBe(false);
}

test('B7: las flechas del lector desplazan el documento sin mover la Card', async ({ page }) => {
  await openLab(page);
  await page.getByTestId('card-idea-a').focus();
  await page.keyboard.press('Enter');
  const reader = page.getByTestId('card-reader-idea-a');
  await reader.focus();
  await reader.evaluate((node) => { node.scrollTop = 0; });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  if (test.info().project.use.hasTouch) {
    const before = await rect(page);
    await reader.evaluate((node) => { node.scrollTop = 0; });
    await touchDrag(page, 'card-reader-idea-a', 0, -80, true);
    await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(await rect(page)).toEqual(before);
  }
});

test('B7: ocho asas conservan 44 px físicos al alejar el zoom', async ({ page }) => {
  await openLab(page);
  await select(page, 'idea-a');
  for (const scale of [0.5, 1, 1.25]) {
    await zoom(page, scale);
    const handles = page.locator('[data-testid^="resize-"][data-testid$="-idea-a"]');
    await expect(handles).toHaveCount(8);
    for (const handle of await handles.all()) {
      const box = await handle.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(43.9);
      expect(box?.height).toBeGreaterThanOrEqual(43.9);
    }
  }
});

test('B7: el cuerpo no arrastra; cabecera, asa noroeste y teclado tienen historial coherente', async ({ page }, info) => {
  await openLab(page);
  await zoom(page, 0.5);
  await select(page, 'idea-b');
  const before = await rect(page, 'idea-b');
  const paragraph = page.getByTestId('card-idea-b').getByText('Antes de la imagen', { exact: true });
  const bounds = await paragraph.boundingBox();
  if (!bounds) throw new Error('Párrafo no visible');
  await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 48, bounds.y + 18, { steps: 5 });
  await page.mouse.up();
  expect(await rect(page, 'idea-b')).toEqual(before);
  await select(page, 'idea-a');
  const original = await rect(page);
  await drag(page, 'card-header-idea-a', -48, 0);
  await expect.poll(() => rect(page)).not.toEqual(original);
  await page.getByRole('button', { name: /^Deshacer:/ }).click();
  await expect.poll(() => rect(page)).toEqual(original);
  await select(page, 'idea-a');
  if (info.project.use.hasTouch) await touchDrag(page, 'resize-nw-idea-a', 24, 24);
  else await drag(page, 'resize-nw-idea-a', 24, 24);
  await expect.poll(async () => (await rect(page)).w).toBeLessThan(original.w);
  const resized = await rect(page);
  expect(resized.x + resized.w).toBeCloseTo(original.x + original.w, 3);
  expect(resized.y + resized.h).toBeCloseTo(original.y + original.h, 3);
  await page.getByRole('button', { name: /^Deshacer:/ }).click();
  await expect.poll(() => rect(page)).toEqual(original);
  await select(page, 'idea-a');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await rect(page)).w).toBeGreaterThan(original.w);
  await page.screenshot({ path: info.outputPath('block7-eight-handles.png') });
});

test('B7: cámara y pérdida de captura invalidan el gesto y su finalización tardía', async ({ page }) => {
  await openLab(page);
  await select(page, 'idea-a');
  const before = await rect(page);
  await drag(page, 'card-header-idea-a', -24, 0, false);
  await expect(page.getByTestId('drag-target')).toBeVisible();
  await zoom(page, 0.75);
  await expect(page.getByTestId('drag-target')).toHaveCount(0);
  await page.mouse.up();
  expect(await rect(page)).toEqual(before);
  await page.getByTestId('card-idea-a').focus();
  await drag(page, 'card-header-idea-a', -24, 0, false);
  await page.getByTestId('board-canvas').dispatchEvent('lostpointercapture', { buttons: 1, pointerId: 1 });
  await expect(page.getByTestId('drag-target')).toHaveCount(0);
  await page.mouse.up();
  expect(await rect(page)).toEqual(before);
  await drag(page, 'card-header-idea-a', -24, 0, false);
  await expect(page.getByTestId('drag-target')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drag-target')).toHaveCount(0);
  await page.mouse.up();
  expect(await rect(page)).toEqual(before);
});

test('B7: 1×1 conserva acceso contextual y tamaño accesible en ambos temas', async ({ page }, info) => {
  await openLab(page);
  await select(page, 'tiny');
  await expect(page.getByTestId('compact-card-tiny')).toBeVisible();
  await expect(page.locator('[data-testid^="resize-"][data-testid$="-tiny"]')).toHaveCount(0);
  const original = await rect(page, 'tiny');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await openCardActions(page, 'tiny');
    await page.getByRole('button', { name: 'Ajustar tamaño', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Más alta', exact: true })).toBeVisible();
    const options = await page.getByRole('button', { name: 'Más alta', exact: true }).boundingBox();
    expect(options!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`block7-tiny-${colorScheme}.png`) });
    if (colorScheme === 'light') {
      await page.getByRole('button', { name: 'Más alta', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await rect(page, 'tiny')).h).toBeGreaterThan(original.h);
    }
    await page.getByRole('button', { name: /^Cerrar.*menú|^Cerrar.*nota/i }).first().click();
    if (colorScheme === 'light') {
      await page.getByTestId('card-tiny').focus();
      await page.keyboard.press('Control+z');
      await expect.poll(() => rect(page, 'tiny')).toEqual(original);
    }
    expect(await rect(page, 'tiny')).toEqual(original);
  }
});

test('B7: grupo conserva distancia relativa con agarre, lector y Undo', async ({ page }, info) => {
  const source = canvasCardsWorkspace();
  await openLab(page, { ...source, cards: source.cards.map((card) => card.id === 'idea-a' || card.id === 'idea-b'
    ? { ...card, frameOverride: 'hidden' as const, titleVisibility: 'hidden' as const, bodyVisibility: 'visible' as const } : card) });
  await zoom(page, 0.5);
  await select(page, 'idea-a');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Seleccionar Documento extenso junto con otras tarjetas', exact: true }).click();
  await page.getByTestId('card-idea-b').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('multi-count')).toContainText('2');
  const beforeA = await rect(page);
  const beforeB = await rect(page, 'idea-b');
  const reader = page.getByTestId('card-reader-idea-a');
  await reader.focus();
  await page.keyboard.press('ArrowDown');
  expect(await rect(page)).toEqual(beforeA);
  expect(await rect(page, 'idea-b')).toEqual(beforeB);
  await page.screenshot({ path: info.outputPath('group-before.png') });
  if (info.project.use.hasTouch) await touchDrag(page, 'card-move-idea-a', -40, 0);
  else {
    await drag(page, 'card-move-idea-a', -40, 0, false);
    await expect(page.getByTestId('drag-target')).toBeVisible();
    // A slow commit can defer the synthetic click beyond the old 400 ms guard.
    // Reproduce that event-loop boundary, rather than waiting before mouseup.
    await page.evaluate(() => document.addEventListener('mouseup', () => {
      const started = performance.now();
      while (performance.now() - started < 450) { /* simulate a slow synchronous commit */ }
    }, { once: true }));
    await page.mouse.up();
  }
  await expect.poll(async () => (await rect(page)).x).toBeLessThan(beforeA.x);
  const afterA = await rect(page);
  const afterB = await rect(page, 'idea-b');
  expect(afterA.x - beforeA.x).toEqual(afterB.x - beforeB.x);
  expect(afterA.y - beforeA.y).toEqual(afterB.y - beforeB.y);
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  await page.getByTestId('card-move-idea-a').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => rect(page)).toEqual(beforeA);
  expect(await rect(page, 'idea-b')).toEqual(beforeB);
  await page.getByTestId('card-move-idea-a').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('card-menu')).toBeVisible();
});

test('B7: cambiar tablero con el puntero pulsado no modifica la Card compartida', async ({ page }) => {
  await openLab(page);
  if ((page.viewportSize()?.width ?? 0) < 800) {
    await page.getByRole('button', { name: 'Abrir un tablero', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir el tablero Investigación', exact: true }).click();
  } else await page.getByRole('button', { name: 'Tablero Investigación', exact: true }).click();
  const other = await rect(page);
  await page.getByRole('button', { name: 'Tablero Resumen', exact: true }).click();
  await select(page, 'idea-a');
  const original = await rect(page);
  for (const moved of [false, true]) {
    const box = await page.getByTestId('card-header-idea-a').boundingBox();
    if (!box) throw new Error('Cabecera no disponible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    if (moved) await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 5 });
    await page.getByRole('button', { name: 'Tablero Investigación', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Tablero Investigación', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await rect(page)).toEqual(other);
    await expect(page.getByTestId('drag-target')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tablero Resumen', exact: true }).click();
    expect(await rect(page)).toEqual(original);
    await page.getByTestId('card-idea-a').focus();
  }
});

test('B7: imagen, PDF y retirada se contienen en 1×1 con Inspector accesible', async ({ page }, info) => {
  await openLab(page);
  for (const [id, columns, rows, title] of [['picture', 4, 4, 'Imagen'], ['pdf', 4, 3, 'PDF'], ['retired', 4, 3, 'Recurso retirado']] as const) {
    await select(page, id);
    for (let i = 1; i < columns; i++) {
      const before = await rect(page, id);
      await page.keyboard.press('Shift+ArrowLeft');
      await expect.poll(async () => (await rect(page, id)).w).toBeLessThan(before.w);
    }
    for (let i = 1; i < rows; i++) {
      const before = await rect(page, id);
      await page.keyboard.press('Shift+ArrowUp');
      await expect.poll(async () => (await rect(page, id)).h).toBeLessThan(before.h);
    }
    const card = page.getByTestId(`card-${id}`);
    const identity = page.getByTestId(`compact-card-${id}`);
    await expect(identity).toBeVisible();
    const outer = await card.boundingBox();
    const inner = await identity.boundingBox();
    expect(inner!.height).toBeLessThanOrEqual(outer!.height);
    expect(inner!.width).toBeLessThanOrEqual(outer!.width);
    await openCardActions(page, id);
    await expect(page.getByRole('button', { name: `Abrir el Inspector de ${title}`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`block7-minimum-${id}.png`) });
    await page.getByTestId('card-menu').getByRole('button', { name: /^Cerrar/i }).click();
  }
});

test('B7: una imagen con poco alto no crece fuera de su tarjeta', async ({ page }) => {
  await openLab(page);
  await select(page, 'picture');
  const before = await rect(page, 'picture');
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await rect(page, 'picture')).h).toBeLessThan(before.h);
  const photo = page.getByTestId('image-preview-picture');
  if (await photo.count()) {
    const outer = await page.getByTestId('card-picture').boundingBox();
    const inner = await photo.boundingBox();
    expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height);
  } else await expect(page.getByTestId('compact-card-picture')).toBeVisible();
});

test('B7: fondo y marco independientes preservan historia, contraste y ZIP al reabrir', async ({ page }, info) => {
  const source = canvasCardsWorkspace();
  await openLab(page, source);
  await zoom(page, 0.75);
  await select(page, 'idea-a');
  const card = page.getByTestId('card-idea-a');
  const background = () => card.evaluate((node) => getComputedStyle(node).backgroundColor);
  const paper = await background();
  const action = async (name: string) => {
    await card.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('button', { name, exact: true }).click();
  };
  await action('Ocultar el marco de Documento extenso');
  expect(await background()).toBe(paper);
  await action('Fondo transparente de Documento extenso');
  await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
  await card.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(background).toBe(paper);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
  await action('Mostrar el marco de Documento extenso');
  expect(await background()).toBe('rgba(0, 0, 0, 0)');
  await action('Mostrar fondo de papel de Documento extenso');
  await expect.poll(background).toBe(paper);
  await action('Ocultar el marco de Documento extenso');
  expect(await background()).toBe(paper);
  await action('Fondo transparente de Documento extenso');
  await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const contrast = await page.getByTestId('card-reader-idea-a').locator('p').first().evaluate((node) => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((value) => {
          const v = value / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      let parent: Element | null = node;
      let surface = 'rgb(255, 255, 255)';
      while (parent) {
        const color = getComputedStyle(parent).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { surface = color; break; }
        parent = parent.parentElement;
      }
      const foreground = luminance(getComputedStyle(node).color);
      const back = luminance(surface);
      return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: info.outputPath(`block7-background-${colorScheme}.png`) });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const zipPath = info.outputPath('block7-background.zip');
  await (await download).saveAs(zipPath);
  const exported = value(readWorkspaceArchive(new Uint8Array(readFileSync(zipPath))));
  expect(exported.workspace.cards.find((entry) => entry.id === 'idea-a')).toEqual({ ...source.cards[0], frameOverride: 'hidden', noteBackground: 'transparent' });
  expect(exported.workspace.cards.find((entry) => entry.id === 'transparent')).toEqual(source.cards.find((entry) => entry.id === 'transparent'));
  expect(exported.workspace.relations).toEqual(source.relations);
  await page.reload();
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles(zipPath);
  await expect(page.getByRole('heading', { name: 'Laboratorio Canvas', exact: true })).toBeVisible();
  await select(page, 'idea-a');
  await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('block7-background-reopened.png') });
  const historical = page.getByTestId('card-transparent');
  await historical.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Mostrar el marco de Identificador transparente', exact: true }).click();
  await expect.poll(() => historical.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('B7: carga inicial y resize móvil-tablet-escritorio conservan acceso y geometría durable', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'El recorrido responsive se ejecuta una vez; móvil tiene sus propios flujos táctiles.');
  const source = canvasCardsWorkspace();
  await openLab(page, source);
  await page.screenshot({ path: info.outputPath('block7-initial-desktop.png') });
  for (const width of [390, 800, 1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('card-tiny').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('button', { name: 'Abrir el Inspector de Nota mínima con título largo conservado', exact: true })).toBeVisible();
    await page.getByTestId('card-menu').getByRole('button', { name: /^Cerrar/i }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`block7-responsive-${width}.png`) });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const path = info.outputPath('block7-responsive.zip');
  await (await download).saveAs(path);
  expect(value(readWorkspaceArchive(new Uint8Array(readFileSync(path)))).workspace.layouts).toEqual(source.layouts);
});

test('B7: doble clic o toque en el cuerpo conserva la apertura editorial contextual', async ({ page }, info) => {
  await openLab(page);
  const card = page.getByTestId('card-transparent');
  await card.focus();
  const before = await rect(page, 'transparent');
  const body = card.getByText('Texto transparente conservado.', { exact: true });
  if (info.project.use.hasTouch) {
    const box = await body.boundingBox();
    if (!box) throw new Error('Cuerpo no visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole('textbox', { name: 'Contenido visual', exact: true })).toHaveCount(0);
    await page.touchscreen.tap(x, y);
  } else await body.dblclick();
  if (info.project.use.hasTouch) {
    await expect(page.getByRole('textbox', { name: 'Contenido visual', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Volver al tablero', exact: true }).click();
  } else await expect(page.getByTestId('inline-card-editor')).toBeVisible();
  expect(await rect(page, 'transparent')).toEqual(before);
});

test('B7 correctivo: PDF sin cabecera tiene agarre interior sin cubrir contenido ni asas', async ({ page }, info) => {
  await openLab(page);
  await zoom(page, 0.5);
  await select(page, 'pdf');
  const card = page.getByTestId('card-pdf');
  const grip = page.getByTestId('card-move-pdf');
  for (const scale of [1, 0.5]) {
  await zoom(page, scale);
  // Zoom stays anchored to the pointer; explicitly focus/reveal the Card before visual geometry.
  await page.getByTestId('board-canvas').focus();
  await card.focus();
  const box = (await card.boundingBox())!;
  expect(await grip.count(), JSON.stringify(box)).toBe(1);
  const hit = (await grip.boundingBox())!;
  expect(hit.x).toBeGreaterThanOrEqual(box.x);
  expect(hit.y).toBeGreaterThanOrEqual(box.y);
  expect(hit.x + hit.width).toBeLessThanOrEqual(box.x + box.width);
  expect(hit.y + hit.height).toBeLessThanOrEqual(box.y + box.height);
  expect(hit.width).toBeCloseTo(44, 1);
  expect(hit.height).toBeCloseTo(44, 1);
  const viewport = (await page.getByTestId('board-canvas').boundingBox())!;
  expect(hit.x).toBeGreaterThanOrEqual(viewport.x);
  expect(hit.y).toBeGreaterThanOrEqual(viewport.y);
  expect(hit.x + hit.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  expect(hit.y + hit.height).toBeLessThanOrEqual(viewport.y + viewport.height);
  const content = page.getByTestId('document-icon-pdf').or(page.getByTestId('compact-card-pdf').getByText('PDF', { exact: true }));
  const visibleContent = (await content.boundingBox())!;
  expect(Math.max(0, Math.min(hit.x + hit.width, visibleContent.x + visibleContent.width) - Math.max(hit.x, visibleContent.x))
    * Math.max(0, Math.min(hit.y + hit.height, visibleContent.y + visibleContent.height) - Math.max(hit.y, visibleContent.y))).toBe(0);
  for (const handle of await page.locator('[data-testid^="resize-"][data-testid$="-pdf"]').all()) {
    const other = (await handle.boundingBox())!;
    expect(Math.max(0, Math.min(hit.x + hit.width, other.x + other.width) - Math.max(hit.x, other.x))
      * Math.max(0, Math.min(hit.y + hit.height, other.y + other.height) - Math.max(hit.y, other.y))).toBe(0);
  }
  if (scale === 1) await expect(page.locator('[data-testid^="resize-"][data-testid$="-pdf"]')).toHaveCount(8);
  await page.emulateMedia({ colorScheme: scale === 1 ? 'light' : 'dark' });
  await page.screenshot({ path: info.outputPath(`pdf-${scale === 1 ? '100-light' : '50-dark'}.png`) });
  }
  if (info.project.use.hasTouch) await grip.tap();
  else await grip.click();
  // The old action was deferred to the next frame; check after that boundary as well.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Volver al tablero', exact: true })).toHaveCount(0);
  await expect(grip).toHaveText('✥');
  expect(await grip.evaluate((node) => getComputedStyle(node).cursor)).toBe('move');
  expect(await grip.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  await card.focus();
  await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  expect(await grip.evaluate((node) => getComputedStyle(node).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
  const keyboardBefore = await rect(page, 'pdf');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  expect(await rect(page, 'pdf')).toEqual(keyboardBefore);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await rect(page, 'pdf')).x).toBeLessThan(keyboardBefore.x);
  await page.keyboard.press('Control+z');
  await expect.poll(() => rect(page, 'pdf')).toEqual(keyboardBefore);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('card-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar acciones de pdf', exact: true }).click();
  if (info.project.use.hasTouch) await openCardActions(page, 'pdf');
  else await grip.click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Abrir el Inspector de PDF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar acciones de pdf', exact: true }).click();
  const before = await rect(page, 'pdf');
  if (info.project.use.hasTouch) await touchDrag(page, 'card-move-pdf', -40, 0);
  else await drag(page, 'card-move-pdf', -40, 0);
  await expect.poll(async () => (await rect(page, 'pdf')).x).toBeLessThan(before.x);
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  const after = await rect(page, 'pdf');
  await card.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => rect(page, 'pdf')).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => rect(page, 'pdf')).toEqual(after);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const downloadPath = info.outputPath('position.zip');
  await (await downloadEvent).saveAs(downloadPath);
  const reopened = value(readWorkspaceArchive(new Uint8Array(readFileSync(downloadPath)))).workspace;
  expect(reopened.layouts?.[0]?.placements.find((p) => p.cardId === 'pdf')?.rect.x).toBeLessThan(10);
  await openLab(page, reopened);
  expect(await rect(page, 'pdf')).toEqual(after);
  await zoom(page, 0.5);
  await select(page, 'pdf');
  await page.screenshot({ path: info.outputPath('pdf-grip.png') });
});

test('B7 correctivo: cabecera sin barra exterior conserva arrastre y menús accesibles', async ({ page }, info) => {
  await openLab(page);
  await select(page, 'idea-b');
  await expect(page.getByTestId('card-move-idea-b')).toHaveCount(0);
  await expect(page.locator('[data-testid^="card-options-"]')).toHaveCount(0);
  if (info.project.use.hasTouch) {
    await page.getByTestId('card-actions-idea-b').tap();
    await expect(page.getByTestId('card-menu')).toBeVisible();
    await page.getByRole('button', { name: /^Cerrar.*menú|^Cerrar.*nota/i }).first().click();
  }
  const before = await rect(page, 'idea-b');
  if (info.project.use.hasTouch) await touchDrag(page, 'card-header-idea-b', 40, 0);
  else await drag(page, 'card-header-idea-b', 40, 0);
  await expect.poll(() => rect(page, 'idea-b')).not.toEqual(before);
  await expect(page.getByTestId('card-menu')).toHaveCount(0);
  if (!info.project.use.hasTouch) {
    await page.getByTestId('card-idea-b').click({ button: 'right' });
    await expect(page.getByTestId('card-menu')).toBeVisible();
    await page.getByRole('button', { name: /^Cerrar.*menú|^Cerrar.*nota/i }).first().click();
  }
  await page.getByTestId('card-idea-b').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('card-menu')).toBeVisible();
  await page.getByRole('button', { name: /^Cerrar.*menú|^Cerrar.*nota/i }).first().click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: info.outputPath(`header-${colorScheme}.png`) });
  }
  const source = canvasCardsWorkspace();
  await openLab(page, { ...source, layouts: source.layouts?.map((layout, index) => index !== 0 ? layout : {
    ...layout, placements: layout.placements.map((placement) => placement.cardId !== 'idea-b' ? placement
      : { ...placement, rect: { ...placement.rect, w: 2, h: 2 } }),
  }) });
  await zoom(page, 1);
  await select(page, 'idea-b');
  const smallGrip = page.getByTestId('card-move-idea-b');
  const smallActions = page.getByTestId('card-actions-idea-b');
  expect(await smallGrip.count() + await smallActions.count() + await page.getByTestId('card-header-idea-b').count()).toBeGreaterThan(0);
  if (await smallGrip.count() && await smallActions.count()) {
    const grip = (await smallGrip.boundingBox())!;
    const actions = (await smallActions.boundingBox())!;
    expect(Math.max(0, Math.min(grip.x + grip.width, actions.x + actions.width) - Math.max(grip.x, actions.x))
      * Math.max(0, Math.min(grip.y + grip.height, actions.y + actions.height) - Math.max(grip.y, actions.y))).toBe(0);
  }
  if (info.project.use.hasTouch && !await smallGrip.count()) {
    await smallActions.tap();
    await expect(page.getByTestId('card-menu')).toBeVisible();
  }
});
