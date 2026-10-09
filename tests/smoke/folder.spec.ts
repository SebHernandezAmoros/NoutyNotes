
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { borderWidth, expandPosition, fontSize, insertFromMenu, openCardActions, openFullCardEditor, openMarkdownEditor, openMore, openSettings } from './support';

const fakeFolder = `
(() => {
  const storeKey = 'nouty-test-folder';
  const data = () => JSON.parse(localStorage.getItem(storeKey) || '{}');
  const put = (value) => localStorage.setItem(storeKey, JSON.stringify(value));
  const missing = () => Object.assign(new Error('Missing'), { name: 'NotFoundError' });
  const directory = (prefix = '') => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || 'Nouty',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(name, options = {}) {
      const path = prefix + name + '/';
      const files = data();
      if (!options.create && !Object.keys(files).some((key) => key.startsWith(path))) throw missing();
      return directory(path);
    },
    async getFileHandle(name, options = {}) {
      const path = prefix + name;
      if (!options.create && !(path in data())) throw missing();
      return {
        getFile: async () => new Blob([new Uint8Array(data()[path])]),
        createWritable: async () => {
          let bytes;
          return {
            write: async (value) => { bytes = Array.from(value); },
            close: async () => {
              if (window.__holdNoutyWrite) {
                window.__holdNoutyWrite = false;
                await new Promise((resolve) => { window.__releaseNoutyWrite = resolve; });
                window.__releaseNoutyWrite = null;
              }
              const files = data(); files[path] = bytes; put(files);
            },
          };
        },
      };
    },
    async removeEntry(name) { const files = data(); delete files[prefix + name]; put(files); },
    async *entries() {
      const children = new Map();
      for (const key of Object.keys(data())) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [first, ...tail] = rest.split('/');
        if (first) children.set(first, tail.length ? directory(prefix + first + '/') : { kind: 'file' });
      }
      yield* children;
    },
  });
  window.showDirectoryPicker = async () => directory();
})();`;

async function openCardEditor(page: Page, id: number) {
  if (await page.getByTestId('card-inspector').isVisible()) return;
  await openFullCardEditor(page, page.getByTestId(`card-tarjeta-${id}`));
}

test('carpeta web: crear, guardar, recargar y reconectar sin perder las tarjetas', async ({ page }, testInfo) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Abrir una carpeta' })).toBeEnabled();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  await page.getByLabel('Nombre del nuevo espacio').fill('Mi carpeta');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Mi carpeta' })).toBeVisible();
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openCardEditor(page, 1);
  await page.getByLabel('Título de la tarjeta').fill('Nota persistente');
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota persistente');
  await expect(page.getByTestId('workspace-feedback')).toContainText('Guardado en la carpeta');
  await page.screenshot({ path: testInfo.outputPath('folder-saved.png'), fullPage: true });
  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByRole('button', { name: 'Abrir Mi carpeta' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir Mi carpeta' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota persistente');
  await page.screenshot({ path: testInfo.outputPath('folder-reconnected.png'), fullPage: true });
});

test('E3-A: IndexedDB recupera un borrador editorial después de recargar sin alterar la nota durable', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Recuperación privada');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await openCardEditor(page, 1);
  const editor = await openMarkdownEditor(page);
  await editor.fill('BORRADOR PRIVADO TRAS REINICIO');
  // Es la confirmación observable de IndexedDB; se recarga antes del autosave posterior del workspace.
  await expect(page.getByTestId('draft-recovery')).toBeVisible();
  await expect(page.getByTestId('draft-source')).toContainText('BORRADOR PRIVADO TRAS REINICIO');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Recuperación privada' }).click();
  await expect(page.getByTestId('draft-recovery')).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar el primer borrador pendiente' }).click();
  // La nota compatible abre en el editor visual actual; E3-A recupera el documento, no cambia de modo.
  await expect(page.getByLabel('Contenido visual').locator('p')).toHaveText('BORRADOR PRIVADO TRAS REINICIO');
});

test('P07: el formato visual avanzado sobrevive al archivo Markdown, la recarga y la reconexión', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Documento avanzado');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await openCardEditor(page, 1);
  const expand = page.getByRole('button', { name: 'Ampliar el editor' });
  if (await expand.count() > 0) await expand.click();

  await page.getByRole('button', { name: 'Volver al editor Markdown' }).click();
  await page.getByLabel('Contenido Markdown').fill('## Plan [sitio](https://example.com)\n\n- Uno\n\n- [ ] Pendiente');
  await page.getByRole('button', { name: 'Abrir editor visual' }).click();
  const visual = page.getByLabel('Contenido visual');
  await visual.locator('h2').selectText();
  await page.keyboard.press('Control+Alt+3');
  await expect(visual.locator('h3')).toContainText('Plan sitio');
  await page.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(page.getByTestId('workspace-feedback')).toContainText('Guardado en la carpeta');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Documento avanzado' }).click();
  await openCardEditor(page, 1);
  const expandReopened = page.getByRole('button', { name: 'Ampliar el editor' });
  if (await expandReopened.count() > 0) await expandReopened.click();
  const reopened = page.getByLabel('Contenido visual');
  await expect(reopened.locator('h3')).toContainText('Plan sitio');
  await expect(reopened.locator('a')).toHaveAttribute('href', 'https://example.com');
  await expect(reopened.locator('li')).toContainText(['Uno', 'Pendiente']);
  await expect(reopened.locator('li[role="checkbox"]')).toHaveAttribute('aria-checked', 'false');
});

test('arrastre con escritura retenida: la tarjeta permanece en destino hasta confirmar el guardado', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Arrastre pendiente');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  const card = page.getByTestId('card-tarjeta-1');
  const origin = await card.boundingBox();
  if (!origin) throw new Error('La tarjeta no tiene geometría');
  const row = (page.viewportSize()?.width ?? 0) >= 800 ? 64 : 56;
  await page.evaluate(() => {
    (window as unknown as { __holdNoutyWrite: boolean }).__holdNoutyWrite = true;
  });
  await page.mouse.move(origin.x + 20, origin.y + 12);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(origin.x + 20, origin.y + 12 + 3 * row * step / 10);
  await page.mouse.up();
  try {
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __releaseNoutyWrite?: () => void }).__releaseNoutyWrite))).toBe(true);
    // Dejar pasar varios fotogramas del navegador mientras la escritura sigue bloqueada detecta el
    // regreso visual al origen, que un expect posterior al guardado no podría observar.
    const positions = await page.evaluate(async () => {
      const top: number[] = [];
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const element = document.querySelector('[data-testid="card-tarjeta-1"]');
        if (element) top.push(element.getBoundingClientRect().top);
      }
      return top;
    });
    expect(positions).toHaveLength(8);
    expect(positions.every((top) => top >= origin.y + 2.5 * row)).toBe(true);
  } finally {
    await page.evaluate(() => (window as unknown as { __releaseNoutyWrite?: () => void }).__releaseNoutyWrite?.());
  }
  await expect(page.getByTestId('workspace-feedback')).toContainText('Guardado en la carpeta');
  await expect.poll(async () => (await card.boundingBox())?.y ?? -1).toBeGreaterThan(origin.y + 2.5 * row);
});

test('carpeta web: posición negativa y lejana (más allá de 12 columnas) conserva formato v2 y se reabre en el mismo lugar', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  const press = (name: string) => page.getByRole('button', { name, exact: true }).click();
  const geometry = page.getByTestId('card-geometry');
  const layoutText = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const bytes = files['mundo/.nouty/layout.yaml'];
    return bytes ? new TextDecoder().decode(new Uint8Array(bytes)) : '';
  });
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Mundo');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  // A la izquierda y por encima del origen: coordenadas negativas en ambos ejes.
  await press('Mover a la izquierda');
  await press('Mover arriba');
  await press('Mover arriba');
  await expect(geometry).toHaveText('X -1, Y -2 · 4 × 3');
  await expect.poll(layoutText).toContain('schemaVersion: 2');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();

  // Otra tarjeta, lejos: más allá de la columna 12 del formato antiguo y muy abajo.
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('card-tarjeta-2')).toHaveAttribute('aria-pressed', 'true');
  await openCardEditor(page, 2);
  // La geometría se lee «Columna c, fila f» o, con alguna coordenada negativa, «X x, Y y».
  const cell = async () => {
    const text = await geometry.innerText();
    const grid = /Columna (\d+), fila (\d+)/.exec(text);
    if (grid) return { x: Number(grid[1]) - 1, y: Number(grid[2]) - 1 };
    const world = /X (-?\d+), Y (-?\d+)/.exec(text);
    if (!world) throw new Error(`Geometría ilegible: ${text}`);
    return { x: Number(world[1]), y: Number(world[2]) };
  };
  // Cada paso espera a que se guarde el anterior (la geometría cambia) antes de volver a pulsar.
  const step = async (name: string) => {
    const before = await cell();
    await press(name);
    await expect.poll(cell).not.toEqual(before);
  };
  while ((await cell()).x < 20) await step('Mover a la derecha');
  while ((await cell()).y < 30) await step('Mover abajo');
  await expect(geometry).toHaveText('Columna 21, fila 31 · 4 × 3');
  await expect.poll(layoutText).toMatch(/cardId: tarjeta-2[\s\S]*?x: 20\n\s+"y": 30/);

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Mundo' }).click();
  // La cámara arranca en el origen: la lejana no se ve hasta enfocarla; el foco la trae con el pan.
  const canvas = await page.getByTestId('board-canvas').boundingBox();
  if (!canvas) throw new Error('Sin lienzo');
  expect((await page.getByTestId('card-tarjeta-2').boundingBox())?.y ?? 0).toBeGreaterThan(canvas.y + canvas.height);
  await page.getByTestId('card-tarjeta-2').focus();
  await page.keyboard.press('Space');
  // Un clic normal fallaría aquí: a esta distancia el botón «Editar» (esquina inferior izquierda de la
  // tarjeta) puede coincidir en pantalla con el minimapa/zoom flotante (zIndex superior a propósito,
  // para que las tarjetas nunca lo tapen). El teclado activa el mismo botón sin depender de su posición.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  await expect(geometry).toHaveText('Columna 21, fila 31 · 4 × 3');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  const far = await page.getByTestId('card-tarjeta-2').boundingBox();
  const frame = await page.getByTestId('board-canvas').boundingBox();
  expect(far && frame && far.y >= frame.y && far.y < frame.y + frame.height).toBe(true);
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Space');
  await openCardEditor(page, 1);
  await expect(geometry).toHaveText('X -1, Y -2 · 4 × 3');
});

test('P2: una tarjeta a casi un millón de celdas se pinta con coordenadas pequeñas, sin perder precisión', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  const press = (name: string) => page.getByRole('button', { name, exact: true }).click();
  await press('Abrir una carpeta');
  await page.getByLabel('Nombre del nuevo espacio').fill('Lejos');
  await press('Crear un espacio');
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  // Otra aplicación (o un editor de texto) deja la tarjeta en x = 999 000, y = -999 000 con layout v2.
  await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const text = new TextDecoder().decode(new Uint8Array(files['lejos/.nouty/layout.yaml'] ?? []));
    const far = text.replace('schemaVersion: 1', 'schemaVersion: 2').replace(/x: 0\n(\s+)"y": 0/, 'x: 999000\n$1"y": -999000');
    files['lejos/.nouty/layout.yaml'] = Array.from(new TextEncoder().encode(far));
    localStorage.setItem('nouty-test-folder', JSON.stringify(files));
  });
  await page.reload();
  await press('Volver a mis espacios');
  await press('Abrir una carpeta');
  await press('Abrir Lejos');
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Space');
  await openCardEditor(page, 1);
  await expect(page.getByTestId('card-geometry')).toHaveText('X 999000, Y -999000 · 4 × 3');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  // Con la cámara allí, lo pintado usa números pequeños: el compositor trabaja en coma flotante de
  // 32 bits (unos 16,7 millones exactos) y a -96 millones de píxeles la tarjeta se pintaba rota.
  const painted = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="canvas-content"]') as HTMLElement;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
    const wrap = document.querySelector('[data-testid="card-tarjeta-1"]')?.parentElement as HTMLElement;
    return [matrix.m41, matrix.m42, parseFloat(wrap.style.left), parseFloat(wrap.style.top)].map((value) => Math.abs(value));
  });
  expect(Math.max(...painted)).toBeLessThan(100_000);
  const [card, frame] = [await page.getByTestId('card-tarjeta-1').boundingBox(), await page.getByTestId('board-canvas').boundingBox()];
  expect(card && frame && card.x >= frame.x && card.y >= frame.y && card.x + card.width <= frame.x + frame.width).toBe(true);
});

test('P3: título flotante y checklist Markdown se guardan y reaparecen desde la carpeta', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Editorial');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar título flotante');
  await expect(page.getByTestId('floating-title-tarjeta-1')).toBeVisible();
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Proyecto Solace');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  const editor = await openMarkdownEditor(page);
  await page.getByRole('button', { name: 'Insertar lista de tareas' }).click();
  await expect(editor).toHaveValue('- [ ] ');
  await editor.focus();
  await editor.press('End');
  await editor.type('Primera');
  await editor.press('Enter');
  await expect(editor).toHaveValue('- [ ] Primera\n- [ ] ');
  await page.getByRole('button', { name: 'Marcar tarea Primera' }).click();
  await expect(editor).toHaveValue('- [x] Primera\n- [ ] ');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect.poll(() => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const title = files['editorial/cards/tarjeta-1.md'];
    const note = files['editorial/cards/tarjeta-2.md'];
    return title && note ? [title, note].map((bytes) => new TextDecoder().decode(new Uint8Array(bytes))) : [];
  })).toEqual([expect.stringContaining('title: Proyecto Solace'), expect.stringContaining('- [x] Primera')]);
  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Editorial' }).click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
  // En la cabecera, no en el cuerpo: con la ficha mostrando su checklist (UX7-B2), un clic en el centro
  // caería sobre una fila y la marcaría/desmarcaría en vez de solo seleccionar la tarjeta.
  await page.getByTestId('card-tarjeta-2').click({ position: { x: 10, y: 10 } });
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  await expect(await openMarkdownEditor(page)).toHaveValue('- [x] Primera\n- [ ] ');
});

test('cancelar el selector conserva el modo de memoria y muestra un aviso', async ({ page }) => {
  await page.addInitScript({ content: `window.showDirectoryPicker = async () => { throw Object.assign(new Error('Cancelado'), { name: 'AbortError' }); };` });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByRole('alert')).toHaveText('No se seleccionó ninguna carpeta.');
  await expect(page.getByTestId('memory-notice')).toContainText('SOLO EN MEMORIA');
});

test('un cambio externo bloquea el siguiente guardado y conserva sus bytes', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Conflicto');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  const changed = await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const path = 'conflicto/.nouty/workspace.yaml';
    const source = files[path];
    if (!source) throw new Error('No se creó el manifiesto.');
    const original = new TextDecoder().decode(new Uint8Array(source));
    const external = original.replace('name: Conflicto', 'name: Externo');
    files[path] = Array.from(new TextEncoder().encode(external));
    localStorage.setItem('nouty-test-folder', JSON.stringify(files));
    return external;
  });
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('workspace-feedback')).toContainText('cambiaron fuera de NoutyNotes');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const source = files['conflicto/.nouty/workspace.yaml'];
    if (!source) throw new Error('Desapareció el manifiesto.');
    return new TextDecoder().decode(new Uint8Array(source));
  })).toBe(changed);
});

test('salir del editor inmediatamente conserva el texto pendiente en la carpeta', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Salida rápida');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Título pendiente');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir Salida rápida' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Título pendiente');
});

test('volver al inicio inmediatamente espera al guardado del borrador', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Navegación');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Antes de salir');
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir Navegación' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Antes de salir');
});

test('cambiar de proyecto guarda antes el texto pendiente en su carpeta (ADR 0016)', async ({ page }) => {
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>);
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  for (const name of ['Uno', 'Dos']) {
    await page.getByLabel('Nombre del nuevo espacio').fill(name);
    await page.getByRole('button', { name: 'Crear un espacio' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    if (name === 'Uno') await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  }
  await insertFromMenu(page, 'Insertar nota');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Borrador sin guardar');
  // Sin pulsar «Guardar texto»: cambiar de proyecto desde el selector de cabecera (ADR 0048, ya no hay
  // franja de proyectos aparte en ningún ancho).
  await page.getByRole('button', { name: 'Cambiar de proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Ir al proyecto Uno', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uno', exact: true })).toBeVisible();
  const card = new TextDecoder().decode(new Uint8Array((await files())['dos/cards/tarjeta-1.md'] ?? []));
  expect(card).toContain('titleRichText:');
  expect(card).toContain('text: Borrador sin guardar');
});

test('recargar con texto pendiente exige confirmar la salida', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Recarga');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Pendiente');
  const warning = page.waitForEvent('dialog');
  void page.evaluate(() => window.location.reload());
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Pendiente');
});

test('un fallo al guardar el borrador mantiene abierto el editor y conserva el texto', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Borrador en conflicto');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    const path = 'borrador-en-conflicto/.nouty/workspace.yaml';
    const source = files[path];
    if (!source) throw new Error('No se creó el manifiesto.');
    const original = new TextDecoder().decode(new Uint8Array(source));
    files[path] = Array.from(new TextEncoder().encode(original.replace('name: Borrador en conflicto', 'name: Externo')));
    localStorage.setItem('nouty-test-folder', JSON.stringify(files));
  });
  await page.getByLabel('Título de la tarjeta').fill('Texto que debo conservar');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect(page.getByTestId('workspace-feedback')).toContainText('cambiaron fuera de NoutyNotes');
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Texto que debo conservar');
});

test('carpeta: arrastrar guarda el layout y un destino inválido no cambia ningún archivo (ADR 0013)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Lienzo');
  await page.getByRole('button', { name: 'Crear un espacio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lienzo', exact: true })).toBeVisible();
  for (const id of [1, 2]) {
    await insertFromMenu(page, 'Insertar nota');
    await expect(page.getByTestId(`card-tarjeta-${id}`)).toBeVisible();
  }
  // Dónde nace la segunda tarjeta depende del viewport (a la derecha en escritorio, debajo en móvil,
  // ADR 0004): se lee su posición real y se mueve el desplazamiento exacto que haga falta.
  const press = (name: string) => page.getByRole('button', { name, exact: true }).click();
  const geometry = page.getByTestId('card-geometry');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  const pos = async () => {
    const text = await geometry.innerText();
    const grid = /Columna (\d+), fila (\d+)/.exec(text);
    if (grid) return { x: Number(grid[1]) - 1, y: Number(grid[2]) - 1 };
    const world = /X (-?\d+), Y (-?\d+)/.exec(text);
    if (!world) throw new Error(`Geometría ilegible: ${text}`);
    return { x: Number(world[1]), y: Number(world[2]) };
  };
  const step = async (name: string) => {
    const beforeStep = await pos();
    await press(name);
    await expect.poll(pos).not.toEqual(beforeStep);
  };
  while ((await pos()).x < 4) await step('Mover a la derecha');
  while ((await pos()).x > 4) await step('Mover a la izquierda');
  while ((await pos()).y > 0) await step('Mover arriba');
  while ((await pos()).y < 0) await step('Mover abajo');
  await expect(geometry).toHaveText('Columna 5, fila 1 · 4 × 3');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) < 800) {
    await openSettings(page);
    await press('Restablecer la vista del lienzo');
    await press('Cerrar configuración');
  } else {
    await page.getByTestId('zoom-level').click();
  }
  // Celda cuadrada (UX7-D1): 48 px de fila (40 en compacto) al zoom inicial de 100 %.
  const cell = (page.viewportSize()?.width ?? 0) >= 800 ? { x: 48, y: 48 } : { x: 40, y: 40 };
  const snapshot = () => page.evaluate(() => localStorage.getItem('nouty-test-folder') ?? '');
  const layout = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['lienzo/.nouty/layout.yaml'] ?? []));
  });
  const drag = async (dx: number, dy: number) => {
    const found = await page.getByTestId('card-tarjeta-1').boundingBox();
    if (!found) throw new Error('Sin tarjeta');
    await page.mouse.move(found.x + 40, found.y + 12);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(found.x + 40 + (dx * step) / 10, found.y + 12 + (dy * step) / 10);
    await page.mouse.up();
  };

  // Colisión: se rechaza antes de guardar y los archivos quedan idénticos.
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  const before = await snapshot();
  await drag(2 * cell.x, 0);
  await expect(page.getByTestId('workspace-feedback')).toContainText('No se guardó el cambio. Ahí se solaparía con otra tarjeta');
  expect(await snapshot()).toBe(before);

  // Destino válido: el caso de uso reescribe layout.yaml con la nueva fila.
  await drag(0, 4 * cell.y);
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta movida. Guardado en la carpeta.');
  await expect.poll(layout).toContain('"y": 4');
  expect(await layout()).toMatch(/cardId: tarjeta-1[\s\S]*?x: 0\n\s+"y": 4/);
});

test('carpeta: imagen real, representación y Papelera sobreviven a recargar; eliminar definitivamente borra el binario (ADR 0015)', async ({ page }) => {
  // PNG real de 1 × 1: la carpeta simulada guarda cada byte como número JSON en localStorage y relee
  // todo el almacén en cada acceso; con el icono de 942 KB la prueba superaba los 30 s en la suite completa.
  const icon = { name: 'app-icon.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Galería');
  await button('Crear un espacio').click();
  await expect(page.getByRole('heading', { name: 'Galería', exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await insertFromMenu(page, 'Importar una imagen');
  await (await chooser).setFiles(icon);
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  expect((await files())['galeria/assets/images/tarjeta-1.png']).toEqual([...icon.buffer]);
  for (const [index, title] of ['Mínima', 'Borrador'].entries()) {
    const cardId = `card-tarjeta-${index + 2}`;
    if (await page.getByTestId('card-inspector').isVisible()) await button('Cerrar el editor de la tarjeta').click();
    await insertFromMenu(page, 'Insertar nota');
    // Esperar a que la tarjeta nueva quede seleccionada y abrir su editor antes de escribir (crear ya
    // no lo abre por sí solo, auditoría de interacción, 2026-09-29).
    await expect(page.getByTestId(cardId)).toHaveAttribute('aria-pressed', 'true');
    await openFullCardEditor(page, page.getByTestId(cardId));
    await page.getByLabel('Título de la tarjeta').fill(title);
    await button('Guardar texto').click();
    await expect(page.getByTestId(cardId)).toContainText(title);
  }
  await button('Cerrar el editor de la tarjeta').click();
  await openCardActions(page, page.getByTestId('card-tarjeta-3'), 'Borrador');
  await button('Enviar Borrador a la Papelera').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta enviada a la Papelera. Guardado en la carpeta.');
  await page.getByTestId('card-tarjeta-2').click();
  await openCardActions(page, page.getByTestId('card-tarjeta-2'), 'Mínima');
  await button('Minimizar Mínima').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta minimizada. Guardado en la carpeta.');
  expect(Object.keys(await files())).toContain('galeria/.nouty/trash.yaml');

  // Recargar y reconectar: todo sale de los archivos de la carpeta.
  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Galería').click();
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  await expect(page.getByTestId('minimized-tarjeta-2')).toBeVisible();
  await button('Abrir la Papelera (1)').click();
  await expect(page.getByTestId('trash-item-tarjeta-3')).toContainText('Borrador');
  await button('Cerrar papelera').click();

  // La imagen a la Papelera y eliminada definitivamente: su binario sale de la carpeta.
  await page.getByTestId('card-tarjeta-1').click();
  await openCardActions(page, page.getByTestId('card-tarjeta-1'), 'app-icon');
  await button('Enviar app-icon a la Papelera').click();
  expect(Object.keys(await files())).toContain('galeria/assets/images/tarjeta-1.png');
  await button('Abrir la Papelera (2)').click();
  await button('Eliminar definitivamente app-icon').click();
  await button('Confirmar eliminar definitivamente app-icon').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta eliminada definitivamente. Guardado en la carpeta.');
  expect(Object.keys(await files())).not.toContain('galeria/assets/images/tarjeta-1.png');
});

test('carpeta: las etiquetas se guardan en la tarjeta como v2, sobreviven a recargar y al quitarlas vuelve a v1 (ADR 0019)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Rutas');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Kioto');
  await page.getByTestId('tag-input').fill('#Japón');
  await page.getByRole('button', { name: 'Añadir la etiqueta' }).click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Etiqueta añadida. Guardado en la carpeta.');
  // Una etiqueta rechazada no escribe nada: su aviso no convierte la cabecera en «error al guardar».
  await page.getByRole('button', { name: 'Añadir la etiqueta' }).click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Escribe un nombre para la etiqueta.');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): sin tocarla queda
  // seleccionada, sin etiquetas, tal como necesita este contraste.
  await insertFromMenu(page, 'Insertar nota');
  const cards = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return ['rutas/cards/tarjeta-1.md', 'rutas/cards/tarjeta-2.md'].map((path) => new TextDecoder().decode(new Uint8Array(files[path] ?? [])));
  });
  // Las tarjetas nuevas llevan fecha de creación (v3, ADR 0024); solo la que tiene etiquetas las guarda.
  await expect.poll(cards).toEqual([
    expect.stringMatching(/schemaVersion: 3[\s\S]*tags:\s*\n\s*- japón/),
    expect.stringMatching(/createdAt: /),
  ]);
  expect((await cards())[1]).toContain('schemaVersion: 3');
  expect((await cards())[1]).not.toContain('tags');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Rutas' }).click();
  await expect(page.getByTestId('card-tags-tarjeta-1')).toHaveText('#japón');
  await page.getByRole('button', { name: 'Abrir la búsqueda' }).click();
  await page.getByTestId('search-input').fill('#japon');
  await expect(page.getByTestId('search-count')).toHaveText('1 RESULTADO');
  await page.getByRole('button', { name: 'Quitar la etiqueta japón de todas las tarjetas' }).click();
  await page.getByRole('button', { name: 'Confirmar quitar japón de todas' }).click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Etiqueta quitada de todas las tarjetas. Guardado en la carpeta.');
  await expect.poll(async () => (await cards())[0]).not.toContain('tags');
  // Sin etiquetas sigue en v3 por su fecha de creación.
  expect((await cards())[0]).toContain('schemaVersion: 3');
});

test('carpeta: la excepción de marco por ficha se guarda en la tarjeta como v5, sobrevive a recargar y, al quitarla, vuelve a la versión anterior (UX7-D3, ADR 0049)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Marcos');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByRole('button', { name: 'Ocultar siempre' }).click();
  await expect(page.getByRole('button', { name: 'Ocultar siempre' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Apariencia actualizada. Guardado en la carpeta.');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  const card = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['marcos/cards/tarjeta-1.md'] ?? []));
  });
  // La tarjeta ya llevaba fecha de creación (v3, ADR 0024); la excepción de marco la sube a v5.
  await expect.poll(card).toContain('schemaVersion: 5');
  expect(await card()).toContain('frameOverride: hidden');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Marcos' }).click();
  await expect.poll(() => borderWidth(page.getByTestId('card-tarjeta-1'))).toBe(0);

  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByRole('button', { name: 'Según preferencia' }).click();
  await expect(page.getByRole('button', { name: 'Según preferencia' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect.poll(card).not.toContain('frameOverride');
  expect(await card()).toContain('schemaVersion: 3');
});

test('carpeta: el tamaño de título/cuerpo por ficha se guarda en la tarjeta como v6, sobrevive a recargar y, al volver a mediano, vuelve a la versión anterior (UX7-D4, ADR 0050)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Medidas');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Medidas');
  await page.getByRole('button', { name: 'Título grande' }).click();
  await expect(page.getByRole('button', { name: 'Título grande' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Apariencia actualizada. Guardado en la carpeta.');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  const card = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['medidas/cards/tarjeta-1.md'] ?? []));
  });
  // La tarjeta ya llevaba fecha de creación (v3, ADR 0024); el tamaño de título la sube a v6.
  await expect.poll(card).toContain('schemaVersion: 6');
  expect(await card()).toContain('titleSize: large');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Medidas' }).click();
  await expect.poll(() => fontSize(page.getByTestId('card-tarjeta-1').getByText('Medidas'))).toBe(20);

  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByRole('button', { name: 'Título mediano' }).click();
  await expect(page.getByRole('button', { name: 'Título mediano' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect.poll(card).not.toContain('titleSize');
  expect(await card()).toContain('schemaVersion: 3');
});

test('carpeta: la posición de la leyenda por ficha se guarda en la tarjeta como v7, sobrevive a recargar y, al volver a debajo, vuelve a la versión anterior (ADR 0051)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Leyendas');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  // Más alta: a la densidad por defecto (UX7-D1) el presupuesto vertical de la ficha no deja sitio
  // para la leyenda sin encogerla por debajo del mínimo, y UX7-C4 la omite antes que recortar la
  // imagen — hace falta más alto para que esta prueba vea la leyenda en vez de omitirla.
  await page.getByRole('button', { name: 'Más alta' }).click();
  await page.getByRole('button', { name: 'Más alta' }).click();
  await (await openMarkdownEditor(page)).fill('![Vista del lago](assets/images/x.png)');
  await page.getByRole('button', { name: 'Guardar texto' }).click();
  await page.getByRole('button', { name: 'Leyenda a la izquierda de la imagen' }).click();
  await expect(page.getByRole('button', { name: 'Leyenda a la izquierda de la imagen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Apariencia actualizada. Guardado en la carpeta.');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  const card = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['leyendas/cards/tarjeta-1.md'] ?? []));
  });
  // La tarjeta ya llevaba fecha de creación (v3, ADR 0024); la posición de la leyenda la sube a v7.
  await expect.poll(card).toContain('schemaVersion: 7');
  expect(await card()).toContain('captionPosition: left');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Leyendas' }).click();
  const image = page.getByTestId('note-preview-tarjeta-1').locator('[aria-label*="Imagen no disponible"]');
  const caption = page.getByTestId('note-preview-tarjeta-1').getByText('Vista del lago', { exact: true });
  await expect.poll(async () => ((await image.boundingBox())?.x ?? 0) > ((await caption.boundingBox())?.x ?? 0)).toBe(true);

  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByRole('button', { name: 'Leyenda debajo de la imagen' }).click();
  await expect(page.getByRole('button', { name: 'Leyenda debajo de la imagen' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect.poll(card).not.toContain('captionPosition');
  expect(await card()).toContain('schemaVersion: 3');
});

test('carpeta: el enlace se guarda en fields de la tarjeta y la búsqueda global lee los proyectos de la carpeta (ADR 0020)', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Fuentes');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar enlace');
  await page.getByTestId('link-url-input').fill('https://archivo.example.org/mapa');
  await page.getByTestId('link-title-input').fill('Mapa antiguo');
  await page.getByRole('button', { name: 'Crear enlace' }).click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Enlace añadido. Guardado en la carpeta.');
  const file = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['fuentes/cards/tarjeta-1.md'] ?? []));
  });
  await expect.poll(file).toContain('url: https://archivo.example.org/mapa');
  expect(await file()).toContain('schemaVersion: 3');
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Notas');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Notas', exact: true })).toBeVisible();

  // Otra sesión: recargar y reconectar la carpeta; la búsqueda global encuentra el enlace por su dirección.
  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Notas' }).click();
  await page.getByRole('button', { name: 'Abrir la búsqueda' }).click();
  await page.getByRole('button', { name: 'Buscar en todos los proyectos (2)' }).click();
  await page.getByTestId('search-input').fill('archivo.example');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('search-all-count')).toHaveText('1 RESULTADO EN 1 PROYECTO');
  await page.getByRole('button', { name: 'Ir a Mapa antiguo' }).click();
  await expect(page.getByRole('heading', { name: 'Fuentes', exact: true })).toBeVisible();
  await expect(page.getByTestId('card-link-tarjeta-1')).toHaveText('↗ archivo.example.org/mapa');
  await expect(page.getByTestId('link-input')).toHaveValue('https://archivo.example.org/mapa');
});

test('carpeta: una nota con imágenes guarda la línea en el Markdown, assetRefs y el binario, y reaparece al recargar (ADR 0021)', async ({ page }) => {
  // PNG real de 1 × 1 (la carpeta simulada guarda cada byte en localStorage: se evita el icono grande).
  const png = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>);
  const text = async (path: string) => new TextDecoder().decode(new Uint8Array((await files())[path] ?? []));
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Diario');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  const editor = await openMarkdownEditor(page);
  await editor.fill('Primera parte.');
  await editor.press('End');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Insertar una imagen en la nota' }).click();
  await (await chooser).setFiles(png('plano.png'));
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Imagen «plano.png» insertada en la nota. Guardado en la carpeta.');
  await expect.poll(() => text('diario/cards/tarjeta-1.md')).toContain('Primera parte.\n\n![plano](assets/images/tarjeta-1-1.png)');
  expect(await text('diario/cards/tarjeta-1.md')).toMatch(/assetRefs:\s*\n\s*- assets\/images\/tarjeta-1-1\.png/);
  expect(await text('diario/cards/tarjeta-1.md')).toContain('schemaVersion: 3');
  expect((await files())['diario/assets/images/tarjeta-1-1.png']).toEqual([...png('x').buffer]);

  // UX7-C1: una segunda imagen en la misma nota, en una carpeta real (no en memoria) — el único
  // escenario de varias imágenes que esta suite no cubría todavía.
  await editor.press('Control+End');
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Insertar una imagen en la nota' }).click();
  await (await chooser2).setFiles(png('mapa.png'));
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Imagen «mapa.png» insertada en la nota. Guardado en la carpeta.');
  await expect.poll(() => text('diario/cards/tarjeta-1.md')).toContain('![mapa](assets/images/tarjeta-1-2.png)');
  expect(await text('diario/cards/tarjeta-1.md')).toMatch(/assetRefs:\s*\n\s*- assets\/images\/tarjeta-1-1\.png\s*\n\s*- assets\/images\/tarjeta-1-2\.png/);
  expect((await files())['diario/assets/images/tarjeta-1-1.png']).toEqual([...png('x').buffer]);
  expect((await files())['diario/assets/images/tarjeta-1-2.png']).toEqual([...png('x').buffer]);

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Diario' }).click();
  // Con la densidad de UX7-D1 (fila de 48 px en ancho, 40 en compacto; antes 56/48) ya no queda sitio
  // para ninguna imagen junto al texto en ningún ancho (el archivo y sus assetRefs no cambian por
  // esto). En escritorio todavía cabe el párrafo («+2 bloques más»); en compacto la fila de partida es
  // aún más baja y ya no cabe ni ese párrafo («+3»).
  await expect(page.getByTestId('note-preview-tarjeta-1'))
    .toContainText((page.viewportSize()?.width ?? 0) < 800 ? '+3 bloques más' : '+2 bloques más');
  // Quitar la imagen de la nota la saca de assetRefs, pero el archivo sigue en la carpeta (ADR 0021).
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Space');
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await openMarkdownEditor(page);
  await page.getByRole('button', { name: 'Quitar la imagen plano de la nota' }).click();
  await expect.poll(() => text('diario/cards/tarjeta-1.md')).not.toContain('assets/images/tarjeta-1-1.png');
  expect((await files())['diario/assets/images/tarjeta-1-1.png']).toBeDefined();
});

test('carpeta: la biblioteca lista lo que hay en assets/ (también lo que nada usa) y eliminar los sin usar lo borra de la carpeta (ADR 0022)', async ({ page }) => {
  const png = { name: 'Foto Suelta.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };
  const files = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>));
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Material');
  await button('Crear un espacio').click();
  await expect(page.getByRole('heading', { name: 'Material', exact: true })).toBeVisible();
  await openMore(page);
  await button('Abrir los assets').click();
  await expect(page.getByTestId('assets-empty')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await button('Importar una imagen a la biblioteca').click();
  await (await chooser).setFiles(png);
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Imagen «Foto Suelta.png» añadida a la biblioteca. Guardado en la carpeta.');
  await expect.poll(files).toContain('material/assets/images/foto-suelta.png');

  // Otra sesión: tras recargar y reconectar, el archivo sigue listado (sin tarjeta que lo use).
  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Material').click();
  await openMore(page);
  await button('Abrir los assets').click();
  await expect(page.getByTestId('assets-count')).toHaveText('1 ARCHIVO');
  await button('Eliminar los sin usar (1)').click();
  await button('Confirmar eliminar 1 archivo sin usar').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('1 archivo sin usar eliminado. Guardado en la carpeta.');
  await expect.poll(files).not.toContain('material/assets/images/foto-suelta.png');
  await expect(page.getByTestId('assets-empty')).toBeVisible();
});

test('carpeta: archivar crea .nouty/archive.yaml, sobrevive a recargar y restaurar lo quita (ADR 0023)', async ({ page }) => {
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Cajón');
  await button('Crear un espacio').click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await page.getByLabel('Título de la tarjeta').fill('Idea aparcada');
  // Cerrar el editor guarda el título pendiente (ADR 0014): «Archivar» ya no vive en el editor de
  // escritorio (ADR 0048), así que se cierra y se usa el menú contextual de la ficha.
  await button('Cerrar el editor de la tarjeta').click();
  await openCardActions(page, page.getByTestId('card-tarjeta-1'), 'Idea aparcada');
  await button('Archivar Idea aparcada').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta archivada. Guardado en la carpeta.');
  await expect.poll(async () => Object.keys(await files())).toContain('cajon/.nouty/archive.yaml');
  const archived = new TextDecoder().decode(new Uint8Array((await files())['cajon/.nouty/archive.yaml'] ?? []));
  expect(archived).toContain('title: Idea aparcada');
  expect(archived).toMatch(/archivedAt: "\d{4}-\d{2}-\d{2}T/);
  expect(Object.keys(await files())).not.toContain('cajon/cards/tarjeta-1.md');

  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Cajón').click();
  await openMore(page);
  await button('Abrir el Archivo (1)').click();
  await button('Restaurar Idea aparcada del Archivo').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta restaurada del Archivo. Guardado en la carpeta.');
  await expect.poll(async () => Object.keys(await files())).not.toContain('cajon/.nouty/archive.yaml');
  expect(Object.keys(await files())).toContain('cajon/cards/tarjeta-1.md');
});

test('carpeta: la entrada del diario y la fecha de creación se guardan en el Markdown y el Diario las recupera al recargar (ADR 0024)', async ({ page }) => {
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>);
  const text = async (path: string) => new TextDecoder().decode(new Uint8Array((await files())[path] ?? []));
  const openDiary = async () => {
    await openMore(page);
    await page.getByRole('button', { name: 'Abrir el diario', exact: true }).click();
    await expect(page.getByTestId('diary-view')).toBeVisible();
  };
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Bitácora');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): la fecha de
  // creación ya queda guardada por el propio alta, sin necesidad de abrir ni cerrar su editor.
  await insertFromMenu(page, 'Insertar nota');
  await expect.poll(() => text('bitacora/cards/tarjeta-1.md')).toMatch(/createdAt: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z/);

  await openDiary();
  await page.getByRole('button', { name: 'Escribir la nota de hoy' }).click();
  await page.getByLabel('Texto de la entrada').fill('Guardado en disco.');
  await page.getByRole('button', { name: 'Guardar entrada' }).click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Entrada del diario guardada. Guardado en la carpeta.');
  const entry = await text('bitacora/cards/tarjeta-2.md');
  expect(entry).toContain('typeId: diario');
  expect(entry).toMatch(/fields:\s*\n\s*fecha: "?\d{4}-\d{2}-\d{2}/);
  expect(entry).toContain('schemaVersion: 3');
  expect(entry).toContain('Guardado en disco.');

  await page.reload();
  await page.getByRole('button', { name: 'Volver a mis espacios' }).click();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByRole('button', { name: 'Abrir Bitácora' }).click();
  await openDiary();
  await expect(page.getByTestId('log-summary')).toHaveText('1 ENTRADA · 1 TARJETA CREADA · 0 ARCHIVADAS');
  await expect(page.getByTestId('log-entry-tarjeta-2')).toContainText('Guardado en disco.');
});

test('carpeta: mover un conjunto seleccionado es una sola escritura y se conserva al recargar (ADR 0025)', async ({ page }) => {
  const geometry = page.getByTestId('card-geometry');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  // «Columna 1, fila 1 · 4 × 3» → fila + 1.
  const lower = (text: string) => text.replace(/fila (\d+)/, (_all, row: string) => `fila ${Number(row) + 1}`);
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  const where = async (id: number) => {
    await page.getByTestId(`card-tarjeta-${id}`).focus();
    await page.keyboard.press('Enter');
    await openFullCardEditor(page, page.getByTestId(`card-tarjeta-${id}`));
    const text = await geometry.innerText();
    await button('Cerrar el editor de la tarjeta').click();
    return text;
  };
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Grupo');
  await button('Crear un espacio').click();
  await insertFromMenu(page, 'Insertar nota');
  await insertFromMenu(page, 'Insertar nota');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  await button('Seleccionar varias tarjetas empezando por esta').click();
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('multi-count')).toHaveText('2 SELECCIONADAS');
  await button('Cancelar la selección').click();
  const before = [await where(1), await where(2)];

  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Enter');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await button('Seleccionar varias tarjetas empezando por esta').click();
  await button('Seleccionar todas las tarjetas del tablero').click();
  // UX7-A1: la barra múltiple ya no tiene botones de flecha; las flechas del teclado mueven el conjunto.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('workspace-feedback')).toHaveText('2 tarjetas movidas. Guardado en la carpeta.');

  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Grupo').click();
  expect([await where(1), await where(2)]).toEqual(before.map(lower));
});

test('carpeta: deshacer un movimiento se guarda en la carpeta y se conserva al recargar; el historial no sobrevive a la recarga (ADR 0026)', async ({ page }) => {
  const geometry = page.getByTestId('card-geometry');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Vuelta');
  await button('Crear un espacio').click();
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  const start = await geometry.innerText();
  await button('Mover abajo').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta movida. Guardado en la carpeta.');
  await expect(geometry).not.toHaveText(start);
  await button('Deshacer: Tarjeta movida').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Deshecho: Tarjeta movida. Guardado en la carpeta.');
  // Deshacer remonta el editor (cambia su `key` con la revisión): la posición vuelve a su estado
  // cerrado por defecto en escritorio y hay que expandirla de nuevo para leer `card-geometry`.
  await expandPosition(page);
  await expect(geometry).toHaveText(start);

  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Vuelta').click();
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Enter');
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-1'));
  await expect(geometry).toHaveText(start);
  await expect(page.getByRole('button', { name: 'Deshacer', exact: true })).toHaveAttribute('aria-disabled', 'true');
});

test('carpeta: el marco se guarda en layout.yaml (v3) y reaparece al recargar; quitarlo vuelve a la versión anterior (ADR 0027)', async ({ page }) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const layoutText = () => page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem('nouty-test-folder') ?? '{}') as Record<string, number[]>;
    return new TextDecoder().decode(new Uint8Array(files['album/.nouty/layout.yaml'] ?? []));
  });
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await button('Abrir una carpeta').click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Álbum');
  await button('Crear un espacio').click();
  await insertFromMenu(page, 'Insertar nota');
  await insertFromMenu(page, 'Insertar nota');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openFullCardEditor(page, page.getByTestId('card-tarjeta-2'));
  await button('Seleccionar varias tarjetas empezando por esta').click();
  await button('Seleccionar todas las tarjetas del tablero').click();
  await button('Agrupar las 2 seleccionadas en un marco').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Marco creado con 2 tarjetas. Guardado en la carpeta.');
  await page.getByLabel('Título del marco').fill('Viaje');
  await button('Guardar el título del marco').click();
  await expect.poll(layoutText).toContain('title: Viaje');
  expect(await layoutText()).toContain('schemaVersion: 3');

  await page.reload();
  await button('Volver a mis espacios').click();
  await button('Abrir una carpeta').click();
  await button('Abrir Álbum').click();
  await expect(page.getByTestId('frame-header-marco-1')).toContainText('Viaje');
  await page.getByTestId('frame-header-marco-1').focus();
  await page.keyboard.press('Enter');
  await button('Quitar el marco Viaje').click();
  await expect.poll(layoutText).not.toContain('frames');
  expect(await layoutText()).not.toContain('schemaVersion: 3');
});
