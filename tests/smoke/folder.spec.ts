
import { expect, test } from '@playwright/test';

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
            close: async () => { const files = data(); files[path] = bytes; put(files); },
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

test('carpeta web: crear, guardar, recargar y reconectar sin perder las tarjetas', async ({ page }, testInfo) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Abrir una carpeta' })).toBeEnabled();
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await expect(page.getByTestId('memory-notice')).toContainText('CARPETA LOCAL');
  await page.getByLabel('Nombre del nuevo espacio').fill('Mi carpeta');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Mi carpeta' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  await page.getByTestId('card-tarjeta-1').click();
  await page.getByLabel('Título de la tarjeta').fill('Nota persistente');
  await expect(page.getByTestId('card-tarjeta-1')).toContainText('Nota persistente');
  await expect(page.getByTestId('workspace-feedback')).toContainText('guardado en la carpeta');
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
  await press('Añadir nota');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  // A la izquierda y por encima del origen: coordenadas negativas en ambos ejes.
  await press('Mover a la izquierda');
  await press('Mover arriba');
  await press('Mover arriba');
  await expect(geometry).toHaveText('X -1, Y -2 · 4 × 3');
  await expect.poll(layoutText).toContain('schemaVersion: 2');

  // Otra tarjeta, lejos: más allá de la columna 12 del formato antiguo y muy abajo.
  await press('Añadir nota');
  await expect(page.getByTestId('card-tarjeta-2')).toHaveAttribute('aria-pressed', 'true');
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
  await expect(geometry).toHaveText('Columna 21, fila 31 · 4 × 3');
  const far = await page.getByTestId('card-tarjeta-2').boundingBox();
  const frame = await page.getByTestId('board-canvas').boundingBox();
  expect(far && frame && far.y >= frame.y && far.y < frame.y + frame.height).toBe(true);
  await page.getByTestId('card-tarjeta-1').focus();
  await page.keyboard.press('Space');
  await expect(geometry).toHaveText('X -1, Y -2 · 4 × 3');
});

test('P2: una tarjeta a casi un millón de celdas se pinta con coordenadas pequeñas, sin perder precisión', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  const press = (name: string) => page.getByRole('button', { name, exact: true }).click();
  await press('Abrir una carpeta');
  await page.getByLabel('Nombre del nuevo espacio').fill('Lejos');
  await press('Crear un espacio');
  await press('Añadir nota');
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
  await expect(page.getByTestId('card-geometry')).toHaveText('X 999000, Y -999000 · 4 × 3');
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
  await page.getByRole('button', { name: 'Añadir título flotante' }).click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toBeVisible();
  await page.getByLabel('Título de la tarjeta').fill('Proyecto Solace');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta' }).click();
  await expect(page.getByTestId('floating-title-tarjeta-1')).toContainText('Proyecto Solace');
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-2').click();
  const editor = page.getByLabel('Contenido Markdown');
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
  await page.getByTestId('card-tarjeta-2').click();
  await expect(page.getByLabel('Contenido Markdown')).toHaveValue('- [x] Primera\n- [ ] ');
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
  await page.getByRole('button', { name: 'Añadir nota' }).click();
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
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-1').click();
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
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-1').click();
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
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Título de la tarjeta').fill('Borrador sin guardar');
  // Sin pulsar «Guardar texto»: cambiar de proyecto desde las pestañas (o la lista en móvil).
  if ((page.viewportSize()?.width ?? 0) < 800) await page.getByRole('button', { name: 'Cambiar de proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Ir al proyecto Uno', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uno', exact: true })).toBeVisible();
  const card = new TextDecoder().decode(new Uint8Array((await files())['dos/cards/tarjeta-1.md'] ?? []));
  expect(card).toContain('title: Borrador sin guardar');
});

test('recargar con texto pendiente exige confirmar la salida', async ({ page }) => {
  await page.addInitScript({ content: fakeFolder });
  await page.goto('./');
  await page.getByRole('button', { name: 'Abrir una carpeta' }).click();
  await page.getByLabel('Nombre del nuevo espacio').fill('Recarga');
  await page.getByRole('button', { name: 'Crear un espacio' }).click();
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-1').click();
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
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.getByTestId('card-tarjeta-1').click();
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
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByTestId(`card-tarjeta-${id}`)).toBeVisible();
  }
  // Desde P2 la segunda nace debajo, dentro de lo visible. Para probar la colisión horizontal se
  // coloca a su derecha con los botones del inspector y se restablece la vista.
  const press = (name: string) => page.getByRole('button', { name, exact: true }).click();
  for (let step = 0; step < 4; step += 1) await press('Mover a la derecha');
  for (let step = 0; step < 3; step += 1) await press('Mover arriba');
  await expect(page.getByTestId('card-geometry')).toHaveText('Columna 5, fila 1 · 4 × 3');
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) < 800) {
    await press('Abrir la configuración');
    await press('Restablecer la vista del lienzo');
    await press('Cerrar configuración');
  } else {
    await page.getByTestId('zoom-level').click();
  }
  const cell = (page.viewportSize()?.width ?? 0) >= 800 ? { x: 96, y: 64 } : { x: 56, y: 56 };
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
  await button('Importar una imagen').click();
  await (await chooser).setFiles(icon);
  await expect(page.getByTestId('image-preview-tarjeta-1')).toBeVisible();
  expect((await files())['galeria/assets/images/tarjeta-1.png']).toEqual([...icon.buffer]);
  for (const [index, title] of ['Mínima', 'Borrador'].entries()) {
    const cardId = `card-tarjeta-${index + 2}`;
    await button('Añadir nota').click();
    // Esperar a que el inspector muestre la tarjeta nueva antes de escribir.
    await expect(page.getByTestId(cardId)).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Título de la tarjeta').fill(title);
    await button('Guardar texto').click();
    await expect(page.getByTestId(cardId)).toContainText(title);
  }
  await button('Enviar la tarjeta Borrador a la Papelera').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta enviada a la Papelera. Guardado en la carpeta.');
  await page.getByTestId('card-tarjeta-2').click();
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
  await button('Enviar app-icon a la Papelera').click();
  expect(Object.keys(await files())).toContain('galeria/assets/images/tarjeta-1.png');
  await button('Abrir la Papelera (2)').click();
  await button('Eliminar definitivamente app-icon').click();
  await button('Confirmar eliminar definitivamente app-icon').click();
  await expect(page.getByTestId('workspace-feedback')).toHaveText('Tarjeta eliminada definitivamente. Guardado en la carpeta.');
  expect(Object.keys(await files())).not.toContain('galeria/assets/images/tarjeta-1.png');
});
