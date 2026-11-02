import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { block8Document, block8PdfBytes, pdfRef } from '../fixtures/block8-content';

function value<T>(r: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; }
async function lab(page: Page) {
  const base = canvasCardsWorkspace();
  const workspace = { ...base, metadata: { name: 'Herramientas B9' }, cards: base.cards.map((card, i) => i === 0 ? { ...card, contentDocument: block8Document } : card) };
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(workspace)), { [pdfRef]: block8PdfBytes(), 'assets/notes/Guia.md': new TextEncoder().encode('# Guía B9\n<script>window.__unsafe = true</script>') }));
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'tools.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.getByRole('heading', { name: 'Herramientas B9', exact: true })).toBeVisible();
}
async function nav(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: /Más secciones|More sections/, exact: true }).click();
  await button.click();
}
async function openHelp(page: Page, locale: 'es' | 'en' = 'es') {
  await nav(page, locale === 'es' ? 'Abrir la configuración' : 'Open settings');
  await page.getByTestId('settings-panel').getByRole('button', { name: locale === 'es' ? 'Abrir ayuda de atajos' : 'Open keyboard shortcuts help' }).click();
}

test('B9: presentación salto, progreso, teclado editable y visor PDF superpuesto', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Presentar este tablero');
  const present = page.getByTestId('present-view');
  await expect(present).toBeVisible();
  const jump = page.getByRole('spinbutton', { name: 'Ir al elemento', exact: true });
  await expect(jump).toBeVisible();
  await expect(page.getByTestId('present-count')).toHaveText('1 / 7');
  await jump.fill('2'); await jump.press('Enter');
  await expect(page.getByTestId('present-count')).toHaveText('2 / 7');
  await jump.press('ArrowLeft');
  await expect(page.getByTestId('present-count')).toHaveText('2 / 7');
  await jump.fill('1'); await jump.press('Enter');
  await present.getByRole('button', { name: /PDF.*Manual.*Abrir/ }).click();
  await expect(page.getByTestId('asset-pdf-preview-frame')).toBeVisible();
  await expect(present).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('present-count')).toHaveText('1 / 7');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('asset-pdf-preview-frame')).not.toBeVisible();
  await expect(present).toBeVisible();
  // B9-R3-02: el orden por defecto ya es el orden principal del tablero (board.cardIds), no la
  // geometría del lienzo — «Nota con imagen» pasa de la posición 4 a la 2 en este laboratorio.
  await jump.fill('2'); await jump.press('Enter');
  await expect(present.getByText('Leyenda conservada')).toBeVisible();
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-present.png` });
  await present.getByRole('button', { name: 'Cerrar la presentación', exact: true }).click();
  await expect(present).not.toBeVisible();
});

test('B9: ayuda contextual accesible, sin comandos de fondo, restaura foco y explica explorador', async ({ page }, info) => {
  await lab(page);
  await openHelp(page);
  const help = page.getByTestId('shortcut-help');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Ctrl');
  await expect(help).toContainText('explorador');
  // B9-R3-08/B9-R4-07: el atajo real de zoom (verificado contra `event.ctrlKey || event.metaKey` en
  // Canvas.tsx, que también acepta la tecla Windows real en Windows) se explica sin ambigüedad —
  // «rueda del ratón», no solo «rueda», y sin omitir la tecla Windows junto a Ctrl/⌘.
  await expect(help).toContainText('Ctrl/⌘/Win + rueda del ratón');
  await expect.poll(() => help.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('present-view')).not.toBeVisible();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  await expect.poll(() => help.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-help.png` });
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/configuración|secciones/);
});

test('B9-R2-07: la ayuda también se abre junto a Buscar, sin duplicar su contenido ni reordenar la barra', async ({ page }) => {
  await lab(page);
  const search = page.getByTestId('open-search');
  const help = page.getByTestId('open-help');
  // Mismo grupo «Trabajar», uno junto al otro: no se reordenó el resto de la barra para encajarlo.
  await expect(search).toBeVisible();
  await expect(help).toBeVisible();
  await nav(page, 'Abrir ayuda de atajos');
  const dialog = page.getByTestId('shortcut-help');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Ctrl');
  // Sigue siendo el mismo diálogo compartido con Configuración, no un segundo contenido de ayuda.
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  // Mismo criterio de restauración de foco ya aceptado para la ruta de Configuración (más arriba):
  // un control real de la barra, no el documento o `<body>`.
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/ayuda|configuración|secciones|búsqueda/i);
});

test('B9-R2-08: la grilla fina es la única apariencia; el imán ya no tiene un interruptor de densidad aparte', async ({ page }) => {
  await lab(page);
  await nav(page, 'Abrir la configuración');
  const settings = page.getByTestId('settings-panel');
  await expect(settings).toBeVisible();
  // El interruptor «Cuadrícula fina» (Ronda 1) desaparece: ya no hay una densidad que elegir aparte.
  await expect(page.getByRole('switch', { name: /Cuadrícula fina|Fine grid/ })).toHaveCount(0);
  const columnLines = () => page.getByTestId('canvas-grid').locator('> div').count();
  const before = await columnLines();
  expect(before).toBeGreaterThan(0);
  // Ajustar a celdas solo decide la precisión del imán; no debe alterar cuántas líneas se ven.
  await page.getByRole('switch', { name: 'Ajustar a celdas' }).click();
  await expect(page.getByRole('switch', { name: 'Ajustar a celdas' })).toHaveAttribute('aria-checked', 'false');
  expect(await columnLines()).toBe(before);
  await page.getByRole('switch', { name: 'Ajustar a celdas' }).click();
  // Mostrar/ocultar grilla sigue siendo el único control de visibilidad.
  await page.getByRole('switch', { name: 'Mostrar grilla' }).click();
  await expect(page.getByTestId('canvas-grid')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Mostrar grilla' }).click();
  await expect(page.getByTestId('canvas-grid')).toHaveCount(1);
});

test('B9: impresión configura papel y orientación con contenido completo', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Imprimir este tablero');
  const options = page.getByTestId('print-options');
  await expect(options).toBeVisible();
  await options.getByTestId('print-paper-letter').click();
  await options.getByTestId('print-landscape').click();
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-print.png` });
  const popupPromise = page.waitForEvent('popup');
  await options.getByTestId('print-continue').click();
  const popup = await popupPromise;
  await expect.poll(() => popup.locator('html').getAttribute('lang')).toBe('es');
  const html = await popup.content();
  expect(html).toMatch(/size:\s*Letter landscape/);
  expect(html).toContain('Leyenda conservada');
  expect(html).toContain('Manual');
  expect(html).not.toContain('nouty-caption:v1');
  await popup.close();
});

test('B9: idioma actualiza pestañas, ayuda y salida sin traducir datos', async ({ page }) => {
  await lab(page);
  await nav(page, 'Abrir la configuración');
  const settings = page.getByTestId('settings-panel');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Usar inglés' }).click();
  await settings.getByRole('button', { name: /Close settings/i }).click();
  await expect(page.getByRole('button', { name: /Board options|Open a board/ }).first()).toBeVisible();
  await openHelp(page, 'en');
  const help = page.getByTestId('shortcut-help');
  await expect(help).toContainText('Open in file explorer');
  // B9-R3-08: antes de este correctivo, esta fila decía «rueda» en español incluso con la interfaz en
  // inglés (único texto de combinación con una palabra, no solo símbolos, sin pasar por `t()`).
  // B9-R4-07: la tecla Windows real también activa el zoom (mismo `metaKey` que ⌘ en Mac) y ya se
  // explica, en vez de dar la impresión de que solo Ctrl funciona en Windows.
  await expect(help).toContainText('Ctrl/⌘/Win + mouse wheel');
  await expect(help).not.toContainText('rueda');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Herramientas B9', exact: true })).toBeVisible();
  await nav(page, 'Print this board');
  await expect(page.getByTestId('print-options')).toContainText('Print options');
  await page.keyboard.press('Escape');
});

test('B9: pantalla completa usa API real y conserva presentación al salir', async ({ page }) => {
  await lab(page);
  await nav(page, 'Presentar este tablero');
  const present = page.getByTestId('present-view');
  await present.getByTestId('present-fullscreen').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(present).toBeVisible();
  await present.getByRole('button', { name: 'Cerrar la presentación' }).click();
  await expect(present).not.toBeVisible();
});

test('B9: ayuda en oscuro conserva lectura y foco al cambiar ancho', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Abrir la configuración');
  const settings = page.getByTestId('settings-panel');
  await settings.getByRole('button', { name: 'Usar el tema oscuro' }).click();
  await settings.getByRole('button', { name: /Cerrar configuración/i }).click();
  await openHelp(page);
  const help = page.getByTestId('shortcut-help');
  for (const width of [390, 800, 1100, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(help).toBeVisible();
    const dimensions = await help.evaluate((element) => ({ width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right, viewport: innerWidth }));
    expect(dimensions.width).toBeGreaterThan(200);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-dark-help.png` });
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
});

test('B9-OBS: impresión visual respeta el orden elegido sin mover el tablero', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Imprimir este tablero');
  const options = page.getByTestId('print-options');
  // El orden vive en un diálogo propio (B9-R2-01), no en una franja dentro de Imprimir.
  await options.getByTestId('print-organize').click();
  const rows = page.getByTestId('print-reading-order').locator('[draggable="true"]');
  const first = await rows.nth(0).innerText();
  const second = await rows.nth(1).innerText();
  // B9-R3-01: cada fila identifica la Nota con algo más que su título — un extracto real de su
  // contenido, no solo «001. ...» — para distinguir entradas con nombres parecidos.
  expect(first.split('\n').length).toBeGreaterThan(1);
  await rows.nth(1).getByRole('button', { name: /^Subir/ }).click();
  expect(await rows.nth(0).innerText()).toContain(second.split('\n')[0]!.replace(/^2\. /, '1. '));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('print-reading-order-dialog')).not.toBeVisible();
  await expect(options).toBeVisible();
  await options.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-visual-order.png` });
  const popupPromise = page.waitForEvent('popup');
  await options.getByTestId('print-continue').click();
  const popup = await popupPromise;
  const html = await popup.content();
  expect(html).toContain('<article class="entry visual-note');
  expect(html).toContain('<div class="visual-note-header">');
  expect(html).toContain('Leyenda conservada');
  expect(first).not.toBe(second);
  await popup.screenshot({ path: `artifacts/block9-${info.project.name}-visual-print-output.png`, fullPage: true });
  await popup.close();
});

test('B9-OBS: presentación conserva progreso principal al visitar y regresar de una conexión', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Presentar este tablero');
  const present = page.getByTestId('present-view');
  await expect(present.getByTestId('present-count')).toHaveText('1 / 7');
  // B9-R3-03: el panel de conexiones ya no está siempre abierto — se abre a demanda, con la cantidad
  // disponible visible en el propio botón, y se monta como portal propio (fuera de `present-view`).
  await expect(present.getByTestId('present-connections-open')).toHaveText(/Conexiones · 1/);
  await present.getByTestId('present-connections-open').click();
  // B9-R4-08 (alternativa A): el destino ya puede mostrar miniatura si su imagen de referencia está
  // disponible; en este laboratorio (como en el orden de lectura) esa imagen está deliberadamente
  // ausente, así que la fila sigue identificando el destino solo por título/extracto, sin intentar
  // cargar ni mostrar una imagen rota.
  await expect(page.getByTestId('present-connections').locator('img')).toHaveCount(0);
  await page.getByTestId('present-connections').getByRole('button', { name: /Visitar Nota con imagen/ }).click();
  await expect(present.getByTestId('present-count')).toHaveText('1 / 7 ↪');
  await expect(present.getByTestId('present-body')).toContainText('Antes de la imagen');
  await present.getByTestId('present-return-branch').click();
  await expect(present.getByTestId('present-count')).toHaveText('1 / 7');
  // Una Nota sin conexiones no muestra el acceso ni ningún panel vacío ocupando sitio.
  await present.getByRole('spinbutton', { name: 'Ir al elemento', exact: true }).fill('3');
  await present.getByRole('spinbutton', { name: 'Ir al elemento', exact: true }).press('Enter');
  await expect(present.getByTestId('present-connections-open')).toHaveCount(0);
  await present.getByRole('spinbutton', { name: 'Ir al elemento', exact: true }).fill('1');
  await present.getByRole('spinbutton', { name: 'Ir al elemento', exact: true }).press('Enter');
  await present.getByTestId('present-organize').click();
  // El diálogo de orden se monta como portal propio (RN Web `Modal`), fuera del árbol de `present-view`.
  const orderList = page.getByTestId('present-order-list');
  await expect(orderList).toBeVisible();
  // B9-R3-01: extracto visible en la fila de "Nota con imagen"...
  await expect(orderList).toContainText('Antes de la imagen');
  // ...pero su imagen de referencia (Mapa) está deliberadamente ausente en este laboratorio — ninguna
  // fila intenta cargarla igualmente, confirmando "sin miniatura" en vez de una imagen rota.
  await expect(orderList.locator('img')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-present-order.png` });
});

test('B9-R3-02: Lista escribe el orden principal del tablero, reutilizado por defecto en Presentar; el zoom bajo conserva el lienzo', async ({ page }, info) => {
  await lab(page);
  await page.getByRole('button', { name: 'Vista de lista' }).click();
  const list = page.getByTestId('board-list');
  await expect(list).toBeVisible();
  await page.getByTestId('list-organize').click();
  const rows = page.getByTestId('list-reading-order').locator('[draggable="true"]');
  // B9-R3-01: identificar una fila por algo más que su título genérico.
  expect((await rows.nth(0).innerText()).split('\n').length).toBeGreaterThan(1);
  const secondTitle = await rows.nth(1).getByRole('button').first().getAttribute('aria-label');
  await rows.nth(1).getByRole('button', { name: /^Subir/ }).click();
  await expect(rows.nth(0).getByRole('button').first()).toHaveAttribute('aria-label', `1. ${secondTitle!.replace(/^\d+\.\s*/, '')}`);
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-list-order.png` });
  // Cerrar confirma el nuevo orden principal (una sola escritura durable), no uno efímero por herramienta.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('list-reading-order-dialog')).not.toBeVisible();
  // Reabrir el propio diálogo confirma que sobrevivió al cierre, no solo a la sesión de arrastre.
  await page.getByTestId('list-organize').click();
  await expect(rows.nth(0).getByRole('button').first()).toHaveAttribute('aria-label', `1. ${secondTitle!.replace(/^\d+\.\s*/, '')}`);
  await page.keyboard.press('Escape');
  // Presentar hereda ese mismo orden por defecto, sin tener que reordenar también ahí.
  await nav(page, 'Presentar este tablero');
  const present = page.getByTestId('present-view');
  await expect(present.getByTestId('present-count')).toHaveText('1 / 7');
  await expect(present).toContainText(secondTitle!.replace(/^\d+\.\s*/, ''));
  await present.getByRole('button', { name: 'Cerrar la presentación', exact: true }).click();
  await page.getByRole('button', { name: 'Vista de lista' }).click();
  const zoomOut = page.getByRole('button', { name: info.project.name === 'mobile' ? 'Alejar la vista' : 'Alejar', exact: true });
  for (let i = 0; i < 10 && await zoomOut.isEnabled(); i++) await zoomOut.click();
  await expect(page.getByRole('button', { name: /Zoom 5 %/ }).first()).toBeVisible();
  await expect(page.getByText('Vista general: acerca al 50 % para editar')).toBeVisible();
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-overview.png` });
});

test('B9-OBS: Assets muestra texto literal sin ejecutar HTML ni alterar el archivo', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Abrir los assets');
  const asset = page.getByTestId('asset-Guia.md');
  await expect(asset).toBeVisible();
  await asset.getByRole('button', { name: 'Ver Guia.md' }).click();
  await page.getByRole('button', { name: 'Vista previa de Guia.md' }).click();
  const preview = page.getByTestId('asset-text-preview');
  // B9-R2-12: .md ahora se formatea (el '#' deja de verse literal; el encabezado se lee normal)...
  await expect(preview.getByTestId('asset-text-preview-markdown')).toBeVisible();
  await expect(preview).toContainText('Guía B9');
  await expect(preview).not.toContainText('# Guía B9');
  // ...pero una construcción que ese analizador no modela (HTML/script incrustado) sigue degradando a
  // texto literal seguro, nunca ejecutado — ni con el nuevo formato ni con el anterior.
  await expect(preview).toContainText('<script>window.__unsafe = true</script>');
  expect(await page.evaluate(() => (window as unknown as { __unsafe?: boolean }).__unsafe)).not.toBe(true);
  await page.screenshot({ path: `artifacts/block9-${info.project.name}-text-preview.png` });
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
});

test('B9-R2-09/10: Assets ordena por nombre o tipo sin inventar fechas, con la barra agrupada en Importar/Explorar/Filtrar', async ({ page }, info) => {
  await lab(page);
  await nav(page, 'Abrir los assets');
  const assetsView = page.getByTestId('assets-view');
  await expect(assetsView).toBeVisible();
  // Tres grupos reales, no una sola fila (B9-R2-10); nada se elimina ni se duplica.
  await expect(page.getByTestId('assets-toolbar-import')).toBeVisible();
  await expect(page.getByTestId('assets-toolbar-explore')).toBeVisible();
  await expect(page.getByTestId('assets-toolbar-filter')).toBeVisible();
  await expect(page.getByTestId('assets-toolbar-explore').getByTestId('assets-search')).toBeVisible();
  // B9-R2-09: no hay un criterio «Fecha de importación» — no existe un campo de fecha real y fiable.
  await expect(page.getByRole('button', { name: /fecha|date/i })).toHaveCount(0);
  const names = () => page.getByTestId('assets-list').locator('> div').allTextContents();
  const byName = await names();
  // B9-R3-04: un único selector compacto en vez de dos botones Nombre/Tipo lado a lado.
  await expect(page.getByTestId('assets-sort-criterion')).toHaveText(/Nombre/);
  // B9-R4-05: en escritorio, Buscar y Ordenar comparten la misma fila (no quedan uno sobre otro con un
  // hueco horizontal vacío al lado del campo de búsqueda); en móvil, siguen apilados por necesidad real.
  if (info.project.name !== 'mobile') {
    const searchBox = await page.getByTestId('assets-search').boundingBox();
    const sortBox = await page.getByTestId('assets-sort-criterion').boundingBox();
    expect(searchBox && sortBox && Math.abs(searchBox.y - sortBox.y) < searchBox.height).toBe(true);
  }
  await page.getByTestId('assets-sort-criterion').click();
  await expect(page.getByTestId('assets-sort-criterion')).toHaveText(/Tipo/);
  const byType = await names();
  // Cambiar de criterio reordena visiblemente la lista (ambos son de tipo «Documento», pero el nombre ya no manda).
  await page.getByTestId('assets-sort-direction').click();
  const byTypeReversed = await names();
  expect(byTypeReversed).toEqual([...byType].reverse());
  expect(byName.length).toBeGreaterThan(0);
});

test('B9-R3-05/B9-R4-06: el panel de detalles de Assets usa position sticky y agrupa tipo/peso/ruta/uso bajo «Detalles»', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'El panel apilado (móvil) no necesita quedarse fijo: ya va antes de la lista.');
  await lab(page);
  await nav(page, 'Abrir los assets');
  await page.getByTestId('asset-Guia.md').getByRole('button', { name: 'Ver Guia.md' }).click();
  const detail = page.getByTestId('asset-detail');
  await expect(detail).toBeVisible();
  const sticky = page.getByTestId('assets-detail-sticky');
  expect(await sticky.evaluate((node) => getComputedStyle(node).position)).toBe('sticky');
  // B9-R4-06: tipo, peso, ruta y estado de uso (dato ya existente, ninguno inventado) agrupados bajo
  // una sección «Detalles» identificable; ni «Consultar uso» ni las demás acciones se mueven.
  const details = page.getByTestId('asset-details');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Detalles');
  await expect(details).toContainText('DOCUMENTO');
  await expect(details.getByTestId('asset-path')).toHaveText('assets/notes/Guia.md');
  // Guia.md todavía no la referencia ninguna tarjeta en este laboratorio recién importado.
  await expect(details).toContainText('Sin uso');
  await expect(detail.getByRole('button', { name: 'Consultar uso', exact: true })).toBeVisible();
});

test('B9-R3-06: un Asset .md importado puede añadirse al tablero como tarjeta de documento de solo lectura', async ({ page }) => {
  await lab(page);
  await nav(page, 'Abrir los assets');
  const asset = page.getByTestId('asset-Guia.md');
  await expect(asset).toBeVisible();
  await asset.getByRole('button', { name: 'Ver Guia.md' }).click();
  // Antes de B9-R3-06, este botón no existía para .md — solo para PDF.
  const addToBoard = page.getByRole('button', { name: 'Añadir Guia.md al tablero', exact: true });
  await expect(addToBoard).toBeVisible();
  await addToBoard.click();
  // Vuelve sola al tablero (mismo comportamiento ya existente para imágenes/PDF), con la tarjeta nueva seleccionada.
  await expect(page.getByTestId('assets-view')).toBeHidden();
  const card = page.getByRole('button', { name: 'Tarjeta Guia', exact: true });
  await expect(card).toBeVisible();
  // El agarre de mover vive en la cabecera de la tarjeta (ADR 0016) y, en una tarjeta de documento tan
  // pequeña, cubre el punto central donde Playwright golpearía por defecto — el doble clic se dirige
  // a la mitad inferior, fuera del agarre, como alcanzaría un uso real con el puntero.
  const box = (await card.boundingBox())!;
  // Activarla abre la misma vista previa segura de Markdown que ya usa Assets — nunca un editor ni el Inspector.
  await card.dblclick({ position: { x: box.width / 2, y: box.height - 6 } });
  const preview = page.getByTestId('card-text-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('card-text-preview-markdown')).toBeVisible();
  await expect(preview).toContainText('Guía B9');
  await expect(preview).not.toContainText('# Guía B9');
  // El script incrustado sigue siendo texto literal seguro, nunca ejecutado.
  await expect(preview).toContainText('<script>window.__unsafe = true</script>');
  expect(await page.evaluate(() => (window as unknown as { __unsafe?: boolean }).__unsafe)).not.toBe(true);
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  // Ningún card-level dispatch quedó mal enrutado: una tarjeta de documento PDF (ya existente en el
  // laboratorio, con referencia deliberadamente ausente) sigue abriendo el visor de PDF, no el nuevo.
  const pdfCard = page.getByRole('button', { name: 'Tarjeta PDF', exact: true });
  const pdfBox = (await pdfCard.boundingBox())!;
  await pdfCard.dblclick({ position: { x: pdfBox.width / 2, y: pdfBox.height - 6 } });
  await expect(page.getByTestId('asset-pdf-preview')).toBeVisible();
  await expect(page.getByTestId('card-text-preview')).not.toBeVisible();
  await page.keyboard.press('Escape');
  // El documento original sigue intacto: una sola copia en Assets, sin bytes duplicados en la tarjeta.
  await nav(page, 'Abrir los assets');
  await expect(page.getByTestId('assets-list').locator('> div')).toHaveCount(4);
});

test('B9-R2-11: Importar fuente abre primero una ayuda explicativa, no el selector de archivos', async ({ page }) => {
  await lab(page);
  await nav(page, 'Abrir los assets');
  await page.getByRole('button', { name: 'Importar una fuente TTF u OTF a la biblioteca', exact: true }).click();
  const help = page.getByTestId('assets-font-help');
  await expect(help).toBeVisible();
  await expect(help).toContainText('TTF');
  await expect(help).toContainText('WOFF2');
  await expect(help).toContainText('fonts.google.com');
  // Sigue mencionando el buscador propio en vez de duplicar su flujo de red y licencia.
  await expect(help).toContainText('Buscar en Google Fonts');
  const chooser = page.waitForEvent('filechooser');
  await help.getByTestId('assets-font-help-continue').click();
  await expect(help).not.toBeVisible();
  await chooser;
});
