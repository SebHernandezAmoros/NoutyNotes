import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { themeColors } from '../../packages/ui/src/theme';
import { activeLabel, borderColor, borderWidth, expandPosition, fillCardTitle, fontSize, hasHorizontalOverflow, insertFromMenu, openCardActions, openFullCardEditor, rgb, seedBodyHtml, trackProblems, openSettings } from './support';

// Experiencia del workspace (ADR 0013). Por debajo de 800 px: barra abajo, editor en hoja y celdas de
// 56 × 56 px; desde 800 px: barra sobre el lienzo, editor contextual y celdas cuadradas de 64 × 64 px;
// desde 1100 px, barra lateral de espacios y tableros.
const desktop = { width: 1366, height: 900 };
const phone = { width: 390, height: 844 };
const tabletLandscape = { width: 1024, height: 768 };
const tabletPortrait = { width: 768, height: 1024 };
const below = { width: 799, height: 900 };
const at = { width: 800, height: 900 };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, id: number) => page.getByTestId(`card-tarjeta-${id}`);

async function openWorkspaceSection(page: Page, name: 'Abrir el diario' | 'Abrir los assets' | 'Abrir el archivo') {
  if (isCompact(page)) await button(page, 'Más secciones').click();
  if (name === 'Abrir el archivo') await page.getByRole('button', { name: /^Abrir el Archivo/ }).click();
  else await button(page, name).click();
}

async function activateWorkspaceHome(page: Page) {
  const contextualReturn = button(page, 'Volver al tablero');
  if (await contextualReturn.isVisible()) {
    await contextualReturn.focus();
    await page.keyboard.press('Enter');
    return;
  }
  if (isCompact(page)) await button(page, 'Más secciones').click();
  const home = button(page, 'Ir a Inicio');
  await home.focus();
  await page.keyboard.press('Enter');
}

const canvasTransform = (page: Page) => page.getByTestId('canvas-content').evaluate((element) => {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return { scale: matrix.a, x: matrix.e, y: matrix.f };
});

test('UX7-D-FIX: Inicio conserva su jerarquía y es inerte cuando el lienzo ya está visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'La misma sesión desktop recorre la matriz responsive sin duplicarla en otro proyecto.');
  await page.goto('./');
  await createWorkspace(page, 'Navegación a Inicio');

  for (const width of [1366, 1100, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (width >= 1100) {
      const navigation = page.getByTestId('workspace-sidebar-nav');
      const home = navigation.getByRole('button', { name: 'Ir a Inicio', exact: true });
      const diary = navigation.getByRole('button', { name: 'Abrir el diario', exact: true });
      await expect(home).toBeVisible();
      expect((await box(home)).y).toBeLessThan((await box(diary)).y);
      await expect(button(page, 'Cambiar de proyecto')).toBeVisible();
      if (width === 1366) await page.screenshot({ path: 'artifacts/ux7-d-home-sidebar.png' });
    } else {
      await button(page, 'Más secciones').click();
      const more = page.getByTestId('more-sheet');
      const home = more.getByRole('button', { name: 'Ir a Inicio', exact: true });
      await expect(home).toBeVisible();
      await expect(more.getByRole('button', { name: 'Cambiar de proyecto', exact: true })).toBeVisible();
      if (width === 390) await page.screenshot({ path: 'artifacts/ux7-d-home-compact.png' });
      await button(page, 'Cerrar más').click();
    }
  }

  await page.setViewportSize(desktop);
  await openSettings(page);
  await button(page, 'Usar inglés').click();
  await button(page, 'Close settings').click();
  const home = page.getByTestId('workspace-sidebar-nav').getByRole('button', { name: 'Go to Home', exact: true });
  await expect(home).toContainText('Home');
  const route = page.url();
  const transform = await canvasTransform(page);
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('workspace-screen')).toBeVisible();
  await expect(page.getByTestId('canvas-background')).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\?id=/);
  expect(page.url()).toBe(route);
  expect(await canvasTransform(page)).toEqual(transform);
  await page.screenshot({ path: 'artifacts/ux7-d-fix-canvas-noop.png', fullPage: true });
});

test('UX7-D-FIX: el retorno desde Diario protege HTML inválido y confirma un borrador válido', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'La protección editorial se valida una vez sobre la entrada lateral.');
  await page.goto('./');
  await createWorkspace(page, 'Salida segura a Inicio');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  await button(page, 'Editar el código HTML del cuerpo').click();
  const source = page.getByTestId('html-source-input');
  const invalid = '<p><script>no permitido</script></p>';
  await source.fill(invalid);
  await expect(page.getByTestId('html-source-error')).toBeVisible();

  await openWorkspaceSection(page, 'Abrir el diario');
  await expect(page.getByTestId('diary-view')).toBeVisible();
  const home = button(page, 'Ir a Inicio');
  await expect(source).toHaveValue(invalid);
  await home.evaluate((element) => {
    element.click();
    element.click();
    element.click();
  });
  await expect(page.getByTestId('canvas-background')).toBeVisible();
  await expect(source).toHaveValue(invalid);

  await button(page, 'Descartar los cambios del código HTML').click();
  await page.getByLabel('Contenido visual').fill('BORRADOR CONFIRMADO ANTES DE SALIR');
  await openWorkspaceSection(page, 'Abrir el diario');
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await home.evaluate((element) => {
    element.click();
    element.click();
    element.click();
  });
  await expect(page.getByTestId('canvas-background')).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\?id=/);
  await expect(page.getByTestId('card-body-content-tarjeta-1')).toContainText('BORRADOR CONFIRMADO ANTES DE SALIR');
});

test('UX7-D-FIX: Inicio vuelve desde Diario, Assets y Archivo al mismo tablero con su cámara', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Inicio interno');
  await addCards(page, ['nota']);
  await zoomBy(page, 'in');
  const background = page.getByTestId('canvas-background');
  if (isCompact(page)) {
    await button(page, 'Herramienta Mano').click();
    await touchDrag(page, background, 48, 36, false);
    await button(page, 'Herramienta Seleccionar').click();
  } else {
    await middleDrag(page, background, 80, 60);
  }
  const route = page.url();
  const transform = await canvasTransform(page);

  await openWorkspaceSection(page, 'Abrir el diario');
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await page.screenshot({ path: `artifacts/ux7-d-fix-diary-${testInfo.project.name}.png`, fullPage: true });
  await activateWorkspaceHome(page);
  await expect(background).toBeVisible();
  await expect(card(page, 1)).toBeVisible();
  expect(page.url()).toBe(route);
  expect(await canvasTransform(page)).toEqual(transform);
  await page.screenshot({ path: `artifacts/ux7-d-fix-canvas-${testInfo.project.name}.png`, fullPage: true });

  await openWorkspaceSection(page, 'Abrir los assets');
  await expect(page.getByTestId('assets-view')).toBeVisible();
  await activateWorkspaceHome(page);
  await expect(background).toBeVisible();
  expect(page.url()).toBe(route);
  expect(await canvasTransform(page)).toEqual(transform);

  await openWorkspaceSection(page, 'Abrir el archivo');
  await expect(page.getByTestId('archive-view')).toBeVisible();
  await activateWorkspaceHome(page);
  await expect(background).toBeVisible();
  expect(page.url()).toBe(route);
  expect(await canvasTransform(page)).toEqual(transform);
});
/**
 * Activar con el teclado una tarjeta que el pan o la barra de acciones pueden dejar fuera de la vista
 * o tapada: el foco la trae con el pan y Espacio dispara el mismo onPress que un toque. Un clic en su
 * centro «pulsaría» algo que la persona no ve.
 */
async function tapCard(page: Page, id: number, edit = true) {
  if (await page.getByTestId('card-inspector').isVisible()) await closeEditor(page);
  // Al cerrar un diálogo, el foco vuelve (de forma asíncrona) al botón que lo abrió: se espera a que
  // la tarjeta tenga el foco de verdad antes de pulsar Espacio, o Espacio activaría ese botón.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(async () => {
    await card(page, id).focus();
    await expect(card(page, id)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Space');
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): esta suite
  // asume el editor abierto tras «tocar» una tarjeta, así que este ayudante pulsa «Editar» a continuación.
  // Sin efecto (a propósito) en una ficha minimizada: no tiene ese botón, solo «Expandir».
  if (edit) await openCardEditor(page, id);
}

test('UX7-BOARD-ORDER: drag and accessible controls preserve order after reopening', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'The draggable board rail belongs to the desktop layout.');
  await page.goto('./');
  await createWorkspace(page, 'Orden persistente');
  await button(page, 'Crear un tablero').click();
  await button(page, 'Crear un tablero').click();
  await button(page, 'Crear un tablero').click();

  const rail = page.getByTestId('board-tabs');
  const boardOrder = () => rail.getByRole('button', { name: /^Tablero / }).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')),
  );
  await expect.poll(boardOrder).toEqual(['Tablero Tablero 1', 'Tablero Tablero 2', 'Tablero Tablero 3']);

  await expect(button(page, 'Opciones de tableros')).toBeVisible();
  await button(page, 'Opciones de tableros').click();
  const organizer = page.getByTestId('board-organizer-dialog');
  await expect(organizer).toBeVisible();
  await expect(organizer.getByRole('button', { name: 'Mover después', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('board-organizer-order.png') });
  await organizer.getByLabel('Arrastrar tablero Tablero 3').dragTo(organizer.getByLabel('Arrastrar tablero Tablero 1'));
  await expect.poll(boardOrder).toEqual(['Tablero Tablero 3', 'Tablero Tablero 1', 'Tablero Tablero 2']);
  await expect(organizer.getByText('Orden guardado automáticamente.')).toBeVisible();
  await organizer.getByRole('button', { name: 'Seleccionar tablero Tablero 1', exact: true }).click();
  await expect(organizer.getByRole('button', { name: 'Mover antes', exact: true })).toBeEnabled();
  await expect(organizer.getByRole('button', { name: 'Mover después', exact: true })).toBeEnabled();
  await organizer.getByRole('button', { name: /^Cerrar organizar tableros/ }).click();

  const dragHandle = (name: string) => rail.getByRole('button', { name, exact: true }).locator('xpath=..');
  const selectedBeforeDrag = await rail.locator('[role="button"][aria-pressed="true"]').getAttribute('aria-label');
  await expect(dragHandle('Tablero Tablero 2')).toHaveAttribute('draggable', 'true');
  await dragHandle('Tablero Tablero 2').dragTo(dragHandle('Tablero Tablero 3'));
  await expect.poll(boardOrder).toEqual(['Tablero Tablero 2', 'Tablero Tablero 3', 'Tablero Tablero 1']);
  await expect(rail.locator('[role="button"][aria-pressed="true"]')).toHaveAttribute('aria-label', selectedBeforeDrag ?? '');
  await expect(button(page, 'Deshacer: Orden de tableros guardado')).toBeVisible();

  await button(page, 'Opciones de tableros').click();
  await organizer.getByRole('button', { name: 'Seleccionar tablero Tablero 1', exact: true }).click();
  await organizer.getByRole('button', { name: 'Mover antes', exact: true }).click();
  await expect.poll(boardOrder).toEqual(['Tablero Tablero 2', 'Tablero Tablero 1', 'Tablero Tablero 3']);
  await expect(organizer.getByText('Orden guardado automáticamente.')).toBeVisible();
  await organizer.getByRole('button', { name: /^Cerrar organizar tableros/ }).click();

  await button(page, 'Cambiar de proyecto').click();
  await button(page, 'Crear un nuevo proyecto desde Inicio').click();
  await createWorkspace(page, 'Proyecto puente');
  await button(page, 'Cambiar de proyecto').click();
  await button(page, 'Ir al proyecto Orden persistente').click();
  await expect.poll(boardOrder).toEqual(['Tablero Tablero 2', 'Tablero Tablero 1', 'Tablero Tablero 3']);
  await page.screenshot({ path: testInfo.outputPath('board-order-persisted.png') });
});

test('UX7-QA02: el organizador conserva el borrador al reordenar y lo reinicia al cambiar o reabrir', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Estado del organizador');
  for (let index = 0; index < 3; index += 1) {
    if (isCompact(page)) await button(page, 'Abrir un tablero').click();
    await button(page, 'Crear un tablero').click();
  }

  const openOrganizer = async () => {
    await button(page, isCompact(page) ? 'Organizar tableros' : 'Opciones de tableros').click();
    return page.getByTestId('board-organizer-dialog');
  };
  let organizer = await openOrganizer();
  const title = organizer.getByLabel('Nombre del tablero seleccionado');
  await expect(title).toHaveValue('Tablero 3');

  await organizer.getByRole('button', { name: 'Seleccionar tablero Tablero 2', exact: true }).click();
  await expect(title).toHaveValue('Tablero 2');
  await title.fill('Borrador sin guardar');
  await organizer.getByRole('button', { name: 'Mover antes', exact: true }).click();
  await expect(title).toHaveValue('Borrador sin guardar');

  await organizer.getByRole('button', { name: 'Seleccionar tablero Tablero 1', exact: true }).click();
  await expect(title).toHaveValue('Tablero 1');
  await title.fill('Otro borrador sin guardar');
  await organizer.getByRole('button', { name: /^Cerrar organizar tableros/ }).click();

  organizer = await openOrganizer();
  const reopenedTitle = organizer.getByLabel('Nombre del tablero seleccionado');
  await expect(reopenedTitle).toHaveValue('Tablero 3');
  await organizer.getByRole('button', { name: 'Seleccionar tablero Tablero 2', exact: true }).click();
  await expect(reopenedTitle).toHaveValue('Tablero 2');
  await reopenedTitle.fill('Escenas');
  await organizer.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(organizer.getByText('Nombre guardado.', { exact: true })).toBeVisible();
  await expect(organizer.getByRole('button', { name: 'Seleccionar tablero Escenas', exact: true })).toHaveCount(1);
  await expect(reopenedTitle).toHaveValue('Escenas');
});

test('UX7-SCROLL-C: las barras laterales comparten canal y estilo temático sin perder navegación', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'Las dos barras laterales solo coinciden en el layout de escritorio.');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('./');
  await button(page, 'Tema claro').click();
  await createWorkspace(page, 'Scrollbars coherentes');
  for (let index = 0; index < 12; index += 1) await button(page, 'Crear un tablero').click();

  const left = page.getByTestId('workspace-sidebar-nav');
  const right = page.getByTestId('board-tabs');
  await Promise.all([left.evaluate((element) => { element.scrollTop = 0; }), right.evaluate((element) => { element.scrollTop = 0; })]);
  const environment = await page.evaluate(async () => {
    const scrollbarRules = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).filter((text) => text.includes('scrollbar'));
      } catch {
        return ['<stylesheet no accesible>'];
      }
    });
    return {
      url: location.href,
      devicePixelRatio: window.devicePixelRatio,
      visualViewportScale: window.visualViewport?.scale ?? null,
      serviceWorkerController: navigator.serviceWorker?.controller?.scriptURL ?? null,
      cacheKeys: typeof caches === 'undefined' ? [] : await caches.keys(),
      scrollbarRules,
    };
  });
  await testInfo.attach('scrollbars-before-environment.json', { body: JSON.stringify(environment, null, 2), contentType: 'application/json' });
  console.log(`UX7-SCROLL-C environment ${JSON.stringify(environment)}`);
  const measure = (testId: 'workspace-sidebar-nav' | 'board-tabs') => page.getByTestId(testId).evaluate((element, id) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    const webkitBar = getComputedStyle(element, '::-webkit-scrollbar');
    const webkitTrack = getComputedStyle(element, '::-webkit-scrollbar-track');
    const webkitThumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
    const borderX = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
    return {
      node: `${element.tagName.toLowerCase()}[data-testid="${id}"]`,
      className: element.className,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      offsetWidth: (element as HTMLElement).offsetWidth,
      clientWidth: element.clientWidth,
      verticalChannel: (element as HTMLElement).offsetWidth - element.clientWidth - borderX,
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
      scrollbarGutter: style.scrollbarGutter,
      colorScheme: style.colorScheme,
      backgroundColor: style.backgroundColor,
      paddingRight: style.paddingRight,
      borderLeft: `${style.borderLeftWidth} ${style.borderLeftStyle} ${style.borderLeftColor}`,
      borderRight: `${style.borderRightWidth} ${style.borderRightStyle} ${style.borderRightColor}`,
      thumbVariable: root.getPropertyValue('--nouty-scroll-thumb').trim(),
      trackVariable: root.getPropertyValue('--nouty-scroll-track').trim(),
      webkitScrollbarWidth: webkitBar.width,
      webkitTrackBackground: webkitTrack.backgroundColor,
      webkitThumbBackground: webkitThumb.backgroundColor,
      webkitThumbBorder: webkitThumb.border,
      scrollTop: element.scrollTop,
    };
  }, testId);

  await expect.poll(async () => (await measure('workspace-sidebar-nav')).scrollHeight).toBeGreaterThan((await measure('workspace-sidebar-nav')).clientHeight);
  await expect.poll(async () => (await measure('board-tabs')).scrollHeight).toBeGreaterThan((await measure('board-tabs')).clientHeight);
  const light = { left: await measure('workspace-sidebar-nav'), right: await measure('board-tabs') };
  await testInfo.attach('scrollbars-after-light.json', { body: JSON.stringify(light, null, 2), contentType: 'application/json' });
  console.log(`UX7-SCROLL-C after light ${JSON.stringify(light)}`);
  await page.screenshot({ path: 'artifacts/ux7-c-scrollbars-after-light.png', fullPage: true });

  await openSettings(page);
  await button(page, 'Usar el tema oscuro').click();
  await page.getByTestId('settings-panel').getByRole('button', { name: /^Cerrar / }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  const dark = { left: await measure('workspace-sidebar-nav'), right: await measure('board-tabs') };
  await testInfo.attach('scrollbars-after-dark.json', { body: JSON.stringify(dark, null, 2), contentType: 'application/json' });
  console.log(`UX7-SCROLL-C after dark ${JSON.stringify(dark)}`);
  await page.screenshot({ path: 'artifacts/ux7-c-scrollbars-after-dark.png', fullPage: true });

  await left.hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(async () => (await measure('workspace-sidebar-nav')).scrollTop).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/ux7-c-scrollbars-after-dark-left-active.png', fullPage: true });
  await right.hover();
  await page.mouse.wheel(0, 320);
  await expect.poll(async () => (await measure('board-tabs')).scrollTop).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/ux7-c-scrollbars-after-dark-right-active.png', fullPage: true });

  await left.evaluate((element) => { element.scrollTop = 0; });
  await left.getByRole('button', { name: 'Abrir el diario', exact: true }).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await measure('workspace-sidebar-nav')).scrollTop).toBeGreaterThan(0);
  await right.evaluate((element) => { element.scrollTop = 0; });
  await right.getByRole('button', { name: 'Tablero Tablero 1', exact: true }).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await measure('board-tabs')).scrollTop).toBeGreaterThan(0);

  expect(light.left.scrollbarWidth).toBe(light.right.scrollbarWidth);
  expect(light.left.scrollbarColor).toBe(light.right.scrollbarColor);
  expect(light.left.scrollbarGutter).toBe(light.right.scrollbarGutter);
});

test('UX7-SCROLL-C-SURFACES: Assets, Diario e Inspector conservan scrollbars legibles en claro y oscuro', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'La inspección UX7-C pendiente corresponde a las superficies de escritorio.');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 520 });
  await page.goto('./');
  await button(page, 'Tema claro').click();
  await createWorkspace(page, 'Superficies con scroll');
  for (let index = 0; index < 8; index += 1) await button(page, 'Crear un tablero').click();
  await addCards(page, ['nota']);

  const inspect = async (root: Locator, name: string) => {
    const selector = `[data-ux7-scroll-inspect="${name}"]`;
    const initial = await root.evaluate((container, marker) => {
      document.querySelectorAll('[data-ux7-scroll-inspect]').forEach((element) => element.removeAttribute('data-ux7-scroll-inspect'));
      const candidates = [container, ...Array.from(container.querySelectorAll('*'))];
      const scrollable = candidates.find((element) => {
        const style = getComputedStyle(element);
        return /^(auto|scroll)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
      });
      if (!(scrollable instanceof HTMLElement)) return null;
      scrollable.dataset.ux7ScrollInspect = marker;
      scrollable.scrollTop = 0;
      const style = getComputedStyle(scrollable);
      const webkitBar = getComputedStyle(scrollable, '::-webkit-scrollbar');
      const webkitTrack = getComputedStyle(scrollable, '::-webkit-scrollbar-track');
      const webkitThumb = getComputedStyle(scrollable, '::-webkit-scrollbar-thumb');
      const borderX = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
      return {
        node: scrollable.tagName.toLowerCase(),
        className: scrollable.className,
        overflowY: style.overflowY,
        overflowX: style.overflowX,
        scrollHeight: scrollable.scrollHeight,
        clientHeight: scrollable.clientHeight,
        scrollWidth: scrollable.scrollWidth,
        clientWidth: scrollable.clientWidth,
        verticalChannel: scrollable.offsetWidth - scrollable.clientWidth - borderX,
        scrollbarWidth: style.scrollbarWidth,
        scrollbarColor: style.scrollbarColor,
        scrollbarGutter: style.scrollbarGutter,
        webkitScrollbarWidth: webkitBar.width,
        webkitTrackBackground: webkitTrack.backgroundColor,
        webkitThumbBackground: webkitThumb.backgroundColor,
        webkitThumbBorder: webkitThumb.border,
      };
    }, name);
    expect(initial, `${name} debe contener un scroller vertical real`).not.toBeNull();
    expect(initial!.scrollHeight).toBeGreaterThan(initial!.clientHeight);
    expect(initial!.scrollWidth).toBeLessThanOrEqual(initial!.clientWidth + 1);
    const scroller = page.locator(selector);
    await scroller.hover();
    await page.mouse.wheel(0, 240);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    return { ...initial!, scrollTop: await scroller.evaluate((element) => element.scrollTop) };
  };

  const inspectAssets = async (theme: 'light' | 'dark') => {
    await button(page, 'Abrir los assets').click();
    await expect(page.getByTestId('assets-view')).toBeVisible();
    await button(page, 'Buscar una fuente en Google Fonts').click();
    await expect(page.getByTestId('assets-google-search')).toBeVisible();
    const result = await inspect(page.getByTestId('assets-view'), `assets-${theme}`);
    await page.screenshot({ path: `artifacts/ux7-c-assets-${theme}.png`, fullPage: true });
    await button(page, 'Volver al tablero').click();
    return result;
  };
  const inspectDiary = async (theme: 'light' | 'dark') => {
    await button(page, 'Abrir el diario').click();
    await expect(page.getByTestId('diary-view')).toBeVisible();
    await button(page, 'Buscar por fecha, tipo, etiqueta o tablero (ADR 0037)').click();
    const result = await inspect(page.getByTestId('diary-view'), `diary-${theme}`);
    await page.screenshot({ path: `artifacts/ux7-c-diary-${theme}.png`, fullPage: true });
    await button(page, 'Volver al tablero').click();
    return result;
  };
  const inspectInspector = async (theme: 'light' | 'dark') => {
    await openFullCardEditor(page, card(page, 1));
    const result = await inspect(page.getByTestId('inspector-panel'), `inspector-${theme}`);
    await page.screenshot({ path: `artifacts/ux7-c-inspector-${theme}.png`, fullPage: true });
    await closeEditor(page);
    return result;
  };

  const light = {
    assets: await inspectAssets('light'),
    diary: await inspectDiary('light'),
    inspector: await inspectInspector('light'),
  };
  await openSettings(page);
  await button(page, 'Usar el tema oscuro').click();
  await page.getByTestId('settings-panel').getByRole('button', { name: /^Cerrar / }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  const dark = {
    assets: await inspectAssets('dark'),
    diary: await inspectDiary('dark'),
    inspector: await inspectInspector('dark'),
  };

  await testInfo.attach('scrollbars-surfaces.json', { body: JSON.stringify({ light, dark }, null, 2), contentType: 'application/json' });
  console.log(`UX7-SCROLL-C surfaces ${JSON.stringify({ light, dark })}`);
  for (const result of [...Object.values(light), ...Object.values(dark)]) {
    expect(result.scrollbarWidth).toBe('thin');
    expect(result.webkitScrollbarWidth).toBe('10px');
    expect(result.webkitTrackBackground).toBe('rgba(0, 0, 0, 0)');
  }
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('UX7-CONTEXT-MENUS: create and paste at the clicked canvas point, then duplicate a note', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'The pointer context menu belongs to the desktop canvas.');
  await page.goto('./');
  await createWorkspace(page, 'Menús del lienzo');

  const background = page.getByTestId('canvas-background');
  const canvas = await box(background);
  const canvasTransform = () => page.getByTestId('canvas-content').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  const createPoint = { x: Math.min(360, canvas.width - 260), y: Math.min(250, canvas.height - 220) };
  const beforeCreate = await canvasTransform();
  const expectedCreate = {
    x: Math.floor((createPoint.x - beforeCreate.x) / beforeCreate.scale / cellSize(page).x),
    y: Math.floor((createPoint.y - beforeCreate.y) / beforeCreate.scale / cellSize(page).y),
  };
  await background.click({ button: 'right', position: createPoint, force: true });
  const canvasMenu = page.getByTestId('canvas-context-menu');
  await expect(canvasMenu).toBeVisible();
  await expect(canvasMenu.getByRole('button', { name: 'Crear una Nota en esta posición' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('canvas-create-menu.png') });
  await canvasMenu.getByRole('button', { name: 'Crear una Nota en esta posición' }).click();
  await expect(card(page, 1)).toBeVisible();
  const afterCreate = await canvasTransform();
  const created = await box(card(page, 1));
  expect(Math.round((created.x - canvas.x - afterCreate.x) / afterCreate.scale / cellSize(page).x)).toBe(expectedCreate.x);
  expect(Math.round((created.y - canvas.y - afterCreate.y) / afterCreate.scale / cellSize(page).y)).toBe(expectedCreate.y);

  await card(page, 1).click({ button: 'right' });
  await expect(canvasMenu).toHaveCount(0);
  const cardMenu = page.getByTestId('card-menu');
  await expect(cardMenu).toBeVisible();
  await cardMenu.getByRole('button', { name: 'Copiar la Nota Nueva nota' }).click();
  await expect(button(page, 'Pegar')).toBeEnabled();

  const pastePoint = { x: Math.min(760, canvas.width - 250), y: Math.min(520, canvas.height - 180) };
  const beforePaste = await canvasTransform();
  const expectedPaste = {
    x: Math.floor((pastePoint.x - beforePaste.x) / beforePaste.scale / cellSize(page).x),
    y: Math.floor((pastePoint.y - beforePaste.y) / beforePaste.scale / cellSize(page).y),
  };
  await background.click({ button: 'right', position: pastePoint, force: true });
  await expect(canvasMenu.getByRole('button', { name: 'Pegar una copia en esta posición' })).toBeVisible();
  await canvasMenu.getByRole('button', { name: 'Pegar una copia en esta posición' }).click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(2);
  const pasted = await box(card(page, 2));
  const afterPaste = await canvasTransform();
  expect(Math.round((pasted.x - canvas.x - afterPaste.x) / afterPaste.scale / cellSize(page).x)).toBe(expectedPaste.x);
  expect(Math.round((pasted.y - canvas.y - afterPaste.y) / afterPaste.scale / cellSize(page).y)).toBe(expectedPaste.y);

  await card(page, 2).click({ button: 'right' });
  await page.screenshot({ path: testInfo.outputPath('note-copy-menu.png') });
  await page.getByTestId('card-menu').getByRole('button', { name: 'Duplicar la Nota Nueva nota' }).click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expect(button(page, 'Deshacer: Tarjeta duplicada')).toBeVisible();
});

test('UX7-CONTEXT-MENUS: note clipboard actions remain available on mobile', async ({ page }, testInfo) => {
  test.skip(!isCompact(page), 'This check covers the compact accessible alternative.');
  await page.goto('./');
  await createWorkspace(page, 'Menú móvil');
  await addCards(page, ['nota']);

  await openCardActions(page, card(page, 1), 'Nueva nota');
  const menu = page.getByTestId('card-menu');
  await menu.getByRole('button', { name: 'Copiar la Nota Nueva nota' }).click();
  await expect(button(page, 'Pegar')).toBeEnabled();
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await page.screenshot({ path: testInfo.outputPath('note-copy-menu-mobile.png') });
  await menu.getByRole('button', { name: 'Duplicar la Nota Nueva nota' }).click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(2);
  await expect(button(page, 'Deshacer: Tarjeta duplicada')).toBeVisible();
});

test('UX7-BOARD-WIDTHS: both rails resize, persist locally and stay responsive', async ({ page }) => {
  test.skip(isCompact(page), 'Resizable side rails belong to the desktop layout.');
  await page.goto('./');
  await createWorkspace(page, 'Barras ajustables');
  await button(page, 'Crear un tablero').click();

  const left = page.getByTestId('workspace-sidebar');
  const leftHandle = page.getByTestId('left-sidebar-resize');
  const right = page.getByTestId('board-tabs');
  const rightHandle = page.getByTestId('board-rail-resize');
  expect((await box(left)).width).toBe(220);
  expect((await box(right)).width).toBe(72);
  const boardOptions = right.getByRole('button', { name: 'Opciones de tableros', exact: true });
  await expect(boardOptions).toBeVisible();
  await expect(right.getByRole('button', { name: 'Volver a Proyectos', exact: true })).toHaveCount(0);
  await expect(right.getByRole('button', { name: 'Organizar tableros', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/ux7-b-board-rail-narrow.png' });
  await boardOptions.focus();
  await page.keyboard.press('Enter');
  const organizer = page.getByTestId('board-organizer-dialog');
  await expect(organizer).toBeVisible();
  await page.screenshot({ path: 'artifacts/ux7-b-board-organizer.png' });
  await organizer.getByRole('button', { name: /^Cerrar organizar tableros/ }).click();
  await expect(organizer).toHaveCount(0);
  await expect(button(page, 'Cambiar de proyecto')).toBeVisible();

  await button(page, 'Opciones del tablero Tablero 1').click();
  const individualActions = page.getByTestId('board-actions-dialog');
  await expect(individualActions.getByLabel('Nombre del tablero')).toBeVisible();
  await expect(individualActions.getByRole('button', { name: 'Guardar nombre', exact: true })).toBeVisible();
  await expect(individualActions.getByRole('button', { name: 'Mover antes', exact: true })).toBeVisible();
  await expect(individualActions.getByRole('button', { name: 'Mover después', exact: true })).toBeVisible();
  await expect(individualActions.getByRole('button', { name: 'Archivar tablero', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ux7-b-individual-actions.png' });
  await individualActions.getByRole('button', { name: /^Cerrar acciones de tablero 1/ }).click();

  await leftHandle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '228');
  expect((await box(left)).width).toBe(228);
  await mouseDrag(page, leftHandle, 32, 0, { header: false });
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '260');
  expect((await box(left)).width).toBe(260);

  await mouseDrag(page, rightHandle, -120, 0, { header: false });
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '192');
  expect((await box(right)).width).toBe(192);
  await rightHandle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '184');
  await page.keyboard.press('ArrowLeft');
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '192');
  const horizontalLabel = right.getByText('TABLERO 1', { exact: true });
  expect((await box(horizontalLabel)).width).toBeGreaterThan((await box(horizontalLabel)).height);
  expect(await horizontalLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(boardOptions.getByText('Opciones de tableros', { exact: true })).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('noutynotes.view.v1') ?? '{}'));
  expect(stored).toMatchObject({ leftSidebarWidth: 260, boardRailWidth: 192 });
  const canvasBox = await box(page.getByTestId('board-canvas'));
  expect(canvasBox.width).toBeGreaterThan(500);
  await page.screenshot({ path: 'artifacts/ux7-b-board-rail-wide.png' });

  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Barras tras recargar');
  await button(page, 'Crear un tablero').click();
  const reloadedLeft = page.getByTestId('workspace-sidebar');
  const reloadedLeftHandle = page.getByTestId('left-sidebar-resize');
  const reloadedRight = page.getByTestId('board-tabs');
  const reloadedRightHandle = page.getByTestId('board-rail-resize');
  expect((await box(reloadedLeft)).width).toBe(260);
  expect((await box(reloadedRight)).width).toBe(192);
  await mouseDrag(page, reloadedLeftHandle, -4, 0, { header: false });
  await expect(reloadedLeftHandle).toHaveAttribute('aria-valuenow', '256');
  await mouseDrag(page, reloadedRightHandle, 8, 0, { header: false });
  await expect(reloadedRightHandle).toHaveAttribute('aria-valuenow', '184');

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByTestId('board-tabs')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId('board-tabs')).toHaveCount(0);
  await expect(page.getByTestId('open-tabs')).toBeVisible();
  await button(page, 'Más secciones').click();
  await expect(page.getByTestId('more-sheet').getByRole('button', { name: 'Cambiar de proyecto' })).toBeVisible();
  await button(page, 'Cerrar más').click();

  await page.setViewportSize(phone);
  await expect(leftHandle).toHaveCount(0);
  await expect(rightHandle).toHaveCount(0);
  await expect(page.getByTestId('open-tabs')).toBeVisible();
  await expect(button(page, 'Organizar tableros')).toBeVisible();
  await button(page, 'Más secciones').click();
  await expect(button(page, 'Cambiar de proyecto')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ux7-b-compact-navigation.png' });
});

/** Selecciona una tarjeta cuando la prueba necesita abrir su menú contextual. */
async function selectCard(page: Page, id: number) {
  await expect(async () => {
    if (await card(page, id).getAttribute('aria-pressed') !== 'true') {
      await card(page, id).focus();
      await page.keyboard.press('Space');
    }
    await expect(card(page, id)).toHaveAttribute('aria-pressed', 'true', { timeout: 100 });
  }).toPass({ intervals: [100, 100, 100, 100, 100] });
}
const feedback = (page: Page) => page.getByTestId('workspace-feedback');
const geometry = (page: Page) => page.getByTestId('card-geometry');
// Celda cuadrada (UX7-D1): 48 px de fila (40 en compacto) al zoom inicial de 100 %.
const cellSize = (page: Page) => ((page.viewportSize()?.width ?? 0) >= at.width ? { x: 48, y: 48 } : { x: 40, y: 40 });

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo espacio').fill(name);
  await button(page, 'Crear un espacio').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function addCards(page: Page, kinds: readonly 'nota'[]) {
  const start = await page.locator('[data-testid^="card-tarjeta-"]').count();
  for (const [index] of kinds.entries()) {
    await insertFromMenu(page, 'Insertar nota');
    await expect(card(page, start + index + 1)).toBeVisible();
  }
}

async function closeEditor(page: Page) {
  await button(page, 'Cerrar el editor de la tarjeta').click();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
}

/** Abre Presentación (ADR 0031): en compacto vive en «Más secciones», en ancho es un botón directo. */
async function openPresent(page: Page) {
  if (isCompact(page)) {
    await button(page, 'Más secciones').click();
    await expect(page.getByTestId('more-sheet')).toBeVisible();
  }
  await button(page, 'Presentar este tablero').click();
  await expect(page.getByTestId('present-view')).toBeVisible();
}

/** Activa con teclado el control de edición aunque una cabecera compacta no lo pinte en pantalla. */
async function openCardEditor(page: Page, id: number) {
  if (await page.getByTestId('card-inspector').isVisible()) await closeEditor(page);
  await card(page, id).focus();
  if (await card(page, id).getAttribute('aria-pressed') !== 'true') {
    // El lienzo descarta durante 400 ms el click sintético que web emite al terminar un gesto. Si el
    // editor se consulta justo después, reintenta la activación hasta que esa guarda haya vencido.
    await expect(async () => {
      if (await card(page, id).getAttribute('aria-pressed') !== 'true') {
        await card(page, id).evaluate((element) => (element as HTMLButtonElement).click());
      }
      await expect(card(page, id)).toHaveAttribute('aria-pressed', 'true', { timeout: 100 });
    }).toPass({ intervals: [100, 100, 100, 100, 100] });
  }
  await openFullCardEditor(page, card(page, id));
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Elemento sin geometría medible');
  return found;
}

/** P18-D: «Insertar conector» entra en modo de marcar dos posiciones (no coloca al insertar, a
 * diferencia del resto de primitivas); este ayudante marca dos puntos libres del lienzo para dejarlo
 * decorativo, sin anclarlo a ninguna tarjeta. Los puntos reproducen el espaciado ya probado en
 * `cards.spec.ts` (P18-D): demasiado cerca, sus dos tramos se superponen y tapan el toque del otro. */
async function placeConnector(page: Page) {
  await expect(page.getByText('Conector: toca una posición libre o una tarjeta para marcar la posición 1.')).toBeVisible();
  const background = page.getByTestId('canvas-background');
  const canvas = await box(background);
  const tap = async (x: number, y: number) => {
    if (isCompact(page)) await background.tap({ position: { x, y } });
    else await background.click({ position: { x, y } });
  };
  await tap(Math.min(90, canvas.width / 4), Math.min(110, canvas.height / 3));
  await tap(Math.min(280, canvas.width - 55), Math.min(260, canvas.height - 80));
}

/**
 * Un conector decorativo (sin anclar) no dibuja una ficha táctil propia en el lienzo —`cardAt`
 * (Canvas.tsx) lo excluye a propósito para no bloquear el toque de lo que tenga detrás— así que su
 * editor completo (estilo, anclaje, ruta) se abre con doble clic sobre uno de sus tramos, nunca con
 * `openFullCardEditor`. Solo existe como ficha normal (`card-tarjeta-N`) en la vista de Lista.
 */
async function openConnectorEditor(page: Page) {
  await page.locator('[data-testid^="connector-segment-"]').first().dblclick();
  await page.getByTestId('card-inspector').waitFor({ state: 'visible' });
}

/** Arrastre con ratón en pasos, desde la cabecera de la tarjeta (o el centro del elemento). */
/** Por la cabecera se agarra a 20 px del borde izquierdo: los controles van a la derecha (ADR 0016). */
async function mouseDrag(page: Page, locator: Locator, dx: number, dy: number, options: { release?: boolean; header?: boolean } = {}) {
  const found = await box(locator);
  const x = found.x + (options.header === false ? Math.min(found.width / 2, 60) : 20);
  const y = found.y + (options.header === false ? found.height / 2 : 12);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10);
  if (options.release !== false) await page.mouse.up();
}

/**
 * Botón central del ratón (ADR 0048): desplaza el lienzo en ambos ejes desde cualquier punto, incluida
 * una ficha, sin activar Mano, mover la tarjeta ni cambiar la selección. Es el equivalente de escritorio
 * a la herramienta Mano, que la barra de escritorio ya no muestra.
 */
async function middleDrag(page: Page, locator: Locator, dx: number, dy: number) {
  const found = await box(locator);
  const [x, y] = [found.x + found.width / 2, found.y + found.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10);
  await page.mouse.up({ button: 'middle' });
}

/** Arrastre táctil real (eventos touch de Chromium), no simulado con ratón. */
async function touchDrag(page: Page, locator: Locator, dx: number, dy: number, header = true) {
  const found = await box(locator);
  const x = Math.round(found.x + (header ? 20 : found.width / 2));
  const y = Math.round(found.y + (header ? 12 : found.height / 2));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + (dx * step) / 10), y: Math.round(y + (dy * step) / 10) }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** En móvil el editor ocupa parte de la pantalla: se oculta para usar las asas del lienzo. */
async function revealCanvas(page: Page) {
  const hide = button(page, 'Ocultar el editor de la tarjeta');
  if (await button(page, 'Volver al tablero').isVisible()) await button(page, 'Volver al tablero').click();
  if (await hide.isVisible()) await hide.click();
}

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) < at.width;

/** «Restablecer vista»: zoom 100 % y cámara en el origen (barra en escritorio, Configuración en móvil). */
async function resetView(page: Page) {
  if (isCompact(page)) await inSettings(page, async () => { await button(page, 'Restablecer la vista del lienzo').click(); });
  else await page.getByTestId('zoom-level').click();
}

/**
 * Dos notas lado a lado en la primera fila. Dónde nace la segunda depende del viewport (reproducido
 * el 2026-09-29): en escritorio `findFreeSpace` la coloca pegada a la derecha de la primera, pero en
 * móvil nace debajo (grilla proyectada, ADR 0004). Se lee su posición real y se mueve con los botones
 * del inspector el desplazamiento exacto que haga falta, en vez de asumir ninguno de los dos casos.
 */
async function sideBySide(page: Page) {
  await addCards(page, ['nota', 'nota']);
  // Crear ya no abre el editor por sí sola (auditoría de interacción, 2026-10-02): la tarjeta recién
  // creada queda seleccionada (sin botón permanente en escritorio); se abre su editor completo para
  // leer y ajustar su posición.
  await openFullCardEditor(page, page.locator('[data-testid^="card-tarjeta-"][aria-pressed="true"]'));
  const cell = async () => {
    const text = await geometry(page).innerText();
    const grid = /Columna (\d+), fila (\d+)/.exec(text);
    if (grid) return { x: Number(grid[1]) - 1, y: Number(grid[2]) - 1 };
    const world = /X (-?\d+), Y (-?\d+)/.exec(text);
    if (!world) throw new Error(`Geometría ilegible: ${text}`);
    return { x: Number(world[1]), y: Number(world[2]) };
  };
  // Cada paso espera a que se guarde el anterior (la geometría cambia) antes de volver a pulsar.
  const step = async (name: string) => {
    const before = await cell();
    await button(page, name).click();
    await expect.poll(cell).not.toEqual(before);
  };
  while ((await cell()).x < 4) await step('Mover a la derecha');
  while ((await cell()).x > 4) await step('Mover a la izquierda');
  while ((await cell()).y > 0) await step('Mover arriba');
  while ((await cell()).y < 0) await step('Mover abajo');
  await expect(geometry(page)).toHaveText('Columna 5, fila 1 · 4 × 3');
  await closeEditor(page);
  await resetView(page);
}

/** Abre la Configuración, ejecuta `action` y la cierra (ADR 0014: grilla, imán y, en móvil, zoom). */
async function inSettings(page: Page, action: () => Promise<void>) {
  await openSettings(page);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await action();
  await button(page, 'Cerrar configuración').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
}

/** Zoom: en escritorio con la barra; en móvil desde la Configuración. */
async function zoomBy(page: Page, direction: 'in' | 'out', times = 1) {
  if (!isCompact(page)) {
    // En el límite el botón se desactiva: se para ahí, como haría el usuario.
    const control = button(page, direction === 'in' ? 'Acercar' : 'Alejar');
    for (let step = 0; step < times && await control.isEnabled(); step += 1) await control.click();
    return;
  }
  await inSettings(page, async () => {
    for (let step = 0; step < times; step += 1) await button(page, direction === 'in' ? 'Acercar el lienzo' : 'Alejar el lienzo').click();
  });
}

async function expectZoom(page: Page, text: string) {
  if (!isCompact(page)) {
    await expect(page.getByTestId('zoom-level')).toContainText(text);
    return;
  }
  await inSettings(page, async () => { await expect(page.getByTestId('settings-zoom')).toHaveText(text); });
}

async function setSwitch(page: Page, name: string, on: boolean) {
  await inSettings(page, async () => {
    const control = page.getByRole('switch', { name });
    if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
    await expect(control).toHaveAttribute('aria-checked', String(on));
  });
}

async function expectGeometry(page: Page, cardNumber: number, text: string) {
  if (await page.getByTestId('card-inspector').isVisible()) await closeEditor(page);
  // `card-geometry` vive dentro del editor. El foco trae al viewport una tarjeta que quedó fuera de
  // cámara. Tras terminar un gesto, el controlador ignora brevemente el clic que ese gesto genera;
  // por eso se confirma la selección observable antes de pulsar el botón explícito «Editar».
  await card(page, cardNumber).focus();
  await expect(card(page, cardNumber)).toBeInViewport();
  // Espacio, no clic: si el gesto anterior (p. ej. un arrastre) ya la dejó seleccionada, un clic la
  // des-seleccionaría, y dos clics seguidos podrían leerse como doble toque y abrir el editor en
  // móvil. Mismo patrón que `tapCard` en cards.spec.ts.
  await expect(async () => {
    if (await card(page, cardNumber).getAttribute('aria-pressed') !== 'true') {
      await card(page, cardNumber).focus();
      await page.keyboard.press('Space');
    }
    await expect(card(page, cardNumber)).toHaveAttribute('aria-pressed', 'true', { timeout: 300 });
  }).toPass();
  await openCardEditor(page, cardNumber);
  await expect(geometry(page)).toHaveText(text);
}

test('UX7: el Inspector separa contenido, apariencia y más opciones; Etiquetas abre su contexto', async ({ page }, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name === 'desktop') await button(page, 'Tema oscuro').click();
  await createWorkspace(page, `Inspector ${testInfo.project.name}`);
  await addCards(page, ['nota']);

  await openCardActions(page, card(page, 1), 'Nueva nota');
  await page.getByRole('button', { name: 'Editar etiquetas de Nueva nota', exact: true }).click();

  const inspector = page.getByTestId('card-inspector');
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId('card-inspector-section-more')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('card-inspector-section-more')).toHaveText('Más');
  await expect(page.getByTestId('card-tags')).toBeVisible();
  await expect(page.getByTestId('card-icon-picker')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ux7-inspector-more.png'), fullPage: true });

  await page.getByTestId('card-inspector-section-appearance').click();
  await expect(page.getByTestId('card-icon-picker')).toBeVisible();
  await expect(page.getByTestId('card-tags')).toHaveCount(0);
  await page.getByTestId('card-icon-option-star').click();
  await expect(page.getByTestId('selected-card-icon')).toContainText('Estrella');
  await expect(page.getByTestId('card-inspector-section-appearance')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('ux7-inspector-appearance.png'), fullPage: true });

  await page.getByTestId('card-inspector-section-content').click();
  await expect(page.getByTestId('body-mode-switch')).toBeVisible();
  await expect(page.getByTestId('card-icon-picker')).toHaveCount(0);
  await expect(hasHorizontalOverflow(page)).resolves.toBe(false);

  await page.screenshot({ path: testInfo.outputPath('ux7-inspector-content.png'), fullPage: true });
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize(tabletPortrait);
    await expect(page.getByTestId('card-inspector-sections')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('ux7-inspector-tablet-portrait.png'), fullPage: true });
    await expect(hasHorizontalOverflow(page)).resolves.toBe(false);
    await page.setViewportSize(tabletLandscape);
    await expect(page.getByTestId('card-inspector-sections')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('ux7-inspector-tablet-landscape.png'), fullPage: true });
    await expect(hasHorizontalOverflow(page)).resolves.toBe(false);
    await page.setViewportSize(desktop);
    await expect(hasHorizontalOverflow(page)).resolves.toBe(false);
  }
});

test('UX7 visual: la Nota larga conserva su toolbar y la geometría cotidiana usa teclado', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'La edición rápida vive en escritorio; móvil usa el editor enfocado.');
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Nota larga');
  await addCards(page, ['nota']);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();

  const inline = page.getByTestId('inline-card-editor');
  const visual = page.getByLabel('Contenido visual');
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible();
  const scroll = visual;
  const more = page.getByTestId('editor-more-format-toggle');
  await expect(inline).toBeVisible();
  await expect(page.getByTestId('inline-card-title')).toHaveCount(0);
  await expect(more).toBeVisible();
  await visual.fill('Línea editorial 1');
  for (let index = 2; index <= 36; index += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Línea editorial ${index}`);
  }
  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('nota-larga-antes-scroll.png') });
  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const toolbarY = (await box(more)).y;
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await box(more)).y - toolbarY)).toBeLessThanOrEqual(1);
  await more.click();
  await expect(page.getByTestId('editor-more-format-row')).toBeVisible();
  await expect(button(page, 'Editar enlace')).toBeVisible();
  await expect(button(page, 'Insertar una tabla')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('nota-larga-toolbar.png') });
  await button(page, 'Guardar y cerrar la edición rápida').click();

  await selectCard(page, 1);
  const before = await box(card(page, 1));
  await card(page, 1).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await box(card(page, 1))).x - before.x)).toBe(cellSize(page).x);
  const moved = await box(card(page, 1));
  await card(page, 1).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => Math.round((await box(card(page, 1))).width - moved.width)).toBe(cellSize(page).x);

  await openCardEditor(page, 1);
  await page.getByTestId('card-inspector-section-more').click();
  await expect(page.getByTestId('card-geometry')).toHaveCount(0);
  await expect(button(page, 'Mover a la izquierda')).toHaveCount(0);
  await expect(button(page, 'Reducir ancho')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('inspector-sin-geometria.png') });
  expect(runtimeErrors).toEqual([]);
});

test('flujo principal: estado vacío, crear, editar, conectar, mover con botones y reabrir en la sesión', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expect(page.getByTestId('memory-notice')).toContainText('se pierden al recargar o cerrar la pestaña');
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');

  // 1. Espacio vacío: el lienzo invita a crear la primera nota y no hay inspector vacío.
  await createWorkspace(page, 'Guion corto');
  await expect(page).toHaveURL(/workspace\?id=guion-corto$/);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expect(page.getByTestId('workspace-memory')).toHaveText('SOLO EN MEMORIA · SE PIERDE AL RECARGAR');
  await page.screenshot({ path: testInfo.outputPath('workspace-empty.png') });
  await button(page, 'Crear la primera nota').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(page.getByTestId('board-empty')).toHaveCount(0);
  await expect(feedback(page)).toHaveText('Nota añadida. Guardado en memoria.');

  // 2. Más tarjetas, con cabecera numerada por tipo. La muestra de imagen sin archivo se retiró en
  // P18-B; la importación real tiene su prueba dedicada («imagen real…», cards.spec.ts).
  await addCards(page, ['nota', 'nota']);
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  // La grilla cuadrada y los controles reservan la cabecera: el número siempre permanece legible;
  // el tipo completo solo aparece cuando el ancho real de la ficha deja espacio suficiente.
  await expect(card(page, 1)).toContainText('001');
  await expect(card(page, 3)).toContainText('003');
  // Crear ya no abre el editor por sí sola (auditoría de interacción, 2026-10-02): se abre a mano.
  await openFullCardEditor(page, card(page, 3));
  await expect(page.getByTestId('card-inspector')).toBeVisible();

  // 3. Editar título y cuerpo (encabezado + lista) como HTML seguro v1 (ADR 0066): en web ya no
  // hay una vista Markdown; esta es la vía real para teclear estructura en vez de la barra rica.
  await tapCard(page, 1);
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await fillCardTitle(page, 'Escena inicial');
  await button(page, 'Editar el código HTML del cuerpo').click();
  await page.getByTestId('html-source-input').fill('<h1>Plano</h1>\n<ul><li>abierto</li></ul>');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await button(page, 'Validar y aplicar el código HTML').click();
  await button(page, 'Editar el cuerpo visualmente').click();
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await expect(card(page, 1)).toContainText('Escena inicial');
  await expect(card(page, 1)).toContainText('Plano');

  // 4. Botones del inspector (alternativa accesible a los gestos) con los errores del motor.
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await page.getByRole('button', { name: /^Mover despu/ }).click();
  await expect(geometry(page)).toHaveText('X -1, Y 0 · 4 × 3');
  await page.getByRole('button', { name: /^Mover despu/ }).click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  // Dónde nace la segunda nota depende del viewport: a la derecha en escritorio y debajo en móvil
  // (ADR 0004). Se intenta el movimiento que realmente la invade en cada distribución.
  await button(page, isCompact(page) ? 'Mover abajo' : 'Mover a la derecha').click();
  await expect(page.getByRole('alert')).toHaveText('Ahí se solaparía con otra tarjeta.');
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await button(page, 'Más estrecha').click();
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 3 × 3');

  // 5. Conectar desde el menú contextual (clic derecho o «⋯»): fija el origen y activa la herramienta
  // en un solo paso (ADR 0048, en vez de la lista de conexiones del editor y la antigua herramienta de
  // la barra); tocar otra tarjeta conecta o desconecta, y tocar el origen cancela sin cambiar nada.
  await closeEditor(page);
  await openCardActions(page, card(page, 1), 'Escena inicial');
  await button(page, 'Conectar desde Escena inicial').click();
  await expect(page.getByTestId('connect-hint-tarjeta-1')).toHaveText('Origen · toca otra tarjeta');
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveText('+ Conectar');
  await expect(page.getByTestId('connect-hint-tarjeta-3')).toHaveText('+ Conectar');
  await expect(feedback(page)).toContainText('Origen: «Escena inicial»');
  await page.screenshot({ path: testInfo.outputPath('workspace-connecting.png') });
  await tapCard(page, 2, false);
  await expect(feedback(page)).toHaveText('Tarjetas conectadas. Guardado en memoria.');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(1);
  await tapCard(page, 1, false);
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveText('× Desconectar');
  await tapCard(page, 2, false);
  await expect(feedback(page)).toHaveText('Conexión eliminada. Guardado en memoria.');
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);
  await tapCard(page, 1, false);
  await tapCard(page, 3, false);
  await expect(feedback(page)).toHaveText('Tarjetas conectadas. Guardado en memoria.');
  await expect(page.getByTestId('relation-line-relacion-2')).toHaveCount(1);
  await expect(card(page, 3)).not.toContainText(/conexi[oó]n/i);
  // Tocar el origen cancela sin cambiar nada.
  await tapCard(page, 1, false);
  await tapCard(page, 1, false);
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveCount(0);
  await button(page, 'Herramienta Seleccionar').click();

  // 6. Volver, crear otro, cambiar de tema y reabrir el primero con su estado.
  await button(page, 'Volver a mis espacios').click();
  await expect(button(page, 'Abrir Guion corto')).toBeVisible();
  await createWorkspace(page, 'Otro espacio');
  await addCards(page, ['nota']);
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Tema oscuro').click();
  await button(page, 'Abrir Guion corto').click();
  await expect(page.getByRole('heading', { name: 'Guion corto', exact: true })).toBeVisible();
  await expect(page.getByTestId('workspace-screen')).toHaveCSS('background-color', rgb(themeColors.dark.background));
  await expect(page.getByTestId('board-canvas')).toHaveCSS('background-color', rgb(themeColors.dark.canvas));
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 3 × 3');
  // La lista de conexiones ya no vive en el editor de escritorio (ADR 0048): su línea en el lienzo
  // basta para confirmar que la conexión sobrevivió a reabrir con el tema cambiado.
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(1);
  await tapCard(page, 1);
  await expect(page.getByLabel('Contenido visual').locator('h1')).toHaveText('Plano');
  await expect(page.getByLabel('Contenido visual').locator('li')).toHaveText('abierto');
  await page.screenshot({ path: testInfo.outputPath('workspace-reopened-dark.png') });

  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P06: la edición rápida abre texto enriquecido visual por defecto y conserva el editor completo (ADR 0047)', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'En móvil la edición usa la pantalla enfocada completa.');
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Edición directa');
  await addCards(page, ['nota']);
  await openCardEditor(page, 1);
  await fillCardTitle(page, 'Idea editada aquí');
  await closeEditor(page);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Idea editada aquí');
  await page.screenshot({ path: testInfo.outputPath('card-actions-menu.png') });
  await button(page, 'Editar Idea editada aquí dentro de la ficha').click();

  const inline = page.getByTestId('inline-card-editor');
  await expect(inline).toBeVisible();
  const cardBox = await box(card(page, 1));
  const editorBox = await box(inline);
  expect(Math.abs(editorBox.x - cardBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.y - cardBox.y)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('inline-card-editor.png') });
  const visual = page.getByLabel('Contenido visual');
  await expect(visual).toBeVisible();
  await expect(button(page, 'Editar como Markdown')).toHaveCount(0);
  await expect(page.getByTestId('inline-card-content')).toHaveCount(0);
  await visual.fill('');
  await button(page, 'Negrita').click();
  await page.keyboard.type('Texto visible ');
  await button(page, 'Negrita').click();
  await page.keyboard.type('normal');
  await expect(visual.locator('strong')).toHaveText('Texto visible ');
  // P18-E3-B1: la transferencia no espera el debounce ni un guardado durable. El editor completo
  // recibe la misma sesión y un callback tardío de la superficie rápida ya no conserva autoridad.
  await button(page, 'Continuar en el Inspector').first().click();
  await expect(inline).toHaveCount(0);
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(page.getByLabel('Nombre de la Nota')).toHaveValue('Idea editada aquí');
  await expect(page.getByLabel('Contenido visual')).toContainText('Texto visible normal');
  await page.waitForTimeout(800);
  await fillCardTitle(page, 'Idea final completa');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);
  await expect(card(page, 1)).toContainText('Idea final completa');
  await expect(card(page, 1)).toContainText('Texto visible normal');
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Idea final completa');
  await button(page, 'Editar Idea final completa dentro de la ficha').click();
  await expect(page.getByTestId('inline-card-editor')).toBeVisible();
  await expect(page.getByTestId('inline-card-title')).toHaveCount(0);
  await expect(card(page, 1)).toHaveAttribute('aria-label', 'Tarjeta Idea final completa');
  await expect(page.getByLabel('Contenido visual')).toContainText('Texto visible normal');
  await button(page, 'Guardar y cerrar la edición rápida').click();

  // Regresión P06 (2026-10-05): el editor guarda Markdown canónico, pero la ficha debe
  // representar sus marcas; nunca debe enseñar `**` ni entidades generadas por el serializer.
  await expect(card(page, 1)).not.toContainText('**');
  await expect(card(page, 1)).not.toContainText('&#x');
  await expect(page.getByTestId('card-rich-text-tarjeta-1-run-0-0')).toHaveCSS('font-weight', /^(700|bold)$/);
  await page.screenshot({ path: testInfo.outputPath('rich-text-card-rendered.png') });

  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('list-rich-text-tarjeta-1')).toContainText('Texto visible normal');
  await expect(page.getByTestId('list-rich-text-tarjeta-1')).not.toContainText('**');
  await expect(page.getByTestId('list-rich-text-tarjeta-1')).not.toContainText('&#x');
  await expect(page.getByTestId('list-rich-text-tarjeta-1-run-0-0')).toHaveCSS('font-weight', /^(700|bold)$/);
  await page.screenshot({ path: testInfo.outputPath('rich-text-list-rendered.png') });
  await button(page, 'Vista de lista').click();

  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Idea final completa');
  await button(page, 'Abrir el Inspector de Idea final completa').click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  // La comprobación de los bytes Markdown exactos (escape de entidad en el límite de «negrita») ya
  // no es alcanzable desde aquí: esa vista se retiró en web (P18-E3-B2). Queda pendiente como caso
  // dedicado en packages/storage/src/rich-text-codec.test.ts; ver Docs/AI_HANDOFF.md.
  expect(runtimeErrors).toEqual([]);
});

test('P06: Visual es predeterminado y alterna con HTML sobre un solo borrador', async ({ page }) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Editor visual');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  const visual = page.getByLabel('Contenido visual');
  // El título es otra instancia del mismo editor Lexical (ADR 0060): se acota al que de verdad
  // contiene «Contenido visual» para no resolver a dos elementos con el mismo testID/etiqueta.
  const bodyEditor = page.getByTestId('web-rich-text-editor').filter({ has: visual });
  await expect(bodyEditor).toBeVisible();
  await expect(page.getByLabel('Contenido Markdown')).toHaveCount(0);
  await visual.fill('Texto fuerte');
  await visual.selectText();
  await bodyEditor.getByRole('button', { name: 'Negrita', exact: true }).click();
  await expect(visual.locator('strong')).toHaveText('Texto fuerte');
  const undoBody = bodyEditor.getByRole('button', { name: 'Deshacer en el editor', exact: true });
  const redoBody = bodyEditor.getByRole('button', { name: 'Rehacer en el editor', exact: true });
  await expect(undoBody).toBeEnabled();
  await undoBody.click();
  await expect(visual.locator('strong')).toHaveCount(0);
  await redoBody.click();
  await expect(visual.locator('strong')).toHaveText('Texto fuerte');
  // P18-E3-B2 sustituyó la vista Markdown por HTML como fuente de texto en web (ADR 0066);
  // este es el camino real hoy para inspeccionar/editar el cuerpo como texto en vez de visualmente.
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(page.getByTestId('html-source-input')).toHaveValue('<p><strong>Texto fuerte</strong></p>');
  await button(page, 'Editar el cuerpo visualmente').click();
  await expect(page.getByLabel('Contenido visual').locator('strong')).toHaveText('Texto fuerte');

  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.', { timeout: 3_000 });
  await closeEditor(page);
  await tapCard(page, 1);
  if (await expandEditor.count() > 0) await expandEditor.click();
  await expect(page.getByLabel('Contenido visual').locator('strong')).toHaveText('Texto fuerte');
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P18-E3-B2: alterna Visual y HTML, aplica una fuente válida y reabre el documento semántico', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Fuente HTML');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const visual = page.getByLabel('Contenido visual');
  await visual.fill('Visual inicial');
  await button(page, 'Editar el código HTML del cuerpo').click();
  const source = page.getByTestId('html-source-input');
  await expect(source).toHaveValue('<p>Visual inicial</p>');
  await source.fill('<h2><strong>HTML válido</strong></h2>\n<p>Texto <em>portable</em>.</p>');
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente modificada');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('visual-html-current.png'), fullPage: true });
  await button(page, 'Validar y aplicar el código HTML').click();
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente válida aplicada');
  await button(page, 'Editar el cuerpo visualmente').click();
  await expect(visual.locator('h2 strong')).toHaveText('HTML válido');
  await expect(visual.locator('p em')).toHaveText('portable');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Abrir el Inspector de Nueva nota').click();
  await expect(page.getByLabel('Contenido visual').locator('h2 strong')).toHaveText('HTML válido');
  await page.setViewportSize(tabletPortrait);
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(page.getByTestId('html-source-input')).toContainText('HTML válido');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('visual-html-tablet-portrait.png'), fullPage: true });
  await button(page, 'Editar el cuerpo visualmente').click();
  await page.setViewportSize(tabletLandscape);
  await expect(page.getByLabel('Contenido visual').locator('h2 strong')).toHaveText('HTML válido');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('visual-html-tablet-landscape.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});

test('P18-E3-B3-A: Visual y HTML conservan encabezados, negrita/cursiva, enlaces, listas y checklist con equivalencia semántica', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Texto enriquecido B3-A');
  await addCards(page, ['nota']);
  await tapCard(page, 1);

  // El título es una zona aparte (titleRichText): se fija antes de tocar el cuerpo y debe
  // sobrevivir intacto a todas las alternancias Visual/HTML que siguen.
  const title = page.getByLabel('Título de la tarjeta');
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Título con **marcas** intacto');

  // Siembra el documento completo (encabezado H1, negrita+cursiva, enlace, viñetas, numerada y
  // checklist, y un segundo encabezado H3) directamente como HTML seguro v1: en web ya no existe
  // una vista Markdown (P18-E3-B2 la sustituyó por este conmutador), así que el camino real para
  // una persona usuaria es exactamente este.
  await button(page, 'Editar el código HTML del cuerpo').click();
  const source = page.getByTestId('html-source-input');
  const seed = '<h1>Plan</h1>\n'
    + '<p>Texto con <strong>negrita</strong> y <em>cursiva</em> combinadas, además de un <a href="https://example.com/plan">enlace</a>.</p>\n'
    + '<ul><li>Uno</li><li>Dos</li></ul>\n'
    + '<ol><li>Primero</li><li>Segundo</li></ol>\n'
    + '<ul data-nouty-list="checklist"><li data-nouty-checked="false">Pendiente</li><li data-nouty-checked="true">Hecho</li></ul>\n'
    + '<h3>Cierre</h3>';
  await source.fill(seed);
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente modificada');
  await button(page, 'Validar y aplicar el código HTML').click();
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente válida aplicada');

  // HTML → Visual: nada de lo sembrado se pierde ni se degrada a párrafo/texto plano.
  await button(page, 'Editar el cuerpo visualmente').click();
  const visual = page.getByLabel('Contenido visual');
  // El título es otra instancia del mismo editor Lexical y repite las mismas etiquetas de
  // deshacer/rehacer: se acota al editor que de verdad contiene «Contenido visual».
  const bodyEditor = page.getByTestId('web-rich-text-editor').filter({ has: visual });
  await expect(visual.locator('h1')).toHaveText('Plan');
  await expect(visual.locator('strong').first()).toHaveText('negrita');
  await expect(visual.locator('em')).toHaveText('cursiva');
  await expect(visual.locator('a')).toHaveAttribute('href', 'https://example.com/plan');
  await expect(visual.locator('a')).toHaveText('enlace');
  await expect(visual.locator('ul li').filter({ hasText: 'Uno' })).toBeVisible();
  await expect(visual.locator('ul li').filter({ hasText: 'Dos' })).toBeVisible();
  await expect(visual.locator('ol li')).toHaveText(['Primero', 'Segundo']);
  await expect(visual.locator('li[role="checkbox"]')).toHaveCount(2);
  const pending = visual.locator('li[role="checkbox"]').filter({ hasText: 'Pendiente' });
  const done = visual.locator('li[role="checkbox"]').filter({ hasText: 'Hecho' });
  await expect(pending).toHaveAttribute('aria-checked', 'false');
  await expect(done).toHaveAttribute('aria-checked', 'true');
  await expect(visual.locator('h3')).toHaveText('Cierre');

  // Edición real en Visual: marcar la casilla pendiente y aplicar negrita al segundo encabezado,
  // con deshacer/rehacer sobre esa misma operación (historial interno del editor, no el del Workspace).
  await pending.click({ position: { x: 4, y: 10 } });
  await expect(pending).toHaveAttribute('aria-checked', 'true');
  await visual.locator('h3').selectText();
  await page.keyboard.press('Control+b');
  await expect(visual.locator('h3 strong')).toHaveText('Cierre');
  await bodyEditor.getByRole('button', { name: 'Deshacer en el editor', exact: true }).click();
  await expect(visual.locator('h3 strong')).toHaveCount(0);
  await bodyEditor.getByRole('button', { name: 'Rehacer en el editor', exact: true }).click();
  await expect(visual.locator('h3 strong')).toHaveText('Cierre');

  // Visual → HTML: la representación refleja la casilla marcada y la negrita nuevas; se modifica
  // ahí mismo una estructura válida (el enlace y la lista numerada) antes de volver a aplicar.
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(source).toHaveValue(/data-nouty-checked="true">Pendiente/);
  await expect(source).toHaveValue(/<h3><strong>Cierre<\/strong><\/h3>/);
  const current = await source.inputValue();
  const updated = current
    .replace('href="https://example.com/plan"', 'href="https://example.org/plan-final"')
    .replace('<li>Segundo</li>', '<li>Segundo</li><li>Tercero</li>');
  await source.fill(updated);
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente modificada');
  await button(page, 'Validar y aplicar el código HTML').click();
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente válida aplicada');

  // HTML → Visual de nuevo: la edición hecha como texto HTML también llega intacta.
  await button(page, 'Editar el cuerpo visualmente').click();
  await expect(visual.locator('a')).toHaveAttribute('href', 'https://example.org/plan-final');
  await expect(visual.locator('ol li')).toHaveText(['Primero', 'Segundo', 'Tercero']);

  // El título no se tocó en ningún momento de la edición del cuerpo.
  await expect(title).toHaveText('Título con **marcas** intacto');

  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.', { timeout: 3_000 });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('p18-e3-b3-a-rich-text.png'), fullPage: true });

  // Cerrar y reabrir (misma sesión en memoria): equivalencia completa del documento semántico.
  await closeEditor(page);
  await tapCard(page, 1);
  const reopened = page.getByLabel('Contenido visual');
  await expect(reopened.locator('h1')).toHaveText('Plan');
  await expect(reopened.locator('strong').first()).toHaveText('negrita');
  await expect(reopened.locator('em')).toHaveText('cursiva');
  await expect(reopened.locator('a')).toHaveAttribute('href', 'https://example.org/plan-final');
  await expect(reopened.locator('ol li')).toHaveText(['Primero', 'Segundo', 'Tercero']);
  await expect(reopened.locator('ul li').filter({ hasText: 'Uno' })).toBeVisible();
  await expect(reopened.locator('li[role="checkbox"]').filter({ hasText: 'Pendiente' })).toHaveAttribute('aria-checked', 'true');
  await expect(reopened.locator('li[role="checkbox"]').filter({ hasText: 'Hecho' })).toHaveAttribute('aria-checked', 'true');
  await expect(reopened.locator('h3 strong')).toHaveText('Cierre');
  await expect(page.getByLabel('Título de la tarjeta')).toHaveText('Título con **marcas** intacto');
  expect(runtimeErrors).toEqual([]);
});

test('P18-E3-B3-A: una fuente HTML inválida con listas/encabezados queda recuperable sin alterar el documento válido', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'HTML inválido B3-A');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  await button(page, 'Editar el código HTML del cuerpo').click();
  const source = page.getByTestId('html-source-input');
  await source.fill('<h1>Válido</h1><ul><li>Uno</li></ul>');
  await button(page, 'Validar y aplicar el código HTML').click();
  await expect(page.getByTestId('html-source-status')).toContainText('Fuente válida aplicada');
  // «Descartar» vuelve al último documento oficialmente guardado, no al último «Aplicar» en memoria:
  // se guarda primero para que ese documento válido sea de verdad la base a la que se vuelve.
  await button(page, 'Editar el cuerpo visualmente').click();
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.', { timeout: 3_000 });
  await button(page, 'Editar el código HTML del cuerpo').click();

  // Fuente inválida: una etiqueta fuera de la lista blanca dentro de una lista, por lo demás válida.
  await source.fill('<h1>Válido</h1><ul><li>Uno</li><li><script>alert(1)</script></li></ul>');
  await expect(page.getByTestId('html-source-error')).toBeVisible();
  // El botón «Visual» no cambia de modo mientras la fuente sea inválida (comportamiento esperado:
  // nunca sustituye el último documento válido por una fuente que no pasó la validación).
  await button(page, 'Editar el cuerpo visualmente').click();
  await expect(page.getByTestId('html-source-input')).toBeVisible();
  await expect(source).toHaveValue(/<script>alert\(1\)<\/script>/);

  // Descartar restaura el documento válido anterior (H1 + lista de un elemento) sin haberlo alterado.
  await button(page, 'Descartar los cambios del código HTML').click();
  await expect(page.getByLabel('Contenido visual').locator('h1')).toHaveText('Válido');
  await expect(page.getByLabel('Contenido visual').locator('li')).toHaveText(['Uno']);
});

test('P07: formato avanzado visual web conserva encabezados, listas, checklist, enlaces e historial', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Formato avanzado');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  await seedBodyHtml(page, '<h2>Plan <a href="https://example.com">sitio</a></h2>\n<ul><li>Uno</li><li>Dos</li></ul>\n'
    + '<ul data-nouty-list="checklist"><li data-nouty-checked="false">Pendiente</li><li data-nouty-checked="true">Lista</li></ul>');
  const visual = page.getByLabel('Contenido visual');
  const bodyEditor = page.getByTestId('web-rich-text-editor').filter({ has: visual });
  await expect(visual.locator('h2')).toContainText('Plan sitio');
  await expect(visual.locator('a')).toHaveAttribute('href', 'https://example.com');
  await expect(visual.locator('li')).toContainText(['Uno', 'Dos', 'Pendiente', 'Lista']);
  await expect(visual.locator('li[role="checkbox"]')).toHaveCount(2);

  await visual.locator('h2').selectText();
  await page.keyboard.press('Control+Alt+3');
  await expect(visual.locator('h3')).toContainText('Plan sitio');
  await bodyEditor.getByRole('button', { name: 'Deshacer en el editor', exact: true }).click();
  await expect(visual.locator('h2')).toContainText('Plan sitio');
  await bodyEditor.getByRole('button', { name: 'Rehacer en el editor', exact: true }).click();
  await expect(visual.locator('h3')).toContainText('Plan sitio');

  await visual.locator('a').selectText();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Dirección del enlace').fill('https://example.org/nuevo');
  await button(page, 'Aplicar').click();
  await expect(visual.locator('a')).toHaveAttribute('href', 'https://example.org/nuevo');

  await visual.locator('li').filter({ hasText: 'Uno' }).selectText();
  await page.keyboard.press('Control+Shift+7');
  await expect(visual.locator('ol li').first()).toContainText('Uno');
  const pending = visual.locator('li[role="checkbox"]').first();
  await expect(pending).toHaveAttribute('aria-checked', 'false');
  await pending.click({ position: { x: 4, y: 10 } });
  await expect(pending).toHaveAttribute('aria-checked', 'true');

  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  await closeEditor(page);
  await tapCard(page, 1);
  if (await expandEditor.count() > 0) await expandEditor.click();
  const reopened = page.getByLabel('Contenido visual');
  await expect(reopened.locator('h3')).toContainText('Plan sitio');
  await expect(reopened.locator('a')).toHaveAttribute('href', 'https://example.org/nuevo');
  await expect(reopened.locator('ol li')).toHaveText(['Uno', 'Dos']);
  await expect(reopened.locator('li[role="checkbox"]').first()).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('p07-advanced-rich-text.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P07: convertir una checklist en encabezado se guarda y no reaparece como casilla con escapes', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Lista a encabezado');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  await seedBodyHtml(page, '<ul data-nouty-list="checklist"><li data-nouty-checked="false">*KNKNLK</li></ul>\n<p>Texto normal</p>');
  const visual = page.getByLabel('Contenido visual');
  await visual.locator('li').selectText();
  await page.getByLabel('Tipo de bloque').selectOption('heading-1');
  await expect(visual.locator('h1')).toContainText('*KNKNLK');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  const cardPreview = card(page, 1);
  await expect(cardPreview).toContainText('*KNKNLK');
  await expect(cardPreview).not.toContainText('☐');
  await expect(cardPreview).not.toContainText('\\*');
  const headingSize = Number.parseFloat(await page.getByTestId('card-rich-text-tarjeta-1-run-0-0').evaluate((node) => getComputedStyle(node).fontSize));
  const paragraphSize = Number.parseFloat(await page.getByTestId('card-rich-text-tarjeta-1-run-1-0').evaluate((node) => getComputedStyle(node).fontSize));
  expect(headingSize).toBeGreaterThan(paragraphSize);
  await page.screenshot({ path: testInfo.outputPath('p07-heading-preview.png') });
  await tapCard(page, 1);
  if (await expandEditor.count() > 0) await expandEditor.click();
  await expect(page.getByLabel('Contenido visual').locator('h1')).toContainText('*KNKNLK');
});

test('P08: imágenes intercaladas se insertan y editan visualmente sin exponer Markdown', async ({ page }, testInfo) => {
  const png = (name: string) => ({
    name, mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.goto('./');
  await createWorkspace(page, 'Imágenes visuales');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();
  const visual = page.getByLabel('Contenido visual');
  await visual.fill('Texto antes de la imagen.');

  const insert = async (name: string) => {
    const chooser = page.waitForEvent('filechooser');
    await button(page, 'Insertar una imagen').click();
    await (await chooser).setFiles(png(name));
  };
  await insert('plano.png');
  const images = visual.locator('[data-testid^="rich-image-"]');
  await expect(images).toHaveCount(1);
  await expect(images.first().locator('img')).toBeVisible();
  await images.first().getByTestId('image-media').click();
  await images.first().getByRole('button', { name: 'Más opciones de imagen' }).click();
  await images.first().getByLabel(/^Texto alternativo/).fill('Plano general');
  await images.first().getByLabel(/^Leyenda/).fill('Leyenda visible');
  await images.first().getByRole('button', { name: 'Tamaño pequeño de la imagen' }).click();
  await expect(images.first().getByTestId('image-layout')).toHaveAttribute('style', /width:\s*25%/);
  await images.first().getByRole('button', { name: 'Tamaño mediano de la imagen' }).click();
  await images.first().getByRole('button', { name: 'Alinear imagen a la derecha' }).click();
  await expect(images.first().getByTestId('image-layout')).toHaveCSS('width', /[1-9]/);

  await visual.click({ position: { x: 12, y: 12 } });
  await page.keyboard.press('End');
  await insert('mapa.png');
  await expect(images).toHaveCount(2);
  await images.last().getByTestId('image-media').click();
  await images.last().getByRole('button', { name: 'Más opciones de imagen' }).click();
  await images.last().getByLabel(/^Texto alternativo/).fill('Mapa inicial');
  await images.last().getByRole('button', { name: /Subir la imagen/ }).click();
  await expect.poll(() => images.evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-testid'), alt: (node.querySelector('[aria-label^="Texto alternativo"]') as HTMLInputElement).value })))).toEqual([
    { id: 'rich-image-assets/images/tarjeta-1-2.png', alt: 'Mapa inicial' },
    { id: 'rich-image-assets/images/tarjeta-1-1.png', alt: 'Plano general' },
  ]);
  await expect(images.first().getByLabel(/^Texto alternativo/)).toHaveValue('Mapa inicial');

  const replace = page.waitForEvent('filechooser');
  await images.first().getByTestId('image-media').click();
  await images.first().getByRole('button', { name: /Reemplazar la imagen/ }).click();
  await (await replace).setFiles(png('mapa-final.png'));
  await expect(images.first().getByLabel(/^Texto alternativo/)).toHaveValue('Mapa inicial');
  await expect(images.last().getByLabel(/^Texto alternativo/)).toHaveValue('Plano general');
  await page.screenshot({ path: testInfo.outputPath('p08-rich-images.png'), fullPage: true });
  // Ambos clics en el mismo turno reproducen la carrera real entre el debounce de Lexical y el
  // guardado: la retirada debe llegar a la sesión editorial antes de que Cerrar vacíe el borrador.
  await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLButtonElement>('button')];
    controls.find((control) => control.getAttribute('aria-label')?.startsWith('Quitar la imagen'))?.click();
    controls.find((control) => control.getAttribute('aria-label') === 'Cerrar el editor de la tarjeta')?.click();
  });
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await tapCard(page, 1);
  if (await expandEditor.count() > 0) await expandEditor.click();
  const reopenedImage = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await expect(reopenedImage).toHaveCount(1);
  await reopenedImage.getByTestId('image-media').click();
  await reopenedImage.getByRole('button', { name: 'Más opciones de imagen' }).click();
  await expect(reopenedImage.getByLabel(/^Texto alternativo/)).toHaveValue('Plano general');
  await expect(reopenedImage.getByLabel(/^Leyenda/)).toHaveValue('Leyenda visible');
  await expect(reopenedImage.getByRole('button', { name: 'Tamaño mediano de la imagen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(reopenedImage.getByRole('button', { name: 'Alinear imagen a la derecha' })).toHaveAttribute('aria-pressed', 'true');
  await reopenedImage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('p08-image-layout-reopened.png'), fullPage: true });
  await closeEditor(page);
  await openSettings(page);
  await button(page, 'Usar el tema oscuro').click();
  await button(page, 'Cerrar configuración').click();
  await tapCard(page, 1);
  if (await expandEditor.count() > 0) await expandEditor.click();
  const darkImage = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await darkImage.scrollIntoViewIfNeeded();
  await darkImage.getByTestId('image-media').click();
  await darkImage.getByRole('button', { name: 'Más opciones de imagen' }).click();
  const darkLayoutControl = darkImage.getByRole('button', { name: 'Tamaño mediano de la imagen' });
  await expect(darkLayoutControl).toHaveAttribute('aria-pressed', 'true');
  const darkControlContrast = await darkLayoutControl.evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(darkControlContrast.color).not.toBe(darkControlContrast.background);
  await page.screenshot({ path: testInfo.outputPath('p08-image-layout-dark.png'), fullPage: true });
  // La comprobación de los bytes Markdown exactos (línea de imagen y comentario de leyenda) ya no
  // es alcanzable desde aquí: esa vista se retiró en web (P18-E3-B2); la cobertura de persistencia de
  // leyendas e imágenes real por carpeta sigue en folder.spec.ts.
});

test('UX7-IMAGE-DIRECT: selecciona, redimensiona y conserva la imagen en edición completa y rápida', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'La edición rápida se ofrece en escritorio.');
  const png = {
    name: 'portada.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  };
  await page.goto('./');
  await createWorkspace(page, 'Manipulación directa');
  await addCards(page, ['nota']);
  await tapCard(page, 1);

  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Insertar una imagen').click();
  await (await chooser).setFiles(png);
  const visual = page.getByLabel('Contenido visual');
  const richImage = visual.locator('[data-testid^="rich-image-"]');
  await richImage.getByTestId('image-media').click();
  await expect(richImage).toHaveAttribute('aria-selected', 'true');
  await expect(richImage.getByTestId('image-context-toolbar')).toBeVisible();
  await expect(richImage.getByTestId('image-advanced-options')).toHaveCount(0);

  const imageBlock = await box(richImage);
  const resize = richImage.getByTestId('image-resize-ne');
  const handle = await box(resize);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - imageBlock.width * 0.27, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect(richImage.getByTestId('image-layout')).toHaveAttribute('style', /width:\s*75%/);
  await richImage.getByRole('button', { name: 'Alinear imagen a la derecha' }).click();
  await richImage.getByRole('button', { name: 'Más opciones de imagen' }).click();
  await expect(richImage.getByTestId('image-advanced-options')).toBeVisible();
  await richImage.getByLabel(/^Texto alternativo/).fill('Portada accesible');
  await richImage.getByLabel(/^Leyenda/).fill('Leyenda escrita bajo la imagen');
  const mediaBox = await box(richImage.getByTestId('image-media'));
  const captionBox = await box(richImage.getByLabel(/^Leyenda/));
  expect(captionBox.y).toBeGreaterThanOrEqual(mediaBox.y + mediaBox.height - 1);
  await page.screenshot({ path: testInfo.outputPath('image-direct-full.png'), fullPage: true });
  await closeEditor(page);

  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();
  const inline = page.getByTestId('inline-card-editor');
  const quickImage = inline.locator('[data-testid^="rich-image-"]');
  await expect(quickImage).toHaveCount(1);
  await quickImage.getByTestId('image-media').click();
  await expect(quickImage.getByTestId('image-context-toolbar')).toBeVisible();
  await quickImage.getByRole('button', { name: 'Alinear imagen a la izquierda' }).click();
  await expect(quickImage.getByTestId('image-context-toolbar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('image-direct-quick.png') });
  await button(page, 'Guardar y cerrar la edición rápida').click();

  await tapCard(page, 1);
  const reopened = page.getByLabel('Contenido visual').locator('[data-testid^="rich-image-"]');
  await reopened.getByTestId('image-media').click();
  await expect(reopened.getByTestId('image-layout')).toHaveAttribute('style', /width:\s*75%/);
  await expect(reopened.getByRole('button', { name: 'Alinear imagen a la izquierda' })).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByRole('button', { name: 'Más opciones de imagen' }).click();
  await expect(reopened.getByLabel(/^Texto alternativo/)).toHaveValue('Portada accesible');
  await expect(reopened.getByLabel(/^Leyenda/)).toHaveValue('Leyenda escrita bajo la imagen');
});

test('UX7-QUICK-EDIT: conserva HTML válido al abrir el editor completo y bloquea la salida con HTML inválido', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'La edición rápida se ofrece en escritorio.');
  await page.goto('./');
  await createWorkspace(page, 'Salida HTML rápida');
  await addCards(page, ['nota']);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();

  const inline = page.getByTestId('inline-card-editor');
  await inline.getByRole('button', { name: 'Editar el código HTML del cuerpo' }).click();
  await inline.getByTestId('inline-html-source').fill('<h2>Transferencia segura</h2><p>Sin aplicar manualmente.</p>');
  await inline.getByRole('button', { name: 'Continuar en el Inspector' }).click();
  await expect(inline).toHaveCount(0);
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await expect(page.getByLabel('Contenido visual').locator('h2')).toHaveText('Transferencia segura');
  await expect(page.getByLabel('Contenido visual').locator('p')).toHaveText('Sin aplicar manualmente.');
  await closeEditor(page);

  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();
  await inline.getByRole('button', { name: 'Editar el código HTML del cuerpo' }).click();
  await inline.getByTestId('inline-html-source').fill('<p><script>no permitido</script></p>');
  await inline.getByRole('button', { name: 'Guardar y cerrar la edición rápida' }).click();
  await expect(inline).toBeVisible();
  await expect(inline.getByTestId('inline-html-error')).toBeVisible();
  await expect(inline.getByTestId('inline-html-source')).toHaveValue('<p><script>no permitido</script></p>');
  await page.screenshot({ path: testInfo.outputPath('quick-edit-invalid-html-protected.png') });
});

test('alineación vertical de Nota se conserva al cerrar y reabrir sin afectar el acceso al contenido', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Alineación vertical');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const visual = page.getByLabel('Contenido visual');
  // Una palabra cabe en una línea incluso en la Nota móvil inicial; así esta primera aserción mide
  // alineación y no activa deliberadamente la política de overflow que se prueba después.
  await visual.fill('Abajo');
  await page.getByTestId('card-inspector-section-appearance').click();
  await button(page, 'Abajo').click();
  await expect(button(page, 'Abajo')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Ocultar siempre').click();
  await closeEditor(page);
  await expect(page.getByTestId('card-body-content-tarjeta-1')).toHaveCSS('justify-content', 'flex-end');
  await page.screenshot({ path: testInfo.outputPath('note-vertical-bottom.png'), fullPage: true });
  await tapCard(page, 1);
  await page.getByTestId('card-inspector-section-appearance').click();
  await expect(button(page, 'Abajo')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('card-inspector-section-content').click();
  const longBody = Array.from({ length: 240 }, (_, index) => `Línea vertical ${index + 1}`).join('\n');
  await page.getByLabel('Contenido visual').fill(longBody);
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible({ timeout: 3_000 });
  await closeEditor(page);
  await card(page, 1).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('card-body-content-tarjeta-1')).toHaveCSS('justify-content', 'flex-start');
  const reader = page.getByTestId('card-reader-tarjeta-1');
  await reader.focus();
  await page.keyboard.press('End');
  await expect(reader).toContainText('Línea vertical 240');
});

test('UX7 NOTE-RELATIONS: las relaciones permanecen operativas sin contador dentro de la Nota', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'La comprobación focal usa el menú contextual de escritorio.');
  await page.goto('./');
  await createWorkspace(page, 'Relaciones sin contador');
  await addCards(page, ['nota', 'nota']);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Conectar desde Nueva nota').click();
  await tapCard(page, 2, false);
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(1);
  await expect(card(page, 1)).not.toContainText(/conexi[oó]n/i);
  await expect(card(page, 2)).not.toContainText(/conexi[oó]n/i);

  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('board-list').getByText(/conexi[oó]n/i)).toHaveCount(0);
});

test('imágenes reales en una nota HTML segura: el cuerpo sigue siendo `contentDocument`, nunca se convierte a Markdown', async ({ page }, testInfo) => {
  const png = (name: string) => ({
    name, mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.goto('./');
  await createWorkspace(page, 'Imágenes HTML');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  // El cuerpo nace HTML seguro (ADR 0066) sin ninguna imagen todavía: la regla de seguridad del
  // proyecto exige que insertar una real no lo convierta a Markdown (antes, `placeVisualImage`
  // siempre serializaba a Markdown sin importar el origen del cuerpo; defecto real corregido aquí).
  await seedBodyHtml(page, '<p>Antes de la imagen.</p>');
  const images = page.locator('[data-testid^="rich-image-"]');
  const insert = async (name: string) => {
    const chooser = page.waitForEvent('filechooser');
    await button(page, 'Insertar una imagen').click();
    await (await chooser).setFiles(png(name));
  };
  await insert('plano.png');
  await expect(images).toHaveCount(1);
  await images.first().getByLabel(/^Texto alternativo/).fill('Plano general');
  await insert('mapa.png');
  await expect(images).toHaveCount(2);
  await images.last().getByLabel(/^Texto alternativo/).fill('Mapa inicial');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });

  // El cuerpo HTML se ve en el lienzo con el visor enriquecido, no vacío ni como Markdown crudo.
  await closeEditor(page);
  const preview = page.getByTestId('rich-note-preview-tarjeta-1');
  await expect(preview).toContainText('Antes de la imagen.');
  await expect(card(page, 1)).not.toContainText('![');

  // Reemplazar conserva `contentDocument` con su estructura y el texto alternativo anterior: el cuerpo
  // sigue siendo HTML seguro, no se perdió ni se convirtió a Markdown al tocar las imágenes.
  await openFullCardEditor(page, card(page, 1));
  const replace = page.waitForEvent('filechooser');
  await images.first().getByRole('button', { name: /Reemplazar la imagen/ }).click();
  await (await replace).setFiles(png('plano-final.png'));
  await expect(images.first().getByLabel(/^Texto alternativo/)).toHaveValue('Plano general');
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(page.getByTestId('html-source-input')).toHaveValue(/<p>Antes de la imagen\.<\/p>/);
  await expect(page.getByTestId('html-source-input')).toHaveValue(/<img[^>]*alt="Plano general"/);
  await button(page, 'Editar el cuerpo visualmente').click();
  await button(page, 'Guardar texto').click();
  await closeEditor(page);
  await expect(page.getByTestId('rich-note-preview-tarjeta-1')).toContainText('Antes de la imagen.');
  await page.screenshot({ path: testInfo.outputPath('html-note-images.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('tabla en una nota HTML segura: insertar y editar celdas es un cambio de Lexical como cualquier otro, sin tocar `content`', async ({ page }, testInfo) => {
  // A diferencia de las imágenes (E/S asíncrona fuera de Lexical), insertar/editar una tabla es un
  // comando interno del editor (`INSERT_TABLE_COMMAND`) que ya pasa por el mismo `onChange` consciente
  // de `contentDocument`: se verifica aquí que de verdad no necesita el mismo arreglo que las imágenes.
  await page.goto('./');
  await createWorkspace(page, 'Tablas HTML');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await seedBodyHtml(page, '<p>Antes de la tabla.</p>');
  await button(page, 'Insertar una tabla').click();
  await button(page, 'Insertar tabla').click();
  const visual = page.getByLabel('Contenido visual');
  const cells = visual.locator('th, td');
  await expect(cells).toHaveCount(9);
  await cells.first().click();
  await page.keyboard.type('Nombre');
  await page.getByTestId('editor-table-menu-toggle').click();
  await page.getByTestId('editor-table-menu-align-center').click();
  await expect(cells.first()).toHaveCSS('vertical-align', 'middle');
  await page.getByTestId('editor-table-menu-toggle').click();
  await page.screenshot({ path: testInfo.outputPath('table-cell-vertical-center.png'), fullPage: true });
  await page.getByTestId('editor-table-menu-toggle').click();
  await button(page, 'Guardar texto').click();
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible({ timeout: 3_000 });
  await button(page, 'Editar el código HTML del cuerpo').click();
  await expect(page.getByTestId('html-source-input')).toHaveValue(/<p>Antes de la tabla\.<\/p>/);
  await expect(page.getByTestId('html-source-input')).toHaveValue(/<table>[\s\S]*Nombre[\s\S]*<\/table>/);
  await expect(page.getByTestId('html-source-input')).toHaveValue(/<th data-nouty-valign="center">Nombre<\/th>/);
  await button(page, 'Editar el cuerpo visualmente').click();
  await closeEditor(page);
  // El lector enriquecido del lienzo conserva la tabla y su alineación después de cerrar.
  await expect(card(page, 1)).toContainText('Antes de la tabla.');
  await expect(card(page, 1)).toContainText('Nombre');
  await expect(card(page, 1).locator('th').first()).toHaveCSS('vertical-align', 'middle');
  await expect(card(page, 1)).not.toContainText('| Nombre |');
});

test('UX7-TABLE-OVERLAY: el menú flota dentro del viewport y conserva la celda en Inspector y edición rápida', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Menú de tabla');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await button(page, 'Insertar una tabla').click();
  await button(page, 'Insertar tabla').click();

  const visual = page.getByLabel('Contenido visual');
  const bodyEditor = page.getByTestId('web-rich-text-editor').filter({ has: visual });
  const toolbar = bodyEditor.getByTestId('editor-toolbar');
  const firstCell = visual.locator('th, td').first();
  await firstCell.click();
  const toolbarHeight = (await box(toolbar)).height;
  await bodyEditor.getByTestId('editor-table-menu-toggle').click();
  const menu = page.getByTestId('editor-table-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Filas' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Columnas' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Estructura' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Alineación vertical' })).toBeVisible();
  await expect(menu).toHaveCSS('position', 'fixed');
  const menuBox = await box(menu);
  const viewport = page.viewportSize();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport?.height ?? 0);
  expect((await box(toolbar)).height).toBe(toolbarHeight);
  await expect(menu.getByTestId('editor-table-menu-row-above')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByTestId('editor-table-menu-row-below')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(bodyEditor.getByTestId('editor-table-menu-toggle')).toBeFocused();

  await bodyEditor.getByTestId('editor-table-menu-toggle').click();
  await page.getByTestId('editor-table-menu-align-center').click();
  await expect(firstCell).toHaveCSS('vertical-align', 'middle');
  await expect(menu).toHaveCount(0);
  await firstCell.click();
  await bodyEditor.getByTestId('editor-table-menu-toggle').click();
  await page.screenshot({ path: testInfo.outputPath('table-menu-inspector.png'), fullPage: true });
  await page.mouse.click(8, 8);
  await expect(menu).toHaveCount(0);

  if ((viewport?.width ?? 0) < 800) return;

  await closeEditor(page);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1));
  await button(page, 'Editar Nueva nota dentro de la ficha').click();
  const inline = page.getByTestId('inline-card-editor');
  await expect(inline).toBeVisible();
  const inlineVisual = inline.getByLabel('Contenido visual');
  await inlineVisual.locator('th, td').first().click();
  await inline.getByTestId('editor-table-menu-toggle').click();
  await expect(menu).toBeVisible();
  const inlineMenuBox = await box(menu);
  expect(inlineMenuBox.x + inlineMenuBox.width).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(inlineMenuBox.y + inlineMenuBox.height).toBeLessThanOrEqual(viewport?.height ?? 0);
  await page.screenshot({ path: testInfo.outputPath('table-menu-inline.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await inline.getByRole('button', { name: 'Guardar y cerrar la edición rápida' }).click();
});

test('P09: parte de 3 × 3, permite configurar la tabla y la conserva en Lista', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Tablas visuales');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  await button(page, 'Insertar una tabla').click();
  await expect(page.getByLabel('Filas')).toHaveValue('3');
  await expect(page.getByLabel('Columnas')).toHaveValue('3');
  await page.getByLabel('Filas').fill('1');
  await expect(button(page, 'Insertar tabla')).toBeDisabled();
  await page.getByLabel('Filas').fill('4');
  await page.getByLabel('Columnas').fill('2');
  await button(page, 'Insertar tabla').click();

  const visual = page.getByLabel('Contenido visual');
  const bodyEditor = page.getByTestId('web-rich-text-editor').filter({ has: visual });
  const cells = visual.locator('th, td');
  await expect(cells).toHaveCount(8);
  await bodyEditor.getByRole('button', { name: 'Deshacer en el editor', exact: true }).click();
  await expect(cells).toHaveCount(0);
  await bodyEditor.getByRole('button', { name: 'Rehacer en el editor', exact: true }).click();
  await expect(cells).toHaveCount(8);

  await cells.first().click();
  await page.keyboard.type('Nombre');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => {
    const cell = window.getSelection()?.anchorNode?.parentElement?.closest('th,td') as HTMLTableCellElement | null;
    return cell?.cellIndex ?? -1;
  })).toBe(1);
  await page.keyboard.type('Estado');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Idea');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Activa');

  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  await page.screenshot({ path: testInfo.outputPath('p09-rich-table.png'), fullPage: true });
  await closeEditor(page);

  await button(page, 'Vista de lista').click();
  const listTable = page.getByTestId('list-rich-text-tarjeta-1-table-0');
  await expect(listTable).toContainText('Nombre');
  await expect(listTable).toContainText('Activa');
  await expect(listTable).not.toContainText('| Nombre |');
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P18-C: una tabla configurable cambia filas, columnas y cabecera y conserva el documento', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Insertar coherente');

  const toolbar = page.getByTestId('workspace-toolbar');
  await expect(toolbar.getByRole('button', { name: 'Añadir nota', exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Añadir título flotante', exact: true })).toHaveCount(0);
  await button(page, 'Abrir menú Insertar').click();

  const menu = page.getByTestId('insert-dialog');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Insertar nota', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Insertar título flotante', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Importar una imagen', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Insertar enlace', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Insertar texto', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Insertar forma', exact: true })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Insertar conector', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('p10-insert-menu.png'), fullPage: true });
  await menu.getByRole('button', { name: 'Insertar tabla', exact: true }).first().click();
  const size = menu.getByTestId('insert-table-size');
  await size.getByLabel('Filas').fill('4');
  await size.getByLabel('Columnas').fill('2');
  await size.getByRole('button', { name: 'Insertar tabla', exact: true }).click();

  await expect(page.getByTestId('card-tarjeta-1')).toBeVisible();
  const visual = page.getByLabel('Contenido visual');
  await expect(visual.locator('th, td')).toHaveCount(8);
  await expect(visual.locator('th')).toHaveCount(2);
  await visual.locator('td').first().click();
  await button(page, 'Añadir fila al final').click();
  await expect(visual.locator('th, td')).toHaveCount(10);
  await visual.locator('td').first().click();
  await button(page, 'Quitar última columna').click();
  await expect(visual.locator('th, td')).toHaveCount(5);
  await visual.locator('td').first().click();
  await button(page, 'Alternar primera fila como cabecera').click();
  await expect(visual.locator('th')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Insertar' })).toHaveCount(0);
  await closeEditor(page);
  await openFullCardEditor(page, card(page, 1));
  await expect(page.getByLabel('Contenido visual').locator('th, td')).toHaveCount(5);
  await expect(page.getByLabel('Contenido visual').locator('th')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('p18-c-table-from-insert.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P18-C: texto y título flotantes usan una nota rica con zonas y marco independientes', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Contenido unificado');
  await insertFromMenu(page, 'Insertar texto');
  const floating = page.getByTestId('unified-content-tarjeta-1');
  await expect(floating).toContainText('Nuevo texto');
  await openFullCardEditor(page, card(page, 1));
  await expect(page.getByLabel('Título de la tarjeta')).toHaveCount(0);
  await page.getByLabel('Contenido visual').fill('Primera línea\nSegunda línea');
  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  await button(page, 'Mostrar u ocultar el título de la nota').click();
  const titleEditor = page.getByTestId('rich-title-editor');
  await expect(titleEditor).toBeVisible();
  await expect(titleEditor.getByRole('button', { name: 'Insertar tabla', exact: true })).toHaveCount(0);
  await expect(titleEditor.getByLabel('Tipo de bloque')).toHaveCount(0);
  await fillCardTitle(page, 'Título rico');
  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  await button(page, 'Mostrar u ocultar el cuerpo de la nota').click();
  await closeEditor(page);

  await expect(floating).toContainText('Título rico');
  await expect(floating).not.toContainText('Primera línea');
  expect(await borderWidth(card(page, 1))).toBe(0);

  await openFullCardEditor(page, card(page, 1));
  await expect(button(page, 'Mostrar u ocultar el título de la nota')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Mostrar u ocultar el cuerpo de la nota')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Título de la tarjeta')).toContainText('Título rico');
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('p18-c-unified-note.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P14: crea una forma, cambia su geometría y estilo portable', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Formas portables');
  await insertFromMenu(page, 'Insertar forma');

  const shapeCard = card(page, 1);
  const preview = page.getByTestId('shape-tarjeta-1');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('aria-label', 'Rectángulo');
  await openFullCardEditor(page, shapeCard);
  await expect(page.getByLabel('Título de la tarjeta')).toHaveCount(0);
  await expect(page.getByLabel('Contenido')).toHaveCount(0);

  const styles = page.getByTestId('shape-style-picker');
  await styles.getByRole('toolbar', { name: 'Tipo de forma' }).getByRole('button', { name: 'Redondeado', exact: true }).click();
  await styles.getByRole('toolbar', { name: 'Color de relleno' }).getByRole('button', { name: 'Naranja', exact: true }).click();
  await styles.getByRole('toolbar', { name: 'Color del borde' }).getByRole('button', { name: 'Azul', exact: true }).click();
  await styles.getByRole('toolbar', { name: 'Grosor del borde' }).getByRole('button', { name: 'Grueso', exact: true }).click();
  await expect(feedback(page)).toContainText('Apariencia actualizada');
  await closeEditor(page);

  await expect(preview).toHaveAttribute('aria-label', 'Rectángulo redondeado');
  await expect(preview).toHaveCSS('background-color', rgb('#f2c792'));
  await expect(preview).toHaveCSS('border-color', rgb('#2457a6'));
  await expect(preview).toHaveCSS('border-width', '6px');
  await expect(preview).toHaveCSS('border-radius', '18px');
  await page.screenshot({ path: testInfo.outputPath('p14-rounded-shape.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P15: crea y configura un conector decorativo sin convertirlo en relación', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Conectores decorativos');
  await addCards(page, ['nota']);
  await insertFromMenu(page, 'Insertar conector');
  await placeConnector(page);

  await expect(page.getByTestId('connector-tarjeta-2')).toBeVisible();
  await openConnectorEditor(page);
  await expect(page.getByLabel('Título de la tarjeta')).toHaveCount(0);
  await expect(page.getByLabel('Contenido')).toHaveCount(0);
  const styles = page.getByTestId('connector-style-picker');
  // «Dirección» (Ascendente/Descendente) es del modelo diagonal anterior a P18-D (`connector-legacy-editor`,
  // solo para conectores creados antes de la ruta ortogonal); uno nuevo, de dos clics, ya tiene una ruta
  // (`connector-route-editor`) y no tiene ese control. Color/grosor/trazo/puntas y anclaje sí son comunes.
  await styles.getByRole('toolbar', { name: 'Color del conector' }).getByRole('button', { name: 'Morado' }).click();
  await styles.getByRole('toolbar', { name: 'Grosor del conector' }).getByRole('button', { name: 'Grueso' }).click();
  await styles.getByRole('toolbar', { name: 'Trazo del conector' }).getByRole('button', { name: 'Discontinuo' }).click();
  await styles.getByRole('toolbar', { name: 'Puntas del conector' }).getByRole('button', { name: 'Doble' }).click();
  await styles.getByRole('button', { name: 'Anclar extremo inicial a Nueva nota' }).click();
  await closeEditor(page);

  await expect(page.getByTestId('connector-tarjeta-2')).toBeVisible();
  await expect(page.getByTestId('relation-line-relacion-1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('p15-decorative-connector.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P16: Lista representa texto flotante, forma y conector con su apariencia propia, no como nota Markdown', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Lista P16');
  await insertFromMenu(page, 'Insertar texto');
  await openFullCardEditor(page, card(page, 1));
  // Texto libre es hoy una presentación de Nota (ADR 0057/0060): su cuerpo HTML seguro v1 (`contentDocument`)
  // se edita con el mismo editor Visual que cualquier nota; «Texto flotante» era el campo de texto plano
  // del tipo histórico `text`, inalcanzable para una tarjeta nueva.
  await page.getByLabel('Contenido visual').fill('*no es viñeta* literal');
  await button(page, 'Guardar texto').click();
  await page.getByTestId('floating-text-style-picker').getByRole('button', { name: 'Azul', exact: true }).click();
  await closeEditor(page);

  await insertFromMenu(page, 'Insertar forma');
  await openFullCardEditor(page, card(page, 2));
  await page.getByTestId('shape-style-picker').getByRole('toolbar', { name: 'Color de relleno' }).getByRole('button', { name: 'Naranja', exact: true }).click();
  await closeEditor(page);

  await insertFromMenu(page, 'Insertar conector');
  await placeConnector(page);
  await openConnectorEditor(page);
  await page.getByTestId('connector-style-picker').getByRole('toolbar', { name: 'Color del conector' }).getByRole('button', { name: 'Morado' }).click();
  await closeEditor(page);

  await button(page, 'Vista de lista').click();

  // Antes de P16, el cuerpo de estas tres primitivas se interpretaba como Markdown de una nota: un
  // texto flotante literal con `*` podía mostrarse como viñeta o negrita, y forma/conector quedaban
  // en blanco (sin representar su estilo) o, el conector, con la etiqueta genérica de ficha sin título.
  const floating = page.getByTestId('list-floating-text-tarjeta-1');
  await expect(floating).toContainText('*no es viñeta* literal');
  await expect(floating).toHaveCSS('color', rgb('#2457a6'));

  const shape = page.getByTestId('list-shape-tarjeta-2');
  await expect(shape).toBeVisible();
  await expect(shape).toHaveCSS('background-color', rgb('#f2c792'));

  await expect(card(page, 3)).toHaveAttribute('aria-label', 'Tarjeta Conector');
  await expect(page.getByTestId('list-connector-tarjeta-3')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('p16-list-primitives.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await button(page, 'Vista de lista').click();
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P16: Presentación representa texto flotante, forma, conector y una nota con marcas sin Markdown crudo', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Presentación P16');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await seedBodyHtml(page, '<p>Texto con <strong>negrita</strong> normal.</p>');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  await insertFromMenu(page, 'Insertar texto');
  await openFullCardEditor(page, card(page, 2));
  // Texto libre es hoy una presentación de Nota (ADR 0057/0060): su cuerpo HTML seguro v1 (`contentDocument`)
  // se edita con el mismo editor Visual que cualquier nota; «Texto flotante» era el campo de texto plano
  // del tipo histórico `text`, inalcanzable para una tarjeta nueva.
  await page.getByLabel('Contenido visual').fill('*no es viñeta* literal');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  // Forma y conector quedan con su estilo por defecto: no hace falta abrir su editor para esta prueba.
  await insertFromMenu(page, 'Insertar forma');
  await insertFromMenu(page, 'Insertar conector');
  await placeConnector(page);

  await openPresent(page);
  await expect(page.getByTestId('present-count')).toHaveText('1 / 4');
  // Antes de P16, el cuerpo de la nota pasaba por `markdownExcerpt`, que no representa marcas: la
  // negrita se veía con sus asteriscos crudos en pantalla completa.
  await expect(page.getByTestId('present-note')).toBeVisible();
  await expect(page.getByTestId('present-view')).not.toContainText('**negrita**');
  await expect(page.getByTestId('present-body').getByText('negrita', { exact: true })).toHaveCSS('font-weight', '700');

  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-floating-text')).toContainText('*no es viñeta* literal');

  // Forma y conector van en orden de lectura real del tablero (`printableDocument`, por fila y
  // columna), no en el de creación: en una pantalla estrecha, el punto donde cae el toque que coloca
  // el conector puede quedar en una fila anterior a la de la forma autoposicionada, invirtiendo cuál
  // de las dos diapositivas sale primero (hallazgo real de esta sesión: causaba un fallo determinista,
  // no un flaky, solo en `mobile` — la prueba asumía un orden que el producto nunca prometió). Se
  // comprueban ambas diapositivas sin asumir cuál es cuál.
  await button(page, 'Diapositiva siguiente').click();
  if (await page.getByTestId('present-shape').count() > 0) {
    await expect(page.getByTestId('present-shape')).toBeVisible();
    await expect(page.getByTestId('present-shape-preview')).toHaveAttribute('aria-label', 'Rectángulo');
    await button(page, 'Diapositiva siguiente').click();
    await expect(page.getByTestId('present-connector')).toBeVisible();
    await expect(page.getByTestId('present-connector-preview')).toBeVisible();
  } else {
    // Antes de P16, esta diapositiva no distinguía un conector de una ficha sin título.
    await expect(page.getByTestId('present-connector')).toBeVisible();
    await expect(page.getByTestId('present-connector-preview')).toBeVisible();
    await button(page, 'Diapositiva siguiente').click();
    await expect(page.getByTestId('present-shape')).toBeVisible();
    await expect(page.getByTestId('present-shape-preview')).toHaveAttribute('aria-label', 'Rectángulo');
  }
  await expect(page.getByTestId('present-view')).not.toContainText('Sin título');

  await page.screenshot({ path: testInfo.outputPath('p16-present-primitives.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await button(page, 'Cerrar la presentación').click();
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P17: recorrido de integración — nota con marcas/lista/tabla, texto flotante, forma y conector coherentes en lienzo, Lista, Presentación, impresión, Visual/Markdown, tema oscuro, tablet y ciclo ZIP', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('firefox'), 'window.open tras un clic simulado no se abre en Firefox (activación de usuario); ver testing.md.');
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await button(page, 'Tema oscuro').click();
  await createWorkspace(page, 'Integración P17');

  // Nota con encabezado, negrita, lista y tabla (sin imagen: la combinación imagen+tabla en la misma
  // nota es un hallazgo real registrado aparte en progress.md, no bloqueante — ver P17).
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();
  await seedBodyHtml(page, '<h2>Plan</h2>\n<p>Texto con <strong>negrita</strong> y lista:</p>\n<ul><li>Uno</li><li>Dos</li></ul>\n'
    + '<table><thead><tr><th>Nombre</th><th>Estado</th></tr></thead><tbody><tr><td>Idea</td><td>Activa</td></tr></tbody></table>');
  const visual = page.getByLabel('Contenido visual');
  await expect(visual.locator('h2')).toHaveText('Plan');
  await expect(visual.locator('strong')).toHaveText('negrita');
  await expect(visual.locator('li')).toHaveText(['Uno', 'Dos']);
  await expect(visual.locator('th, td')).toHaveText(['Nombre', 'Estado', 'Idea', 'Activa']);
  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  // Encabezado + lista + tabla no caben en el tamaño inicial: se agranda solo en alto (ensanchar la
  // acerca al umbral que cambia la cabecera de «⋯» a botones individuales, ADR 0016) para que el
  // lienzo y Lista tengan presupuesto suficiente y no corten con «+n bloques más» antes de la tabla.
  for (let i = 0; i < 12; i += 1) await button(page, 'Más alta').click();
  await closeEditor(page);

  await insertFromMenu(page, 'Insertar texto');
  await openFullCardEditor(page, card(page, 2));
  // Texto libre es hoy una presentación de Nota (ADR 0057/0060): su cuerpo HTML seguro v1 (`contentDocument`)
  // se edita con el mismo editor Visual que cualquier nota; «Texto flotante» era el campo de texto plano
  // del tipo histórico `text`, inalcanzable para una tarjeta nueva.
  await page.getByLabel('Contenido visual').fill('*no es viñeta* literal');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  await insertFromMenu(page, 'Insertar forma');
  await insertFromMenu(page, 'Insertar conector');
  await placeConnector(page);

  // Lienzo: sin sintaxis cruda, las cuatro primitivas visibles.
  await expect(card(page, 1)).not.toContainText('##');
  await expect(card(page, 1)).not.toContainText('**');
  await expect(page.getByTestId('unified-content-tarjeta-2')).toContainText('*no es viñeta* literal');
  await expect(page.getByTestId('shape-tarjeta-3')).toBeVisible();
  // Un conector decorativo sin anclar no dibuja una ficha táctil propia en el lienzo (excluido a
  // propósito de `cardAt`, Canvas.tsx); su presencia se confirma con el propio trazo, no con `card-*`.
  await expect(page.getByTestId('connector-tarjeta-4')).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  // Lista: misma equivalencia (UX7 P16).
  await button(page, 'Vista de lista').click();
  const listRich = page.getByTestId('list-rich-text-tarjeta-1');
  await expect(listRich).not.toContainText('##');
  await expect(listRich).not.toContainText('| Nombre |');
  await expect(listRich).toContainText('Nombre');
  await expect(listRich).toContainText('Estado');
  await expect(listRich).toContainText('Idea');
  await expect(listRich).toContainText('Activa');
  await expect(page.getByTestId('list-floating-text-tarjeta-2')).toContainText('*no es viñeta* literal');
  await expect(page.getByTestId('list-shape-tarjeta-3')).toBeVisible();
  await expect(card(page, 4)).toHaveAttribute('aria-label', 'Tarjeta Conector');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await button(page, 'Vista de lista').click();

  // Tablet: ambas orientaciones, sin desbordamiento (móvil y escritorio ya cubiertos por los proyectos).
  await page.setViewportSize(tabletLandscape);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.setViewportSize(tabletPortrait);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.setViewportSize(testInfo.project.name === 'mobile' ? phone : desktop);

  // Presentación: una diapositiva propia por primitiva, sin «Sin título» ni Markdown crudo.
  await openPresent(page);
  await expect(page.getByTestId('present-count')).toHaveText('1 / 4');
  const presentBody = page.getByTestId('present-body');
  await expect(presentBody).not.toContainText('##');
  await expect(presentBody).not.toContainText('| Nombre |');
  await expect(presentBody).toContainText('Plan');
  await expect(page.getByTestId('present-body').getByText('negrita', { exact: true })).toHaveCSS('font-weight', '700');
  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-floating-text')).toContainText('*no es viñeta* literal');
  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-shape')).toBeVisible();
  await button(page, 'Diapositiva siguiente').click();
  await expect(page.getByTestId('present-connector')).toBeVisible();
  await expect(page.getByTestId('present-view')).not.toContainText('Sin título');
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await button(page, 'Cerrar la presentación').click();

  // Impresión: HTML real, tabla de verdad, sin sintaxis cruda ni duplicados.
  if (isCompact(page)) {
    await button(page, 'Más secciones').click();
    await expect(page.getByTestId('more-sheet')).toBeVisible();
  }
  const [tab] = await Promise.all([page.waitForEvent('popup'), button(page, 'Imprimir este tablero').click()]);
  await tab.waitForLoadState();
  await expect(tab.getByText('Plan')).toBeVisible();
  await expect(tab.locator('table td')).toHaveText(['Idea', 'Activa']);
  await expect(tab.locator('body')).not.toContainText('## Plan');
  await expect(tab.locator('body')).not.toContainText('| Nombre |');
  await tab.close();

  // Ciclo ZIP (web → … → web): exportar, perder la memoria al recargar y reimportar sin pérdidas.
  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const saved = await download;
  const exportedPath = testInfo.outputPath('integracion-p17.zip');
  await saved.saveAs(exportedPath);
  await button(page, `Confirmar que guardé ${saved.suggestedFilename()}`).click();

  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await chooser).setFiles({ name: 'integracion-p17.zip', mimeType: 'application/zip', buffer: readFileSync(exportedPath) });
  await expect(page.getByRole('heading', { name: 'Integración P17', exact: true })).toBeVisible();
  await expect(card(page, 1)).not.toContainText('##');
  await expect(card(page, 1)).not.toContainText('**');
  await expect(page.getByTestId('unified-content-tarjeta-2')).toContainText('*no es viñeta* literal');
  await expect(page.getByTestId('shape-tarjeta-3')).toBeVisible();
  await expect(page.getByTestId('connector-tarjeta-4')).toBeVisible();
  await openFullCardEditor(page, card(page, 1));
  await expect(page.getByLabel('Contenido visual').locator('th, td')).toHaveText(['Nombre', 'Estado', 'Idea', 'Activa']);
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('p17-integration-reopened.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);

  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P18-A: imagen y tabla se representan juntas sin Markdown crudo y con cabecera legible', async ({ page }, testInfo) => {
  await page.goto('./');
  await button(page, 'Tema oscuro').click();
  await createWorkspace(page, 'Previsualización mixta');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();
  await seedBodyHtml(page, '<figure><img src="assets/images/mapa.png" alt="Mapa"></figure>\n'
    + '<table><thead><tr><th>Nombre</th><th>Estado</th></tr></thead><tbody><tr><td>Idea</td><td>Activa</td></tr></tbody></table>');
  for (let i = 0; i < 5; i += 1) await button(page, 'Más alta').click();
  await closeEditor(page);

  const canvasPreview = page.getByTestId('rich-note-preview-tarjeta-1');
  await expect(canvasPreview).toContainText('Nombre');
  await expect(canvasPreview).toContainText('Activa');
  await expect(canvasPreview).not.toContainText('| Nombre |');
  await expect(page.getByTestId('rich-note-preview-tarjeta-1-block-1-table-0-header-0')).toHaveCSS('background-color', rgb(themeColors.dark.surfaceRaised));

  await button(page, 'Vista de lista').click();
  const listPreview = page.getByTestId('list-rich-note-preview-tarjeta-1');
  await expect(listPreview).toContainText('Nombre');
  await expect(listPreview).not.toContainText('| Nombre |');
  await expect(page.getByTestId('list-rich-note-preview-tarjeta-1-block-1-table-0-header-0')).toHaveCSS('background-color', rgb(themeColors.dark.surfaceRaised));
  await page.screenshot({ path: testInfo.outputPath('p18-a-rich-note-table.png'), fullPage: true });
});

test('P18-A: formas y conectores omiten la edición rápida y respetan el marco visible', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Primitivas gráficas');
  await insertFromMenu(page, 'Insertar forma');
  await card(page, 1).dblclick();
  await expect(page.getByTestId('inline-card-editor')).toHaveCount(0);
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await button(page, 'Mostrar siempre').click();
  const positionToggle = page.getByTestId('card-position-toggle');
  if (await positionToggle.count() > 0) await positionToggle.click();
  await button(page, 'Más baja').click();
  await button(page, 'Más baja').click();
  await closeEditor(page);
  await expect.poll(() => borderWidth(card(page, 1))).toBe(2);
  const shapeBox = await box(page.getByTestId('shape-tarjeta-1'));
  const cardBox = await box(card(page, 1));
  expect(shapeBox.y).toBeGreaterThanOrEqual(cardBox.y);
  // RN Web mide el contenido hasta el borde inferior inclusive; toleramos el borde de 2 px de la ficha.
  expect(shapeBox.y + shapeBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 3);

  // Un conector decorativo no dibuja una ficha táctil propia en el lienzo (excluido a propósito de
  // `cardAt`, Canvas.tsx, para no bloquear el toque de lo que tenga detrás): «doble clic abre el editor
  // completo directamente» se comprueba con doble clic sobre su tramo, como el resto de esta suite.
  await insertFromMenu(page, 'Insertar conector');
  await placeConnector(page);
  await openConnectorEditor(page);
  await expect(page.getByTestId('inline-card-editor')).toHaveCount(0);
  await button(page, 'Mostrar siempre').click();
  await expect(button(page, 'Mostrar siempre')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('p18-a-shape-connector.png'), fullPage: true });
});

test('P18-A: una nota con texto oculto lo anuncia en la ficha', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await createWorkspace(page, 'Texto largo');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();
  await seedBodyHtml(page, [
    '<h2>Inicio estructurado</h2>',
    ...Array.from({ length: 1_700 }, (_, index) => `<p>Línea ${index + 1}</p>`),
    '<ul><li>Elemento enriquecido uno</li><li><strong>Elemento enriquecido dos</strong></li></ul>',
    '<table><thead><tr><th>Tabla final</th></tr></thead><tbody><tr><td>No debe desplazar el inicio</td></tr></tbody></table>',
  ].join('\n'));
  const visual = page.getByLabel('Contenido visual');
  await expect(visual).toContainText('Línea 1');
  await expect(visual).toContainText('Línea 850');
  await expect(visual).toContainText('Línea 1700');
  await expect(visual.locator('table')).toContainText('No debe desplazar el inicio');
  await closeEditor(page);
  const reader = page.getByTestId('card-reader-tarjeta-1');
  await expect(reader).toBeVisible();
  await expect(reader).toContainText('Inicio estructurado');
  await expect(reader).toContainText('Línea 1');
  await expect(reader).not.toContainText('Tabla final');
  const cardBeforeWheel = await card(page, 1).boundingBox();
  await reader.hover();
  await page.mouse.wheel(0, 720);
  await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await card(page, 1).boundingBox()).toEqual(cardBeforeWheel);
  await reader.focus();
  await page.keyboard.press('End');
  await expect.poll(() => reader.evaluate((node) => Math.round(node.scrollTop + node.clientHeight))).toBeGreaterThan(1_000);
  await expect(page.getByTestId('card-reader-tarjeta-1-block-1700')).toContainText('Línea 1700');
  await page.getByTestId('card-reader-tarjeta-1-block-1700').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('card-reader-tarjeta-1-block-1700')).toBeInViewport();
  await reader.focus();
  await page.keyboard.press('End');
  await expect(reader.getByTestId(/-table-/).first()).toContainText('No debe desplazar el inicio');
  await expect(reader.getByTestId(/-table-/).first()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('long-document-canvas-end.png'), fullPage: true });
  await page.keyboard.press('Home');
  await expect(reader).toContainText('Línea 1');
  await page.screenshot({ path: testInfo.outputPath('long-document-canvas.png'), fullPage: true });

  await openFullCardEditor(page, card(page, 1));
  const reopened = page.getByLabel('Contenido visual');
  await expect(reopened).toContainText('Línea 1');
  await expect(reopened).toContainText('Línea 850');
  await expect(reopened).toContainText('Línea 1700');
  await expect(reopened.locator('table')).toContainText('Tabla final');
  await reopened.focus();
  await page.keyboard.press('Control+End');
  const typingStarted = Date.now();
  await page.keyboard.insertText(' MARCADOR_FINAL');
  await expect(reopened).toContainText('MARCADOR_FINAL');
  console.info(`[PERF-LONG-DOC] escritura visible en ${Date.now() - typingStarted} ms`);
  await page.getByRole('button', { name: 'Guardar texto', exact: true }).click();
  await closeEditor(page);
  await openFullCardEditor(page, card(page, 1));
  await expect(page.getByLabel('Contenido visual')).toContainText('MARCADOR_FINAL');
  await page.screenshot({ path: testInfo.outputPath('long-document-editor.png'), fullPage: true });
});

test('P18-B: Insertar y la barra agrupan las herramientas sin ofrecer una imagen de ejemplo', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Herramientas ordenadas');

  await expect(page.getByTestId('toolbar-group-work')).toHaveAttribute('aria-label', 'Trabajar');
  await expect(page.getByTestId('toolbar-group-create')).toHaveAttribute('aria-label', 'Crear');
  if (isCompact(page)) {
    await expect(page.getByTestId('toolbar-group-history')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-group-view')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('toolbar-group-history')).toHaveAttribute('aria-label', 'Historial');
    await expect(page.getByTestId('toolbar-group-view')).toHaveAttribute('aria-label', 'Vista y salida');
  }

  await button(page, 'Abrir menú Insertar').click();
  const insert = page.getByTestId('insert-dialog');
  await expect(insert.getByTestId('insert-group-content')).toContainText('CONTENIDO');
  await expect(insert.getByTestId('insert-group-diagram')).toContainText('DIAGRAMA');
  await expect(insert.getByRole('button', { name: 'Importar una imagen', exact: true })).toBeVisible();
  await expect(insert.getByRole('button', { name: 'Añadir imagen de ejemplo', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('p18-b-tools.png'), fullPage: true });
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('P18-B: el selector de iconos muestra glifos con nombre accesible y selección', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Iconos visuales');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));

  const picker = page.getByTestId('card-icon-picker');
  const star = page.getByTestId('card-icon-option-star');
  await expect(star).toHaveAttribute('aria-label', 'Usar icono Estrella');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(picker.getByText('Estrella', { exact: true })).toHaveCount(0);
  await star.focus();
  await page.keyboard.press('Enter');
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selected-card-icon')).toHaveText('Seleccionado: Estrella');
  await page.screenshot({ path: testInfo.outputPath('p18-b-icons.png'), fullPage: true });
});

test('P18-B: Supr envía una selección simple o múltiple a la Papelera y respeta los campos de texto', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Atajo Supr');
  await addCards(page, ['nota', 'nota', 'nota']);

  await selectCard(page, 1);
  await card(page, 1).focus();
  await page.keyboard.press('Delete');
  await expect(card(page, 1)).toHaveCount(0);
  await expect(feedback(page)).toContainText('Tarjeta enviada a la Papelera');

  await openFullCardEditor(page, card(page, 2));
  await page.getByLabel('Título de la tarjeta').focus();
  await page.keyboard.press('Delete');
  await expect(card(page, 2)).toBeAttached();
  await fillCardTitle(page, 'Nueva nota');
  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  await closeEditor(page);

  await enterMultiWithOne(page, 2, 'Nueva nota');
  await card(page, 3).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('multi-count')).toHaveText('2 SELECCIONADAS');
  await page.keyboard.press('Delete');
  await expect(card(page, 2)).toHaveCount(0);
  await expect(card(page, 3)).toHaveCount(0);
  await expect(feedback(page)).toContainText('2 tarjetas enviadas a la Papelera');
});

test('P11: pega contenido enriquecido compatible y descarta contenido activo', async ({ page }, testInfo) => {
  const { runtimeErrors, failedResources } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Pegado seguro');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  const visual = page.getByLabel('Contenido visual');
  await visual.fill('');
  await visual.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Plan seguro Uno Dos Sitio JavaScript visible Nombre Estado Idea Activa');
    clipboard.setData('text/html', [
      '<h2 onclick="alert(1)" style="background:url(https://tracker.invalid/a)">Plan <strong>seguro</strong><script>window.__pwned=true</script></h2>',
      '<ul><li>Uno</li><li><em>Dos</em></li></ul>',
      '<p><a href="https://example.com">Sitio</a> <a href="javascript:alert(2)">JavaScript visible</a></p>',
      '<section><mark>Contenido desconocido visible</mark><iframe src="https://tracker.invalid/frame">oculto</iframe></section>',
      '<table><thead><tr><th>Nombre</th><th>Estado</th></tr></thead><tbody><tr><td>Idea</td><td>Activa</td></tr></tbody></table>',
    ].join(''));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });

  await expect(visual.locator('h2 strong')).toHaveText('seguro');
  await expect(visual.locator('ul li')).toHaveText(['Uno', 'Dos']);
  await expect(visual.locator('a[href="https://example.com"]')).toHaveText('Sitio');
  await expect(visual.getByText('JavaScript visible')).toBeVisible();
  await expect(visual.getByText('Contenido desconocido visible')).toBeVisible();
  await expect(visual.locator('table th, table td')).toHaveText(['Nombre', 'Estado', 'Idea', 'Activa']);
  await expect(visual.locator('script,style,iframe,object,embed')).toHaveCount(0);
  await expect(visual.locator('[onclick],[style],a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __pwned?: boolean }).__pwned)).toBeUndefined();
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('p11-safe-paste.png'), fullPage: true });

  await expect(feedback(page)).toContainText('Texto guardado', { timeout: 3_000 });
  // La comprobación de los bytes Markdown exactos ya no es alcanzable desde aquí (vista retirada en
  // web, P18-E3-B2); la propiedad de seguridad que de verdad importa (nada peligroso ejecuta ni queda
  // en el DOM) ya quedó probada arriba sobre el documento visual renderizado.
  expect(runtimeErrors).toEqual([]);
  expect(failedResources).toEqual([]);
});

test('P18-E3-B3-D: pegar un checklist reconocible conserva su estado marcado/sin marcar', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Pegado de checklist');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  const expandEditor = button(page, 'Ampliar el editor');
  if (await expandEditor.count() > 0) await expandEditor.click();

  const visual = page.getByLabel('Contenido visual');
  await visual.fill('');
  await visual.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Comprada Pendiente');
    // Patrón genérico externo (GitHub/Word/Google Docs al copiar una lista de tareas): un <input
    // type="checkbox"> real dentro de cada <li>, sin ningún atributo propio de NoutyNotes.
    clipboard.setData('text/html', '<ul><li><input type="checkbox" checked> Comprada</li><li><input type="checkbox"> Pendiente</li></ul>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });

  const items = visual.locator('li[role="checkbox"]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(items.nth(0)).toContainText('Comprada');
  await expect(items.nth(1)).toHaveAttribute('aria-checked', 'false');
  await expect(items.nth(1)).toContainText('Pendiente');

  // Pegar el propio formato canónico de NoutyNotes (copiar un checklist entre tarjetas) tampoco debe
  // degradarlo a una lista simple sin estado.
  await visual.fill('');
  await visual.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Lista A Lista B');
    clipboard.setData('text/html', '<ul data-nouty-list="checklist"><li data-nouty-checked="true">Lista A</li><li data-nouty-checked="false">Lista B</li></ul>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(items.nth(1)).toHaveAttribute('aria-checked', 'false');
});

test('edición rápida visual: crea y continúa una lista sin exponer Markdown', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'En móvil la edición usa la pantalla enfocada completa.');
  await page.goto('./');
  await createWorkspace(page, 'Listas en ficha');
  await addCards(page, ['nota']);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();
  const content = page.getByLabel('Contenido visual');
  await expect(button(page, 'Editar como Markdown')).toHaveCount(0);
  await content.fill('Harina');
  await content.focus();
  await button(page, 'Lista con viñetas').click();
  await expect(content.locator('ul li')).toHaveText(['Harina']);
  await content.press('End');
  await content.press('Enter');
  await page.keyboard.type('Agua');
  await expect(content.locator('ul li')).toHaveText(['Harina', 'Agua']);
  await expect(page.getByText('Este contenido se edita desde Más opciones.')).toHaveCount(0);
});

test('edición rápida visual: negrita y cursiva funcionan sin exponer Markdown', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 800, 'En móvil la edición usa la pantalla enfocada completa.');
  await page.goto('./');
  await createWorkspace(page, 'Formato en ficha');
  await addCards(page, ['nota']);
  await selectCard(page, 1);
  await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Editar Nueva nota dentro de la ficha').click();
  const content = page.getByLabel('Contenido visual');
  await content.fill('');
  await button(page, 'Negrita').click();
  await page.keyboard.type('fuerte ');
  await button(page, 'Negrita').click();
  await button(page, 'Cursiva').click();
  await page.keyboard.type('cursiva');
  await button(page, 'Cursiva').click();
  await expect(content.locator('strong')).toHaveText('fuerte ');
  await expect(content.locator('em')).toHaveText('cursiva');
});

test('checklist en el lienzo: un toque marca la línea sin abrir el editor ni arrastrar la ficha, y persiste al reabrir el espacio (UX7-B2)', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Checklist en ficha');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  // Más alta: con la densidad de UX7-D1 (fila más baja) el tamaño inicial ya no deja sitio para dos
  // líneas de checklist a la vez, y esta prueba necesita las dos (toca una y confirma que la otra no
  // cambia).
  await button(page, 'Más alta').click();
  await button(page, 'Más alta').click();
  await seedBodyHtml(page, '<ul data-nouty-list="checklist"><li data-nouty-checked="false">Harina</li><li data-nouty-checked="false">Agua</li></ul>');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await closeEditor(page);

  const first = page.getByTestId('check-tarjeta-1-0');
  const second = page.getByTestId('check-tarjeta-1-1');
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await expect(second).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: testInfo.outputPath('checklist-unchecked.png') });

  // La selección de la ficha (heredada de `tapCard` al editarla) no debe cambiar con el toque: se
  // captura antes para comparar, en vez de asumir un valor fijo.
  const selectedBefore = await card(page, 1).getAttribute('aria-pressed');
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
  // El toque marcó la línea sin abrir ningún editor ni arrastrar/cambiar la selección de la ficha
  // entera, y sin activar la otra casilla (interacción exigida por UX7-B2).
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expect(page.getByTestId('inline-card-editor')).toHaveCount(0);
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', selectedBefore ?? '');
  await expect(second).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: testInfo.outputPath('checklist-checked.png') });

  // El estado sobrevive a cerrar y reabrir el espacio: no es un cambio solo visual del lienzo. Este
  // espacio solo vive en memoria (sin ZIP exportado), así que la prueba usa el mismo camino que ya
  // cubre la persistencia del resto de la edición (volver a la lista y reabrir), no una recarga dura.
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Abrir Checklist en ficha').click();
  await expect(page.getByTestId('check-tarjeta-1-0')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('check-tarjeta-1-1')).toHaveAttribute('aria-checked', 'false');
});

test('checklist en el lienzo sobrevive a exportar ZIP, recargar y reimportar (cierre pendiente de UX7-B2)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Checklist ZIP');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  // Más alta: con la densidad de UX7-D1 (fila más baja) el tamaño inicial no deja sitio para dos
  // líneas de checklist a la vez, y esta prueba necesita las dos (misma razón que la de UX7-B2).
  await button(page, 'Más alta').click();
  await button(page, 'Más alta').click();
  await seedBodyHtml(page, '<ul data-nouty-list="checklist"><li data-nouty-checked="false">Harina</li><li data-nouty-checked="false">Agua</li></ul>');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await closeEditor(page);

  const first = page.getByTestId('check-tarjeta-1-0');
  await expect(first).toBeVisible();
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('check-tarjeta-1-1')).toHaveAttribute('aria-checked', 'false');

  const download = page.waitForEvent('download');
  await button(page, 'Exportar este espacio como ZIP').click();
  const saved = await download;
  const exportedPath = testInfo.outputPath('checklist-exportado.zip');
  await saved.saveAs(exportedPath);
  await button(page, `Confirmar que guardé ${saved.suggestedFilename()}`).click();
  await expect(page.getByTestId('export-status')).toHaveText('SIN CAMBIOS PENDIENTES DE EXPORTAR');

  // Otra sesión: recargar pierde la memoria; reimportar el ZIP exportado debe traer la casilla marcada.
  await page.reload();
  await button(page, 'Volver a mis espacios').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Importar un ZIP').click();
  await (await chooser).setFiles({ name: 'checklist-exportado.zip', mimeType: 'application/zip', buffer: readFileSync(exportedPath) });
  await expect(page.getByRole('heading', { name: 'Checklist ZIP', exact: true })).toBeVisible();
  await expect(page.getByTestId('check-tarjeta-1-0')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('check-tarjeta-1-1')).toHaveAttribute('aria-checked', 'false');
});

test('posición de la leyenda de imagen: debajo, arriba, izquierda y derecha, igual en el lienzo y en Lista, sin desbordamiento (ADR 0051)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Leyendas');
  await addCards(page, ['nota']);
  await tapCard(page, 1);
  // Más alta: a la densidad por defecto (UX7-D1) el presupuesto vertical de la ficha no deja sitio
  // para la leyenda sin encogerla por debajo del mínimo, y UX7-C4 la omite antes que recortar la
  // imagen — hace falta más alto para que esta prueba vea la leyenda en vez de omitirla.
  await button(page, 'Más alta').click();
  await button(page, 'Más alta').click();
  // Sin asset real: la imagen cae al marcador «no disponible», pero la leyenda se dibuja igual (no
  // depende de que la imagen se resuelva, UX7-C4).
  await seedBodyHtml(page, '<figure><img src="assets/images/x.png" alt="Vista del lago"></figure>');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText('Texto guardado. Guardado en memoria.');
  await closeEditor(page);

  // Nota HTML con imagen (ADR 0066): se previsualiza con RichNotePreview, no con NotePreview.
  const image = page.getByTestId('rich-note-preview-tarjeta-1').locator('[aria-label*="Imagen no disponible"]');
  const caption = page.getByTestId('rich-note-preview-tarjeta-1').getByText('Vista del lago', { exact: true });
  await expect(image).toBeVisible();
  await expect(caption).toBeVisible();

  // Por defecto, debajo (UX7-C4): la leyenda queda más abajo que la imagen.
  const belowDefault = await box(image);
  const captionDefault = await box(caption);
  expect(captionDefault.y).toBeGreaterThan(belowDefault.y);

  const setPosition = async (label: string) => {
    await openCardEditor(page, 1);
    await button(page, label).click();
    await expect(button(page, label)).toHaveAttribute('aria-pressed', 'true');
    await closeEditor(page);
  };

  await setPosition('Leyenda arriba de la imagen');
  expect((await box(caption)).y).toBeLessThan((await box(image)).y);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  await setPosition('Leyenda a la izquierda de la imagen');
  expect((await box(caption)).x).toBeLessThan((await box(image)).x);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  await setPosition('Leyenda a la derecha de la imagen');
  expect((await box(caption)).x).toBeGreaterThan((await box(image)).x);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  // Lista representa la misma posición elegida, no una disposición distinta por superficie.
  await button(page, 'Vista de lista').click();
  const listImage = page.getByTestId('list-rich-note-preview-tarjeta-1').locator('[aria-label*="Imagen no disponible"]');
  const listCaption = page.getByTestId('list-rich-note-preview-tarjeta-1').getByText('Vista del lago', { exact: true });
  expect((await box(listCaption)).x).toBeGreaterThan((await box(listImage)).x);
  await button(page, 'Vista de lista').click();

  await setPosition('Leyenda debajo de la imagen');
  expect((await box(caption)).y).toBeGreaterThan((await box(image)).y);
});

/** Entra en selección múltiple con una sola ficha (por su título, que debe ser único en ese momento). */
async function enterMultiWithOne(page: Page, id: number, title: string) {
  await selectCard(page, id);
  if (isCompact(page)) {
    await page.getByTestId(`card-actions-tarjeta-${id}`).focus();
    await page.keyboard.press('Enter');
  } else {
    await card(page, id).focus();
    await page.keyboard.press('Shift+F10');
  }
  await button(page, `Seleccionar ${title} junto con otras tarjetas`).click();
  await expect(page.getByTestId('multi-count')).toHaveText('1 SELECCIONADA');
}

test('portapapeles: copiar y pegar conserva la relación interna (no la externa), con IDs nuevos y un solo paso de deshacer (ADR 0052)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Portapapeles');
  await addCards(page, ['nota', 'nota', 'nota']);
  const rename = async (id: number, title: string) => {
    await openCardEditor(page, id);
    await fillCardTitle(page, title);
    await button(page, 'Guardar texto').click();
    await closeEditor(page);
  };
  await rename(1, 'A');
  await rename(2, 'B');
  await rename(3, 'C');

  // Relación interna a la selección (A→B) y externa (B→C, C queda fuera de lo copiado).
  await openCardActions(page, card(page, 1), 'A');
  await button(page, 'Conectar desde A').click();
  await card(page, 2).focus();
  await page.keyboard.press('Space');
  await button(page, 'Herramienta Seleccionar').click();
  await openCardActions(page, card(page, 2), 'B');
  await button(page, 'Conectar desde B').click();
  await card(page, 3).focus();
  await page.keyboard.press('Space');
  await button(page, 'Herramienta Seleccionar').click();
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(2);

  // Selección múltiple: A y B.
  await enterMultiWithOne(page, 1, 'A');
  await card(page, 2).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('multi-count')).toHaveText('2 SELECCIONADAS');

  await button(page, 'Copiar las 2 seleccionadas').click();
  // Copiar no escribe nada: ningún sufijo «Guardado en…» en el aviso.
  await expect(feedback(page)).toHaveText('2 tarjetas copiadas');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);

  await button(page, 'Pegar').click();
  await expect(feedback(page)).toHaveText('2 tarjetas pegadas. Guardado en memoria.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(5);
  await expect(card(page, 4)).toContainText('A');
  await expect(card(page, 5)).toContainText('B');
  // La interna (A→B) se copió hacia la pegada; la externa (B→C) no se repitió: 2 originales + 1 nueva.
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(3);

  // Un solo paso de deshacer para las dos fichas pegadas y su relación.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(3);
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="relation-line-"]')).toHaveCount(3);
});

test('portapapeles: duplicar en un solo paso; cortar envía a la Papelera de inmediato y pegar crea una ficha nueva; sobrevive a reabrir (ADR 0052)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Duplicar y cortar');
  await addCards(page, ['nota']);
  await openCardEditor(page, 1);
  await fillCardTitle(page, 'Original');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  await enterMultiWithOne(page, 1, 'Original');
  await button(page, 'Duplicar la seleccionada').click();
  await expect(feedback(page)).toHaveText('Tarjeta duplicada. Guardado en memoria.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(2);
  await expect(card(page, 2)).toContainText('Original');
  // Duplicar sale de la selección múltiple al terminar (mismo criterio que archivar/Papelera).
  await expect(page.getByTestId('multi-bar')).toHaveCount(0);

  // Título único antes de volver a entrar en selección múltiple (la duplicada también se llama «Original»).
  await openCardEditor(page, 1);
  await fillCardTitle(page, 'Para cortar');
  await button(page, 'Guardar texto').click();
  await closeEditor(page);

  // Cortar: la original va a la Papelera de inmediato; si nunca se pega, no se pierde nada.
  await enterMultiWithOne(page, 1, 'Para cortar');
  await button(page, 'Cortar la seleccionada').click();
  await expect(feedback(page)).toHaveText('Tarjeta cortada: queda en la Papelera hasta que la pegues. Guardado en memoria.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Abrir la Papelera/ })).toBeVisible();

  // Pegar trae una ficha nueva (ID nuevo), aunque la cortada siga en la Papelera.
  await button(page, 'Pegar').click();
  await expect(feedback(page)).toHaveText('Tarjeta pegada. Guardado en memoria.');
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(2);
  await expect(page.getByTestId('card-tarjeta-1')).toHaveCount(0);
  await expect(page.locator('[data-testid^="card-tarjeta-"]').last()).toContainText('Para cortar');

  // Sobrevive a reabrir el espacio (memoria, igual que el resto de UX7).
  await button(page, 'Volver a mis espacios').click();
  await button(page, 'Abrir Duplicar y cortar').click();
  await expect(page.locator('[data-testid^="card-tarjeta-"]')).toHaveCount(2);
});

test('arrastrar con ratón: vista previa con imán, colisión y límites visibles, Escape cancela y soltar guarda', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Arrastre');
  await sideBySide(page);
  const cell = cellSize(page);

  // P18-E1: la relación consume la misma caja provisional que la tarjeta y vuelve a su sitio al
  // cancelar. Antes se calculaba con el layout persistido y quedaba inmóvil durante el gesto.
  if (isCompact(page)) await page.getByTestId('card-actions-tarjeta-1').click();
  else await openCardActions(page, card(page, 1), 'Nueva nota');
  await button(page, 'Conectar desde Nueva nota').click();
  await tapCard(page, 2, false);
  await button(page, 'Herramienta Seleccionar').click();
  const relation = page.getByTestId('relation-line-relacion-1');
  const relationBefore = await box(relation);
  await mouseDrag(page, card(page, 1), 0, 4 * cell.y, { release: false });
  await expect.poll(async () => Math.round((await box(relation)).y)).not.toBe(Math.round(relationBefore.y));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(relation)).y)).toBe(Math.round(relationBefore.y));

  // Vista previa válida y cancelación con Escape: no se guarda nada (el aviso no cambia).
  const lastFeedback = await feedback(page).innerText();
  await mouseDrag(page, card(page, 1), 0, 4 * cell.y, { release: false });
  await expect(page.getByTestId('drag-target')).toHaveAttribute('aria-label', 'Destino válido');
  await expect(page.getByTestId('drag-status')).toHaveText('Soltar en columna 1, fila 5. Escape cancela.');
  await page.screenshot({ path: testInfo.outputPath('drag-valid.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drag-status')).toHaveCount(0);
  await page.mouse.up();
  await expect(feedback(page)).toHaveText(lastFeedback);
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Colisión visible antes de soltar: destino y tarjeta afectada en rojo; al soltar, no cambia nada.
  await mouseDrag(page, card(page, 1), 2 * cell.x, 0, { release: false });
  await expect(page.getByTestId('drag-target')).toHaveAttribute('aria-label', 'Destino no válido');
  await expect(page.getByTestId('drag-status')).toHaveText('Ahí se solaparía con otra tarjeta: «Nueva nota».');
  await expect.poll(() => borderColor(card(page, 2))).toBe(rgb(themeColors.light.danger));
  await page.screenshot({ path: testInfo.outputPath('drag-collision.png') });
  await page.mouse.up();
  await expect(feedback(page)).toHaveText('No se guardó el cambio. Ahí se solaparía con otra tarjeta: «Nueva nota».');
  await expect(feedback(page)).toHaveAttribute('role', 'alert');
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Hacia arriba del origen ahora es un destino válido del mundo; Escape cancela sin guardar.
  // Dos filas: el puntero no sale de la ventana (Firefox bajo Playwright lo fija en el borde).
  await mouseDrag(page, card(page, 1), 0, -2 * cell.y, { release: false });
  await expect(page.getByTestId('drag-status')).toHaveText('Soltar en X 0, Y -2. Escape cancela.');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Sin ajuste, soltar conserva cuartos de celda; deshacer recupera el origen. Con ajuste, la
  // vista previa salta a la celda completa. Así la subgrilla visible representa posiciones reales.
  await setSwitch(page, 'Ajustar a celdas', false);
  const before = await box(card(page, 1));
  await mouseDrag(page, card(page, 1), 0, Math.round(1.3 * cell.y));
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 2.25 · 4 × 3');
  await closeEditor(page);
  await page.keyboard.press('Control+z');
  await resetView(page);
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);
  await setSwitch(page, 'Ajustar a celdas', true);
  await mouseDrag(page, card(page, 1), 0, Math.round(1.3 * cell.y), { release: false });
  await expect.poll(async () => Math.round((await box(card(page, 1))).y - before.y)).toBe(cell.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Soltar en un destino válido guarda con el caso de uso.
  await mouseDrag(page, card(page, 1), 0, 4 * cell.y);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 5 · 4 × 3');
  await closeEditor(page);
  await card(page, 1).click();

  // Asas: la esquina cambia ancho y alto; el mundo admite pasar de 12 columnas. Soltar no
  // selecciona otra vez ni abre nada: la tarjeta sigue seleccionada.
  await revealCanvas(page);
  // `cell` se capturó al zoom inicial de 100 % (UX7-D1): cada cambio posterior de zoom escala el
  // arrastre en píxeles por `nuevoZoom / 1`, el nuevo zoom a secas.
  const compact = (page.viewportSize()?.width ?? 0) < at.width;
  // En móvil la esquina queda bajo el borde visible: se aleja la vista un paso (a 50 %, el siguiente
  // paso por debajo de 100 %) como haría el usuario.
  const scale = compact ? 0.5 : 1;
  if (compact) await zoomBy(page, 'out');
  await mouseDrag(page, page.getByTestId('resize-se-tarjeta-1'), cell.x * scale, cell.y * scale, { header: false });
  await expect(feedback(page)).toHaveText('Tamaño cambiado. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 5 · 5 × 4');
  await closeEditor(page);
  await card(page, 1).click();
  // Ancho 5 + 8 = 13 > 12 columnas. Al 50 % el puntero no sale de la ventana (Firefox no informa bien fuera de ella).
  await zoomBy(page, 'out', 3);
  await expectZoom(page, '50 %');
  await mouseDrag(page, page.getByTestId('resize-e-tarjeta-1'), 8 * cell.x * 0.5, 0, { header: false, release: false });
  await expect(page.getByTestId('drag-status')).toHaveText('Nuevo tamaño: 13 × 4. Escape cancela.');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectGeometry(page, 1, 'Columna 1, fila 5 · 5 × 4');
  await page.screenshot({ path: testInfo.outputPath('drag-resized.png') });
});

test('icono propio y acceso rápido: se crea una ficha de tablero, cambia de icono y abre su destino', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'Atajos');
  const createBoard = async () => {
    if (isCompact(page)) await button(page, 'Abrir un tablero').click();
    await button(page, 'Crear un tablero').click();
  };
  const chooseBoard = async (title: string) => {
    await button(page, `Tablero ${title}`).click();
  };
  await createBoard();
  await createBoard();
  await chooseBoard('Tablero 1');

  // UX7-A3: «Tablero» salió de la barra principal; el acceso rápido vive en la franja derecha
  // (escritorio) o dentro de «Abrir un tablero» donde no hay franja (móvil/anchos intermedios).
  if (isCompact(page)) await button(page, 'Abrir un tablero').click();
  await button(page, 'Crear acceso rápido a un tablero').click();
  await expect(page.getByTestId('board-shortcut-dialog')).toBeVisible();
  await button(page, 'Crear acceso a Tablero 2').click();
  await expect(feedback(page)).toHaveText('Acceso a tablero creado. Guardado en memoria.');
  await expect(card(page, 1)).toContainText('Tablero 2');

  await openCardEditor(page, 1);
  await button(page, 'Usar icono Estrella').click();
  await expect(button(page, 'Usar icono Estrella')).toHaveAttribute('aria-pressed', 'true');
  // UX7-D5: el catálogo se amplió más allá de los 6 iconos originales.
  await button(page, 'Usar icono Texto').click();
  await expect(button(page, 'Usar icono Texto')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selected-card-icon')).toHaveText('Seleccionado: Texto');
  await button(page, 'Usar icono Estrella').click();
  if (isCompact(page)) {
    await button(page, 'Mostrar minimizada').click();
    await closeEditor(page);
  } else {
    // Minimizar vive solo en el menú contextual en escritorio (ADR 0048).
    await closeEditor(page);
    await openCardActions(page, card(page, 1), 'Tablero 2');
    await button(page, 'Minimizar Tablero 2').click();
  }
  await expect(page.getByTestId('minimized-icon-tarjeta-1')).toBeVisible();

  await card(page, 1).dblclick();
  await expect(button(page, 'Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
});

test('táctil: arrastrar una tarjeta y redimensionar con el dedo', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || !testInfo.project.use.hasTouch, 'Eventos touch reales solo en el perfil móvil de Chromium.');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Dedo');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): nace seleccionada,
  // sin editor que cerrar.
  await addCards(page, ['nota']);
  const cell = cellSize(page);
  await touchDrag(page, card(page, 1), cell.x, 2 * cell.y);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 2, fila 3 · 4 × 3');
  // En el móvil el editor se oculta para dejar el lienzo (y las asas) a la vista, sin perder la selección.
  await revealCanvas(page);
  await expect(page.getByLabel('Título de la tarjeta')).toBeHidden();
  await touchDrag(page, page.getByTestId('resize-s-tarjeta-1'), 0, cell.y, false);
  await expect(feedback(page)).toHaveText('Tamaño cambiado. Guardado en memoria.');
  await button(page, 'Mostrar el editor de la tarjeta').click();
  await expect(geometry(page)).toHaveText('Columna 2, fila 3 · 4 × 4');
  // Un toque corto selecciona, no arrastra (seleccionar ya no abre el editor por sí solo, auditoría
  // de interacción, 2026-09-29).
  await closeEditor(page);
  await page.getByTestId('card-tarjeta-1').tap();
  await expect(page.getByTestId('card-tarjeta-1')).toHaveAttribute('aria-pressed', 'true');
  await openCardEditor(page, 1);
  await expect(geometry(page)).toHaveText('Columna 2, fila 3 · 4 × 4');
});

test('herramientas: mano, zoom con porcentaje, grilla y vista de lista', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Vista');
  await sideBySide(page);
  const cell = cellSize(page);

  // Mano: desplaza el lienzo; las tarjetas no se mueven ni se seleccionan. En escritorio la barra ya no
  // muestra Mano (ADR 0048): el botón central del ratón pana desde cualquier punto sin activar ninguna
  // herramienta, seleccionar ni mover una ficha.
  const start = await box(card(page, 1));
  if (isCompact(page)) {
    await button(page, 'Herramienta Mano').click();
    await mouseDrag(page, page.getByTestId('board-canvas'), -40, -30, { header: false });
    await expect.poll(async () => Math.round((await box(card(page, 1))).x - start.x)).toBe(-40);
    await card(page, 1).click();
    await expect(page.getByTestId('card-inspector')).toHaveCount(0);
    await button(page, 'Herramienta Seleccionar').click();
  } else {
    await expect(button(page, 'Herramienta Mano')).toHaveCount(0);
    await middleDrag(page, page.getByTestId('board-canvas'), -40, -30);
    await expect.poll(async () => Math.round((await box(card(page, 1))).x - start.x)).toBe(-40);
    await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('card-inspector')).toHaveCount(0);
    await expect(button(page, 'Herramienta Seleccionar')).toHaveAttribute('aria-pressed', 'true');
  }
  await expectGeometry(page, 1, 'Columna 1, fila 1 · 4 × 3');
  await closeEditor(page);

  // Zoom por pasos con lectura del porcentaje; restablecer vuelve a 100 % y al origen.
  await expectZoom(page, '100 %');
  const widthStart = (await box(card(page, 1))).width;
  await zoomBy(page, 'in');
  await expectZoom(page, '125 %');
  await expect.poll(async () => Math.round((await box(card(page, 1))).width)).toBe(Math.round(widthStart * 1.25));
  await zoomBy(page, 'out', 3);
  await expectZoom(page, '50 %');
  // En escritorio la barra desactiva «Alejar» en el mínimo; en la Configuración el valor no baja de 50 %.
  if (!isCompact(page)) await expect(button(page, 'Alejar')).toBeDisabled();
  // Al 50 % arrastrar el doble de píxeles mueve una celda.
  await mouseDrag(page, card(page, 2), 0, 2 * cell.y * 0.5);
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  // Soltar no abre el editor: el arrastre no es un toque.
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  await expectGeometry(page, 2, 'Columna 5, fila 3 · 4 × 3');
  await closeEditor(page);
  await page.screenshot({ path: testInfo.outputPath('tools-zoom-50.png') });
  if (isCompact(page)) await inSettings(page, async () => { await button(page, 'Restablecer la vista del lienzo').click(); });
  else await button(page, 'Zoom 50 %, restablecer a 100 %').click();
  await expectZoom(page, '100 %');

  // Grilla: interruptor real (en la Configuración).
  await expect(page.getByTestId('canvas-grid')).toHaveCount(1);
  await setSwitch(page, 'Mostrar grilla', false);
  await expect(page.getByTestId('canvas-grid')).toHaveCount(0);
  await setSwitch(page, 'Mostrar grilla', true);

  // Lista: proyección de una columna, apilada y a todo el ancho; las herramientas del lienzo se desactivan.
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('board-list')).toHaveAttribute('aria-label', 'Lista del tablero en una columna');
  await expect(page.getByTestId('board-canvas')).toHaveCount(0);
  if (isCompact(page)) await expect(button(page, 'Herramienta Mano')).toBeDisabled();
  const [first, second] = [await box(card(page, 1)), await box(card(page, 2))];
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(Math.abs(first.x - second.x)).toBeLessThan(1);
  await card(page, 2).click();
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await closeEditor(page);
  await button(page, 'Vista de lista').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('marco de las fichas: preferencia global y excepción por ficha, con el foco siempre visible (UX7-D3, ADR 0049)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Marcos');
  await addCards(page, ['nota', 'nota', 'nota']);
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Por defecto (sin excepción, preferencia global apagada): marco normal en reposo.
  await expect.poll(() => borderWidth(card(page, 1))).toBe(2);

  // Preferencia global: sin marco en reposo, pero el foco lo sigue mostrando.
  await setSwitch(page, 'Ocultar el marco de las fichas', true);
  await expect.poll(() => borderWidth(card(page, 1))).toBe(0);
  await card(page, 1).focus();
  await expect.poll(() => borderWidth(card(page, 1))).toBe(3);
  await blur();
  await expect.poll(() => borderWidth(card(page, 1))).toBe(0);

  // Excepción por ficha «Mostrar siempre»: vence a la preferencia global oculta.
  await openFullCardEditor(page, card(page, 1));
  await button(page, 'Mostrar siempre').click();
  await expect(button(page, 'Mostrar siempre')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await expect.poll(() => borderWidth(card(page, 1))).toBe(2);

  // Excepción por ficha «Ocultar siempre» en otra tarjeta, con la preferencia global ya apagada: sigue oculta.
  await openFullCardEditor(page, card(page, 2));
  await button(page, 'Ocultar siempre').click();
  await expect(button(page, 'Ocultar siempre')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await setSwitch(page, 'Ocultar el marco de las fichas', false);
  await expect.poll(() => borderWidth(card(page, 2))).toBe(0);
  // La ficha 1 (excepción «Mostrar siempre») y la 3 (sin excepción) siguen la preferencia global, ya apagada: marco normal.
  await expect.poll(() => borderWidth(card(page, 1))).toBe(2);
  await expect.poll(() => borderWidth(card(page, 3))).toBe(2);

  // Quitar la excepción vuelve a seguir la preferencia global.
  await openFullCardEditor(page, card(page, 2));
  await button(page, 'Según preferencia').click();
  await expect(button(page, 'Según preferencia')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await expect.poll(() => borderWidth(card(page, 2))).toBe(2);
});

test('tamaño semántico de título y cuerpo por ficha, igual en el lienzo y en Lista (UX7-D4, ADR 0050)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Medidas');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await fillCardTitle(page, 'Medidas');
  await page.getByLabel('Contenido visual').fill('Cuerpo de prueba.');
  await button(page, 'Guardar texto').click();
  await expect(feedback(page)).toHaveText(/Guardado/);

  // Por defecto (sin excepción): mediano en ambos, el tamaño de hoy.
  const cardTitleNode = () => card(page, 1).getByText('Medidas');
  const cardBodyNode = () => card(page, 1).getByText('Cuerpo de prueba.');
  await expect.poll(() => fontSize(cardTitleNode())).toBe(16);
  await expect.poll(() => fontSize(cardBodyNode())).toBe(13);

  // Título grande, cuerpo pequeño: independientes entre sí.
  await button(page, 'Título grande').click();
  await expect(button(page, 'Título grande')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Cuerpo pequeño').click();
  await expect(button(page, 'Cuerpo pequeño')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);
  await expect.poll(() => fontSize(cardTitleNode())).toBe(20);
  await expect.poll(() => fontSize(cardBodyNode())).toBe(11);

  // Lista representa el mismo tamaño elegido, no una escala distinta por superficie.
  await button(page, 'Vista de lista').click();
  await expect.poll(() => fontSize(cardTitleNode())).toBe(20);
  await expect.poll(() => fontSize(cardBodyNode())).toBe(11);
  await button(page, 'Vista de lista').click();
});

test('UX7-ZOOM-PROPORTIONAL: Nota, cabecera y texto escalan juntos sin cambiar la composición', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Zoom proporcional');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await fillCardTitle(page, 'Título proporcional con ajuste estable');
  await page.getByLabel('Contenido visual').fill('Primera línea proporcional.\nSegunda línea estable.');
  await button(page, 'Guardar texto').click();
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible();
  await expect(button(page, 'Deshacer: Texto guardado')).toBeVisible();
  await closeEditor(page);

  const title = page.getByTestId('card-tab-label-tarjeta-1');
  const body = card(page, 1).getByText(/Primera línea proporcional/).first();
  const header = page.getByTestId('card-header-tarjeta-1');
  const visualLineCount = (locator: typeof body) => locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top));
    return new Set(tops).size;
  });
  const measured = async () => ({
    title: (await box(title)).height,
    body: (await box(body)).height,
    header: (await box(header)).height,
    card: await box(card(page, 1)),
    lines: await visualLineCount(body),
    label: await title.textContent(),
  });
  const assertRatio = (actual: number, baseline: number, target: number) => {
    expect(actual / baseline).toBeGreaterThanOrEqual(target * 0.9);
    expect(actual / baseline).toBeLessThanOrEqual(target * 1.1);
  };

  await resetView(page);
  const baseline = await measured();
  const setZoom = async (target: 0.5 | 0.74 | 0.75 | 0.76 | 0.99 | 1 | 1.25 | 1.5 | 2) => {
    await resetView(page);
    if (target === 0.5) await zoomBy(page, 'out', 2);
    else if (target === 0.74 || target === 0.99) {
      await page.getByTestId('board-canvas').evaluate((element, requested) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, ctrlKey: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          deltaY: -1200 * Math.log(requested),
        }));
      }, target);
    }
    else if (target === 0.75 || target === 0.76) {
      await zoomBy(page, 'out');
      if (target === 0.76) {
        await page.getByTestId('board-canvas').evaluate((element) => {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, ctrlKey: true,
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            deltaY: -1200 * Math.log(0.76 / 0.75),
          }));
        });
      }
    } else if (target === 1.25) await zoomBy(page, 'in');
    else if (target === 1.5) await zoomBy(page, 'in', 2);
    else if (target === 2) await zoomBy(page, 'in', 3);
    await expectZoom(page, `${Math.round(target * 100)} %`);
  };

  const observations: { zoom: number; titleHeight: number; bodyHeight: number; headerHeight: number; cardWidth: number; lines: number }[] = [];
  for (const target of [0.5, 0.74, 0.75, 0.76, 0.99, 1, 1.25, 1.5, 2] as const) {
    await setZoom(target);
    const current = await measured();
    observations.push({ zoom: target, titleHeight: current.title, bodyHeight: current.body, headerHeight: current.header, cardWidth: current.card.width, lines: current.lines });
    assertRatio(current.title, baseline.title, target);
    assertRatio(current.body, baseline.body, target);
    assertRatio(current.header, baseline.header, target);
    assertRatio(current.card.width, baseline.card.width, target);
    expect(current.lines).toBe(baseline.lines);
    expect(current.label).toBe(baseline.label);
    if (target !== 0.74 && target !== 0.99) {
      await page.screenshot({ path: testInfo.outputPath(`zoom-proportional-${Math.round(target * 100)}.png`) });
    }
  }
  console.info(`[UX7-ZOOM-PROPORTIONAL] ${testInfo.project.name} ${JSON.stringify(observations)}`);
});

test('UX7-TRANSPARENT-NOTE-ZOOM-FIX: una Nota transparente conserva ancho y líneas al cruzar 100 %', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await createWorkspace(page, 'Zoom transparente');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await seedBodyHtml(page, '<h1 data-nouty-align="center">historias conceptuales</h1>');
  await page.getByTestId('card-inspector-section-appearance').click();
  const bodyVisibility = button(page, 'Mostrar u ocultar el cuerpo de la nota');
  await bodyVisibility.click();
  await bodyVisibility.click();
  await button(page, 'Ocultar siempre').click();
  await page.getByTestId('note-vertical-alignment').getByRole('button', { name: 'Centro', exact: true }).click();
  await closeEditor(page);
  await selectCard(page, 1);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');

  const transparent = page.getByTestId('unified-content-tarjeta-1');
  const body = page.getByTestId('card-body-content-tarjeta-1');
  const preview = card(page, 1).getByText('historias conceptuales', { exact: true }).first();
  const setZoom = async (target: 0.78 | 0.99 | 1 | 1.01 | 1.28) => {
    await resetView(page);
    if (target !== 1) {
      await page.getByTestId('board-canvas').evaluate((element, requested) => {
        const rect = document.querySelector<HTMLElement>('[data-testid="card-tarjeta-1"]')?.getBoundingClientRect()
          ?? element.getBoundingClientRect();
        element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, ctrlKey: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          deltaY: -1200 * Math.log(requested),
        }));
      }, target);
    }
    await expectZoom(page, `${Math.round(target * 100)} %`);
  };
  const measure = async () => ({
    contentWidth: await body.evaluate((element) => element.clientWidth),
    paddingRight: await transparent.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight)),
    lines: await preview.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const tops = [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top));
      return new Set(tops).size;
    }),
  });

  await setZoom(1);
  const baseline = await measure();
  const observations: { zoom: number; contentWidth: number; paddingRight: number; lines: number }[] = [];
  for (const target of [0.78, 0.99, 1, 1.01, 1.28] as const) {
    await setZoom(target);
    const current = await measure();
    observations.push({ zoom: target, ...current });
    expect(Math.abs(current.contentWidth - baseline.contentWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(current.paddingRight - baseline.paddingRight)).toBeLessThanOrEqual(1);
    expect(current.lines).toBe(baseline.lines);
    await page.screenshot({ path: testInfo.outputPath(`transparent-note-zoom-${Math.round(target * 100)}.png`) });
  }
  if (isCompact(page)) {
    await setZoom(0.78);
    const controls = page.getByTestId('card-controls-tarjeta-1');
    await expect(controls).toBeVisible();
    const cardBox = await box(card(page, 1));
    const controlsBox = await box(controls);
    expect(controlsBox.x >= cardBox.x + cardBox.width || controlsBox.x + controlsBox.width <= cardBox.x).toBe(true);
    await page.getByTestId('card-actions-tarjeta-1').click();
    await expect(page.getByTestId('card-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('card-menu')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('card-controls-tarjeta-1')).toHaveCount(0);
  }
  console.info(`[UX7-TRANSPARENT-NOTE-ZOOM-FIX] ${testInfo.project.name} ${JSON.stringify(observations)}`);
});

test('UX7-ZOOM-PROPORTIONAL: contenido extenso, tabla, imagen y Nota transparente conservan composición', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'El recorrido mixto se captura en escritorio oscuro; la matriz básica cubre móvil.');
  test.setTimeout(60_000);
  await page.goto('./');
  await button(page, 'Tema oscuro').click();
  await createWorkspace(page, 'Zoom enriquecido');

  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await fillCardTitle(page, 'Título largo con tabla e imagen');
  await seedBodyHtml(page, '<p>Texto enriquecido estable.</p><table><thead><tr><th>Nombre</th><th>Estado</th></tr></thead><tbody><tr><td>Idea</td><td>Activa</td></tr></tbody></table><figure><img src="assets/images/mapa.png" alt="Mapa"><figcaption>Leyenda visible</figcaption></figure>');
  await expect(button(page, 'Deshacer: Texto guardado')).toBeVisible();
  await closeEditor(page);
  await card(page, 1).focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Shift+ArrowDown');

  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 2));
  await fillCardTitle(page, 'Documento extenso');
  await seedBodyHtml(page, Array.from({ length: 80 }, (_, index) => `<p>Línea extensa ${index + 1}</p>`).join(''));
  await expect(button(page, 'Deshacer: Texto guardado')).toBeVisible();
  await closeEditor(page);

  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 3));
  await fillCardTitle(page, 'Transparente y estrecha');
  await page.getByLabel('Contenido visual').fill('Texto transparente');
  await button(page, 'Guardar texto').click();
  await expect(page.getByText('Sin cambios pendientes')).toBeVisible();
  await page.getByTestId('card-inspector-section-appearance').click();
  const bodyVisibility = button(page, 'Mostrar u ocultar el cuerpo de la nota');
  await bodyVisibility.click();
  await bodyVisibility.click();
  await expect(bodyVisibility).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Ocultar siempre').click();
  await closeEditor(page);
  await card(page, 3).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');

  const setZoom = async (target: 0.5 | 0.75 | 0.76 | 1 | 1.25 | 1.5 | 2) => {
    await resetView(page);
    if (target === 0.5) await zoomBy(page, 'out', 2);
    else if (target === 0.75 || target === 0.76) {
      await zoomBy(page, 'out');
      if (target === 0.76) {
        await page.getByTestId('board-canvas').evaluate((element) => {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, ctrlKey: true,
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            deltaY: -1200 * Math.log(0.76 / 0.75),
          }));
        });
      }
    } else if (target === 1.25) await zoomBy(page, 'in');
    else if (target === 1.5) await zoomBy(page, 'in', 2);
    else if (target === 2) await zoomBy(page, 'in', 3);
    await expectZoom(page, `${Math.round(target * 100)} %`);
  };

  const assertRatio = (actual: number, baseline: number, target: number) => {
    expect(actual / baseline).toBeGreaterThanOrEqual(target * 0.9);
    expect(actual / baseline).toBeLessThanOrEqual(target * 1.1);
  };
  await setZoom(1);
  const mixed = page.locator('[data-testid="rich-note-preview-tarjeta-1"], [data-testid="card-reader-tarjeta-1"]').first();
  const table = mixed.locator('[data-testid*="-table-"]').first();
  const image = mixed.getByRole('img').first();
  await expect(table).toBeVisible();
  await expect(image).toBeVisible();
  const tableBaseline = await box(table);
  const imageBaseline = await box(image);

  for (const target of [0.5, 0.75, 0.76, 1, 1.25, 1.5, 2] as const) {
    await setZoom(target);
    await expect(mixed).toBeVisible();
    await expect(mixed).toContainText('Nombre');
    await expect(mixed).toContainText('Leyenda visible');
    const mixedBox = await box(mixed);
    const mixedCard = await box(card(page, 1));
    expect(mixedBox.x).toBeGreaterThanOrEqual(mixedCard.x);
    expect(mixedBox.x + mixedBox.width).toBeLessThanOrEqual(mixedCard.x + mixedCard.width + 1);
    const tableCurrent = await box(table);
    const imageCurrent = await box(image);
    assertRatio(tableCurrent.width, tableBaseline.width, target);
    assertRatio(tableCurrent.height, tableBaseline.height, target);
    assertRatio(imageCurrent.width, imageBaseline.width, target);
    assertRatio(imageCurrent.height, imageBaseline.height, target);
    await expect(page.getByTestId('card-reader-tarjeta-2')).toBeVisible();
    await expect(card(page, 3)).toContainText('Texto transparente');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`zoom-proportional-rich-${Math.round(target * 100)}.png`) });
  }

  await setZoom(1);
  const longReader = page.getByTestId('card-reader-tarjeta-2');
  await longReader.focus();
  await longReader.press('End');
  await expect.poll(() => longReader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await longReader.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  await longReader.focus();
  await longReader.press('Home');
  await expect.poll(() => longReader.evaluate((element) => element.scrollTop)).toBe(0);

  await openCardActions(page, card(page, 3), 'Transparente y estrecha');
  await button(page, 'Contraer Transparente y estrecha').click();
  const collapsedTitle = page.getByTestId('collapsed-title-tarjeta-3');
  const collapsedAt100 = await box(collapsedTitle);
  for (const target of [0.5, 2] as const) {
    await setZoom(target);
    await card(page, 3).focus();
    const current = await box(collapsedTitle);
    assertRatio(current.height, collapsedAt100.height, target);
    await page.screenshot({ path: testInfo.outputPath(`zoom-proportional-collapsed-${Math.round(target * 100)}.png`) });
  }

  await setZoom(1);
  await openCardActions(page, card(page, 3), 'Transparente y estrecha');
  await button(page, 'Minimizar Transparente y estrecha').click();
  const minimizedTitle = page.getByTestId('minimized-title-tarjeta-3');
  const minimizedAt100 = await box(minimizedTitle);
  for (const target of [0.5, 2] as const) {
    await setZoom(target);
    await card(page, 3).focus();
    const current = await box(minimizedTitle);
    assertRatio(current.height, minimizedAt100.height, target);
    await page.screenshot({ path: testInfo.outputPath(`zoom-proportional-minimized-${Math.round(target * 100)}.png`) });
  }
});

test('nota HTML sin imagen: el lienzo y la Lista muestran su texto real, y el tamaño de título/cuerpo se le aplica igual que a una Markdown (ADR 0050, ADR 0066)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'HTML sin imagen');
  await addCards(page, ['nota']);
  await openFullCardEditor(page, card(page, 1));
  await fillCardTitle(page, 'Resumen');
  await seedBodyHtml(page, '<h2>Encabezado</h2>\n<p>Cuerpo de prueba.</p>');
  await button(page, 'Título grande').click();
  await expect(button(page, 'Título grande')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Cuerpo pequeño').click();
  await expect(button(page, 'Cuerpo pequeño')).toHaveAttribute('aria-pressed', 'true');
  await closeEditor(page);

  // Lienzo: el cuerpo HTML seguro (ADR 0066) se ve de verdad, no una ficha vacía (CanvasCard ignoraba
  // `contentDocument` para toda nota sin imagen; defecto real corregido en esta intervención), y al
  // tamaño de título/cuerpo elegido (UX7-D4, ADR 0050; su control se restauró en esta misma intervención).
  const canvasPreview = page.getByTestId('card-rich-text-tarjeta-1');
  await expect(canvasPreview).toContainText('Encabezado');
  await expect(canvasPreview).toContainText('Cuerpo de prueba.');
  await expect.poll(() => fontSize(card(page, 1).getByText('Resumen'))).toBe(20);
  await expect.poll(() => fontSize(canvasPreview.getByText('Cuerpo de prueba.'))).toBe(11);

  // Lista: mismo documento, mismo tamaño (Board.tsx tenía el mismo defecto que CanvasCard).
  await button(page, 'Vista de lista').click();
  const listPreview = page.getByTestId('list-rich-text-tarjeta-1');
  await expect(listPreview).toContainText('Encabezado');
  await expect(listPreview).toContainText('Cuerpo de prueba.');
  await expect.poll(() => fontSize(card(page, 1).getByText('Resumen'))).toBe(20);
  await expect.poll(() => fontSize(listPreview.getByText('Cuerpo de prueba.'))).toBe(11);
  await button(page, 'Vista de lista').click();
});

test('Ctrl + rueda: zoom alrededor del cursor sin desplazar el punto enfocado; la rueda normal sigue paneando', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Zoom cursor');
  await addCards(page, ['nota']);
  // Gesto de escritorio (ratón/trackpad con Ctrl); el táctil usa pellizco o los controles de la barra.
  test.skip(isCompact(page), 'Ctrl + rueda es un gesto de escritorio.');
  await expectZoom(page, '100 %');
  const before = await box(card(page, 1));
  // El cursor se sitúa justo en la esquina superior izquierda de la tarjeta: ese punto del mundo debe
  // seguir en el mismo píxel de pantalla tras acercar, solo cambia el tamaño.
  await page.mouse.move(before.x, before.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -600);
  await page.keyboard.up('Control');
  await expect(page.getByTestId('zoom-level')).not.toContainText('100 %');
  const after = await box(card(page, 1));
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(after.width).toBeGreaterThan(before.width);
  // Ctrl + rueda al revés aleja; nunca pasa del límite de la barra (50–200 %).
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 6000);
  await page.keyboard.up('Control');
  await expectZoom(page, '50 %');
  await page.mouse.wheel(0, -6000);
  await expectZoom(page, '50 %');
  // Sin Ctrl, la rueda sigue desplazando el lienzo en vez de hacer zoom.
  await button(page, 'Zoom 50 %, restablecer a 100 %').click();
  await expectZoom(page, '100 %');
  const beforePan = await box(card(page, 1));
  await page.getByTestId('board-canvas').hover();
  await page.mouse.wheel(0, 80);
  await expectZoom(page, '100 %');
  const afterPan = await box(card(page, 1));
  expect(afterPan.y).toBeLessThan(beforePan.y);
});

test('P4: una tarjeta recién creada se revela completa cuando el inspector estrecha el lienzo', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'El estrechamiento por inspector se comprueba en escritorio.');
  await page.goto('./');
  await createWorkspace(page, 'Encuadre');
  await addCards(page, ['nota', 'nota']);
  const canvas = await page.getByTestId('board-canvas').boundingBox();
  const created = await card(page, 2).boundingBox();
  expect(canvas).not.toBeNull();
  expect(created).not.toBeNull();
  expect(created!.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(created!.x + created!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
});

test('lienzo de mundo: rueda, trackpad y tacto exploran ambos ejes sin borde en la última tarjeta', async ({ page, browserName }) => {
  await page.goto('./');
  await createWorkspace(page, 'Mundo');
  // Crear ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): no hay nada que cerrar.
  await addCards(page, ['nota']);
  const canvas = page.getByTestId('board-canvas');
  const first = await box(card(page, 1));
  const frame = await box(canvas);
  const relative = async () => {
    const [tile, board] = await Promise.all([box(card(page, 1)), box(canvas)]);
    return { x: Math.round(tile.x - board.x - (first.x - frame.x)), y: Math.round(tile.y - board.y - (first.y - frame.y)) };
  };
  if (isCompact(page)) {
    await button(page, 'Herramienta Mano').click();
    // Desde el centro del lienzo: el puntero no sale de la ventana (Firefox lo fija en el borde).
    const middle = await box(canvas);
    await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(middle.x + middle.width / 2 - step * 10, middle.y + middle.height / 2 - step * 12);
    await page.mouse.up();
    await expect.poll(async () => (await relative()).x).toBe(-100);
    await expect.poll(async () => (await relative()).y).toBe(-120);
    // Eventos táctiles reales solo por CDP (Chromium); en Firefox queda probado el recorrido con ratón.
    if (browserName !== 'chromium') return;
    for (let step = 0; step < 4; step += 1) await touchDrag(page, canvas, 50, 40, false);
    await expect.poll(async () => (await relative()).x).toBe(100);
    await expect.poll(async () => (await relative()).y).toBe(40);
    return;
  }
  await canvas.hover();
  await page.mouse.wheel(310, 470);
  await expect.poll(async () => (await relative()).x).toBe(-310);
  await expect.poll(async () => (await relative()).y).toBe(-470);
  await page.mouse.wheel(-620, -940);
  await expect.poll(async () => (await relative()).x).toBe(310);
  await expect.poll(async () => (await relative()).y).toBe(470);
  await expect(canvas).toBeVisible();
});

test('tableros y espacios: crear, navegar y añadir tarjetas en el tablero visible', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Primero');
  await button(page, 'Volver a mis espacios').click();
  await createWorkspace(page, 'Guion');
  // Desde 800 px, «Crear un tablero» está siempre visible en la barra lateral. Por debajo, las
  // pestañas de sesión (ADR 0035) reemplazan esa franja: «+» abre el selector, que ofrece crear.
  const tab = (name: string) => page.getByTestId(isCompact(page) ? 'open-tabs' : 'board-tabs').getByRole('button', { name, exact: true });
  const createBoard = async () => {
    if (isCompact(page)) await button(page, 'Abrir un tablero').click();
    await button(page, 'Crear un tablero').click();
  };
  await createBoard();
  await expect(tab('Tablero Tablero 1')).toHaveAttribute('aria-pressed', 'true');
  await addCards(page, ['nota']);
  await createBoard();
  await expect(tab('Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await button(page, 'Crear la primera nota').click();
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Guion', exact: true })).toBeVisible();
  // El tablero y su número de tarjetas (UX7-LAYOUT-CORRECTION: ya no hay cabecera que los repita;
  // es información del tablero, no del lienzo): la propia pestaña ya lo muestra en cualquier ancho.
  await expect(tab('Tablero Tablero 2')).toContainText('1');
  await tab('Tablero Tablero 1').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(card(page, 2)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('boards.png') });

  // Pestañas de sesión (ADR 0035): cerrar una no borra el tablero; se reabre desde el selector; no
  // se puede cerrar la última pestaña abierta.
  if (isCompact(page)) {
    await button(page, 'Cerrar la pestaña de Tablero 2').click();
    await expect(tab('Tablero Tablero 2')).toHaveCount(0);
    await button(page, 'Abrir un tablero').click();
    await button(page, 'Abrir el tablero Tablero 2').click();
    await expect(tab('Tablero Tablero 2')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 2)).toBeVisible();
    await button(page, 'Cerrar la pestaña de Tablero 1').click();
    await expect(tab('Tablero Tablero 1')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar la pestaña de Tablero 2' })).toHaveCount(0);
  }

  // Proyectos (UX7-LAYOUT-CORRECTION): ya no hay una segunda franja vertical para proyectos, solo
  // la de tableros (`BoardRail`), en ninguna anchura, ni ninguna fila de cabecera. En compacto vive
  // en «Más secciones» —alcanzable incluso con el editor de tarjeta enfocado, porque la barra de
  // herramientas ya no se oculta al enfocar—; desde 800 px, al final de la barra de herramientas o
  // en la barra lateral, sin pasos previos.
  await expect(page.getByTestId('project-tabs')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) >= 1100) await button(page, 'Cambiar de proyecto').click();
  else {
    if (isCompact(page)) await button(page, 'Más secciones').click();
    await button(page, 'Cambiar de proyecto').click();
  }
  await expect(page.getByTestId('project-sheet')).toBeVisible();
  await expect(button(page, 'Guion, proyecto actual')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('projects-sheet.png') });
  await button(page, 'Ir al proyecto Primero').click();
  await expect(page.getByRole('heading', { name: 'Primero', exact: true })).toBeVisible();
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await expect(page.getByTestId('workspace-sidebar')).toHaveCount((page.viewportSize()?.width ?? 0) >= 1100 ? 1 : 0);
});

/**
 * UX7-LAYOUT-CORRECTION: la cabecera superior (volver/nombre/estado/Proyectos, el aviso «Guardado
 * correctamente» y el recuento de tarjetas) desapareció por completo como región permanente — no
 * una versión más pequeña. La barra de herramientas del lienzo es el primer bloque del área de
 * trabajo; Proyectos, Guardar, Ctrl+S y Recuperación siguen accesibles desde la navegación real.
 */
test('UX7-LAYOUT-CORRECTION: ninguna fila de cabecera vive sobre el lienzo; la barra de herramientas es el primer bloque', async ({ page }) => {
  await page.goto('./');
  await createWorkspace(page, 'SinCabecera');
  await addCards(page, ['nota']);

  // 6-7: la barra de herramientas (o, con barra lateral, el propio lienzo) es lo primero del área
  // de trabajo, y el lienzo recupera una altura real, no solo «sin desbordamiento».
  const toolbarBox = await page.getByTestId('workspace-toolbar').boundingBox();
  const canvasBox = await page.getByTestId('board-canvas').boundingBox();
  if (!toolbarBox || !canvasBox) throw new Error('falta la barra o el lienzo');
  const viewportHeight = page.viewportSize()?.height ?? 0;
  expect(canvasBox.height).toBeGreaterThan(viewportHeight * 0.5);
  if (isCompact(page)) {
    // Compacto: la barra vive bajo el lienzo (patrón ya existente, ADR 0013); nada de identidad
    // vive sobre él salvo las pestañas de tablero, ajenas a esta corrección.
    expect(toolbarBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  } else {
    // Ancho/escritorio: nada por encima de la barra salvo, a lo sumo, el aviso de ZIP sin exportar
    // (ADR de memoria del navegador, ajeno a esta corrección) — nunca una fila de identidad.
    expect(toolbarBox.y).toBeLessThan(canvasBox.y);
  }

  // 1-3: no existe ya ningún «Volver a mis espacios»/nombre/Proyectos como fila fija sobre el
  // lienzo — existen, pero reubicados en la navegación real (barra lateral o, en compacto, tras
  // abrir «Más secciones»; aquí solo se comprueba su alcanzabilidad, no una posición concreta).
  if (isCompact(page)) {
    await button(page, 'Más secciones').click();
    await expect(page.getByTestId('more-sheet').getByRole('button', { name: 'Cambiar de proyecto' })).toBeVisible();
    await button(page, 'Cerrar más').click();
  } else {
    await expect(button(page, 'Cambiar de proyecto')).toBeVisible();
  }
  await expect(button(page, 'Volver a mis espacios')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SinCabecera', exact: true })).toBeVisible();

  // 4: un guardado manual correcto no anuncia nada (el guardado normal es silencioso).
  const saveNow = isCompact(page)
    ? async () => { await button(page, 'Más secciones').click(); await page.getByTestId('more-sheet').getByRole('button', { name: 'Guardar ahora (Ctrl+S)' }).click(); }
    : async () => { await button(page, 'Guardar ahora (Ctrl+S)').click(); };
  await saveNow();
  await expect(page.getByText('Guardado correctamente')).toHaveCount(0);

  // 9-10: Ctrl+S funciona igual, sin diálogo nativo, sin anunciar éxito.
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Guardado correctamente')).toHaveCount(0);

  // 5: ningún texto de recuento de tarjetas vive ya sobre el lienzo como franja propia (la pestaña
  // del tablero, ajena a esta corrección, puede seguir mostrándolo).
  await expect(page.getByText(/· \d+ TARJETAS?$/)).toHaveCount(0);

  // Entre 800 y 1099 px no hay barra lateral: identidad/Proyectos/Guardar deben vivir dentro de
  // «Más secciones» (vía el nuevo botón «Más» al final de la barra), nunca en una fila propia que,
  // aunque formara parte del componente, se viera igual que la cabecera retirada (defecto real
  // encontrado y corregido: antes desbordaban a esa tercera fila con `flexWrap`).
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(page.getByRole('heading', { name: 'SinCabecera', exact: true })).toHaveCount(0);
  await expect(button(page, 'Cambiar de proyecto')).toHaveCount(0);
  const toolbarTablet = page.getByTestId('workspace-toolbar');
  await expect(toolbarTablet.getByRole('button', { name: 'Más' })).toBeVisible();
  // Nada entre el final de la barra y el lienzo: la propia barra es el último bloque antes de él.
  const toolbarTabletBox = await toolbarTablet.boundingBox();
  const canvasTabletBox = await page.getByTestId('board-canvas').boundingBox();
  if (!toolbarTabletBox || !canvasTabletBox) throw new Error('falta la barra o el lienzo (tablet)');
  // Tolera el espaciado normal entre bloques (`gap` del área de trabajo, bordes): una fila de
  // cabecera añadiría bastante más que eso (40+ px), no unos pocos píxeles de separación.
  expect(canvasTabletBox.y).toBeLessThan(toolbarTabletBox.y + toolbarTabletBox.height + 20);
  await toolbarTablet.getByRole('button', { name: 'Más' }).click();
  await expect(page.getByTestId('more-sheet').getByRole('heading', { name: 'SinCabecera', exact: true })).toBeVisible();
  await expect(page.getByTestId('more-sheet').getByRole('button', { name: 'Cambiar de proyecto' })).toBeVisible();
});

test('UX7-A: las acciones individuales permiten renombrar, mover y archivar un tablero', async ({ page }, testInfo) => {
  await page.goto('./');
  await createWorkspace(page, 'Guion');
  for (let index = 0; index < 3; index += 1) {
    if (isCompact(page)) await button(page, 'Abrir un tablero').click();
    await button(page, 'Crear un tablero').click();
  }
  await addCards(page, ['nota']);

  await button(page, 'Opciones del tablero Tablero 3').click();
  const actions = page.getByTestId('board-actions-dialog');
  await expect(actions).toBeVisible();
  await expect(actions.getByLabel('Nombre del tablero')).toHaveValue('Tablero 3');
  await expect(actions.getByRole('button', { name: 'Guardar nombre', exact: true })).toBeDisabled();
  await expect(actions.getByRole('button', { name: 'Mover antes', exact: true })).toBeEnabled();
  await expect(actions.getByRole('button', { name: 'Mover después', exact: true })).toBeDisabled();
  await actions.getByLabel('Nombre del tablero').fill('Escenas');
  await page.screenshot({ path: `artifacts/ux7-a-board-actions-${testInfo.project.name}.png` });
  await actions.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(actions.getByRole('heading', { name: 'Acciones de Escenas', exact: true })).toBeVisible();
  await expect(button(page, 'Deshacer: Tablero renombrado a «Escenas»')).toBeVisible();
  await expect(button(page, 'Tablero Escenas')).toHaveAttribute('aria-pressed', 'true');

  await actions.getByRole('button', { name: 'Mover antes', exact: true }).click();
  const tabs = page.getByTestId(isCompact(page) ? 'open-tabs' : 'board-tabs');
  const visibleTabOrder = () => tabs.getByRole('button', { name: /^Tablero / }).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')),
  );
  if (!isCompact(page)) await expect.poll(visibleTabOrder).toEqual(['Tablero Tablero 1', 'Tablero Escenas', 'Tablero Tablero 2']);
  await expect(button(page, 'Tablero Escenas')).toHaveAttribute('aria-pressed', 'true');

  await actions.getByRole('button', { name: /^Cerrar acciones de escenas/ }).click();
  await button(page, isCompact(page) ? 'Organizar tableros' : 'Opciones de tableros').click();
  const organizer = page.getByTestId('board-organizer-dialog');
  await expect(organizer.getByRole('button', { name: 'Seleccionar tablero Escenas', exact: true })).toBeVisible();
  const durableOrder = () => organizer.getByRole('button', { name: /^Seleccionar tablero / }).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')),
  );
  await expect.poll(durableOrder).toEqual([
    'Seleccionar tablero Tablero 1',
    'Seleccionar tablero Escenas',
    'Seleccionar tablero Tablero 2',
  ]);
  await organizer.getByRole('button', { name: /^Cerrar organizar tableros/ }).click();

  await button(page, 'Opciones del tablero Escenas').click();
  await actions.getByRole('button', { name: 'Mover después', exact: true }).click();
  if (!isCompact(page)) await expect.poll(visibleTabOrder).toEqual(['Tablero Tablero 1', 'Tablero Tablero 2', 'Tablero Escenas']);
  await expect(actions.getByRole('button', { name: 'Mover después', exact: true })).toBeDisabled();
  await actions.getByRole('button', { name: 'Archivar tablero', exact: true }).click();
  await expect(button(page, 'Deshacer: Tablero «Escenas» archivado con sus tarjetas')).toBeVisible();
  await expect(button(page, 'Tablero Escenas')).toHaveCount(0);
});

test('recargar pierde los datos en memoria y la interfaz lo indica', async ({ page }, testInfo) => {
  const { runtimeErrors } = trackProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Temporal');
  await addCards(page, ['nota']);

  await page.reload();
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Este espacio no existe en esta sesión. Los espacios del prototipo viven en memoria y se pierden al recargar o cerrar la pestaña.');
  await expect(page.getByTestId('card-tarjeta-1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace-reloaded.png') });
  await button(page, 'Volver a mis espacios').click();
  await expect(page.getByRole('heading', { name: /Dale un lugar/ })).toBeVisible();
  await expect(page.getByTestId('session-workspaces')).toContainText('Todavía no hay espacios en esta sesión.');
  await page.goto('./workspace?id=temporal');
  await expect(page.getByTestId('workspace-missing')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

/**
 * Distribución según el ancho: barra abajo y hoja de edición en compacto; barra encima y editor
 * contextual centrado desde 800 px; barra lateral desde 1100 px. El lienzo domina y nunca desborda.
 */
/** Incumplimientos de la distribución para un ancho; vacío si todo está bien. Se reintenta tras redimensionar. */
async function layoutProblems(page: Page, width: number): Promise<string[]> {
  const problems: string[] = [];
  const [canvas, toolbar] = await Promise.all(['board-canvas', 'workspace-toolbar']
    .map((id) => page.getByTestId(id).boundingBox()));
  if (!canvas || !toolbar) return ['falta el lienzo o la barra'];
  const height = page.viewportSize()?.height ?? 0;
  if (width >= at.width) {
    if (toolbar.y + toolbar.height > canvas.y) problems.push('la barra no está sobre el lienzo');
  } else {
    if (toolbar.y < canvas.y + canvas.height) problems.push('la barra no está bajo el lienzo');
    const escaped = await page.getByTestId('workspace-toolbar').getByRole('button').evaluateAll(
      (controls, viewportWidth) => controls.some((control) => {
        const found = control.getBoundingClientRect();
        return found.width === 0 || found.right > viewportWidth + 0.5;
      }),
      width,
    );
    if (escaped) problems.push('un control de la barra se sale');
  }
  if (await page.getByTestId('workspace-sidebar').count() !== (width >= 1100 ? 1 : 0)) problems.push('barra lateral incorrecta');
  // En escritorio el lienzo ocupa la mayor parte del ancho.
  if (width >= 1100 && canvas.width <= width * 0.5) problems.push('el lienzo no domina');
  if (canvas.height <= 150) problems.push('lienzo demasiado bajo');
  // La barra de herramientas queda entera dentro de la pantalla.
  if (toolbar.y + toolbar.height > height + 0.5) problems.push('la barra se sale por abajo');
  if (await hasHorizontalOverflow(page)) problems.push('desbordamiento horizontal');
  return problems;
}

/**
 * Distribución según el ancho: barra abajo y hoja de edición en compacto; barra encima y editor
 * contextual centrado desde 800 px; barra lateral desde 1100 px. El lienzo domina y nunca desborda.
 */
async function expectLayout(page: Page, width: number) {
  await expect.poll(() => layoutProblems(page, width), { message: `distribución a ${width} px` }).toEqual([]);
}

test('distribución responsive: carga inicial, tablet, 799/800 y redimensionado en ambos sentidos', async ({ page }, testInfo) => {
  const initial = page.viewportSize() ?? desktop;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Responsive');
  // Solo hacen falta tres fichas genéricas para medir la distribución.
  await addCards(page, ['nota', 'nota', 'nota']);
  // La última tarjeta creada se reveló; la primera puede quedar fuera de la vista: se activa con el teclado.
  await tapCard(page, 1);
  await closeEditor(page);
  // Primera medida con el tamaño inicial, antes de redimensionar.
  await expectLayout(page, initial.width);
  await page.screenshot({ path: testInfo.outputPath('responsive-initial.png') });
  const sizes = initial.width >= at.width ? [phone, below, at, tabletPortrait, tabletLandscape, initial] : [desktop, at, below, tabletLandscape, tabletPortrait, initial];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectLayout(page, size.width);
    if (size === below || size === at) await page.screenshot({ path: testInfo.outputPath(`responsive-${size.width}.png`) });
  }
});

test('accesibilidad del workspace: teclado, foco visible, estados y controles táctiles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await createWorkspace(page, 'Teclado');
  const insert = button(page, 'Abrir menú Insertar');

  // Activación con Enter y Espacio, foco visible en la barra y navegación del menú unificado P10.
  await insert.focus();
  await expect.poll(() => borderColor(insert)).toBe(rgb(themeColors.light.selection));
  await page.keyboard.press('Enter');
  const addNote = page.getByTestId('insert-dialog').getByRole('button', { name: 'Insertar nota', exact: true });
  await addNote.focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 1)).toBeVisible();
  await insert.focus();
  await page.keyboard.press('Space');
  const addTitle = page.getByTestId('insert-dialog').getByRole('button', { name: 'Insertar título flotante', exact: true });
  await addTitle.focus();
  await page.keyboard.press('Space');
  await expect(card(page, 2)).toBeVisible();
  await expect(button(page, 'Herramienta Seleccionar')).toHaveAttribute('aria-pressed', 'true');
  if (isCompact(page)) await expect(button(page, 'Herramienta Mano')).toHaveAttribute('aria-pressed', 'false');
  else await expect(button(page, 'Herramienta Mano')).toHaveCount(0);

  // Las tarjetas se alcanzan con el teclado y se seleccionan con Espacio; los botones del inspector mueven.
  await card(page, 2).focus();
  await expect.poll(() => borderColor(card(page, 2))).toBe(rgb(themeColors.light.selection));
  await card(page, 1).focus();
  await page.keyboard.press('Space');
  await expect(card(page, 1)).toHaveAttribute('aria-pressed', 'true');
  // Seleccionar ya no abre el editor por sí solo (auditoría de interacción, 2026-09-29): «Editar» sí.
  await openCardEditor(page, 1);
  // Dónde nace la segunda tarjeta depende del viewport (a la derecha en escritorio, debajo en móvil,
  // ADR 0004), así que «arriba» es la única dirección libre en ambos para probar que Enter activa el
  // botón igual que un clic (reproducido el 2026-09-29).
  const moveUp = button(page, 'Mover arriba');
  await moveUp.focus();
  await page.keyboard.press('Enter');
  await expect(geometry(page)).toHaveText('X 0, Y -1 · 4 × 3');
  expect(await activeLabel(page)).toBe('Mover arriba');
  // Escape cancela una conexión a medias. «Conectar» ya no es una herramienta de la barra (ADR 0048):
  // se inicia desde el menú contextual de la propia tarjeta de origen.
  await revealCanvas(page);
  await closeEditor(page);
  // Un título flotante solo dibuja sus controles mientras está seleccionado (es un rótulo editorial):
  // se selecciona antes de abrir sus acciones, aunque en escritorio el clic derecho ya la seleccione.
  await card(page, 2).focus();
  await page.keyboard.press('Space');
  const title2 = ((await card(page, 2).getAttribute('aria-label')) ?? '').replace(/^Tarjeta /, '');
  await openCardActions(page, card(page, 2), title2);
  await button(page, `Conectar desde ${title2}`).click();
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('connect-hint-tarjeta-2')).toHaveCount(0);
  await button(page, 'Herramienta Seleccionar').click();

  // Nombres accesibles y controles de al menos 44 × 44 px en todo el workspace.
  const buttons = page.getByTestId('workspace-screen').getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(20);
  for (let index = 0; index < count; index += 1) {
    const control = buttons.nth(index);
    if (!await control.isVisible()) continue;
    const name = await control.getAttribute('aria-label');
    expect(name).toBeTruthy();
    const found = await box(control);
    // Redondeo a centésimas de píxel: Firefox da 43,99997 px a un control de 44 px en una posición
    // fraccionaria (error de coma flotante); 43,99 px seguiría fallando.
    const hundredths = (value: number) => Math.round(value * 100) / 100;
    expect(hundredths(found.width), `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
    expect(hundredths(found.height), `alto de «${name}»`).toBeGreaterThanOrEqual(44);
  }
  await openCardEditor(page, 1);
  for (const label of ['Título de la tarjeta', 'Contenido visual']) expect((await box(page.getByLabel(label))).height).toBeGreaterThanOrEqual(44);
  await revealCanvas(page);
  // Las asas tienen un área táctil de 44 px: garantía de densidad a 100 %, no del zoom (100 % por
  // defecto y configurable, UX7-D1); se acerca un paso más para medirla de forma determinista.
  if (isCompact(page)) {
    await openSettings(page);
    await button(page, 'Acercar el lienzo').click();
    await button(page, 'Cerrar configuración').click();
  } else {
    await button(page, 'Acercar').click();
  }
  const handle = await box(page.getByTestId('resize-se-tarjeta-1'));
  expect(handle.width).toBeGreaterThanOrEqual(44);
  expect(handle.height).toBeGreaterThanOrEqual(44);
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test('selección múltiple: entrar, recuento, mover el conjunto arrastrando y con flechas, Escape, Todas y archivar (ADR 0025)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Conjunto');
  await sideBySide(page);
  const cell = cellSize(page);
  const count = page.getByTestId('multi-count');

  // Táctil y teclado: «Selección» vive en el menú ligero de la ficha; tocar otra la añade y tocarla de nuevo la quita.
  // En escritorio, Shift+F10 sobre la ficha enfocada abre el mismo menú (ADR 0048): no hay botón «⋯» fijo.
  await selectCard(page, 1);
  if (isCompact(page)) {
    // Las dos fichas se llaman «Nueva nota»: «Acciones de Nueva nota» sería ambiguo entre ambas.
    await page.getByTestId('card-actions-tarjeta-1').focus();
    await page.keyboard.press('Enter');
  } else {
    await card(page, 1).focus();
    await page.keyboard.press('Shift+F10');
  }
  await button(page, 'Seleccionar Nueva nota junto con otras tarjetas').click();
  await expect(count).toHaveText('1 SELECCIONADA');
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);
  const toggleInSet = async (id: number) => { await card(page, id).focus(); await page.keyboard.press('Space'); };
  await toggleInSet(2);
  await expect(count).toHaveText('2 SELECCIONADAS');
  await toggleInSet(2);
  await expect(count).toHaveText('1 SELECCIONADA');
  await toggleInSet(2);
  await expect(count).toHaveText('2 SELECCIONADAS');
  await expect(page.getByTestId('resize-s-tarjeta-1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('multi-select.png') });

  // Arrastrar una mueve todas, con vista previa; un solo guardado. Se arrastra la 2: tocarla la trajo a la vista.
  if (isCompact(page)) {
    if (browserName === 'chromium' && testInfo.project.use.hasTouch) await touchDrag(page, card(page, 2), 0, 4 * cell.y);
    else await mouseDrag(page, card(page, 2), 0, 4 * cell.y);
  } else {
    await mouseDrag(page, card(page, 2), 0, 4 * cell.y, { release: false });
    await expect(page.getByTestId('drag-status')).toHaveText('Mover 2 tarjetas: +0 columnas, +4 filas. Escape cancela.');
    await page.mouse.up();
  }
  await expect(feedback(page)).toHaveText('2 tarjetas movidas. Guardado en memoria.');
  // UX7-A1: la barra múltiple ya no tiene botones de flecha; las flechas del teclado mueven el conjunto.
  await page.keyboard.press('ArrowDown');
  await expect(feedback(page)).toHaveText('2 tarjetas movidas. Guardado en memoria.');
  await expect(count).toHaveText('2 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();
  await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  await expectGeometry(page, 1, 'Columna 1, fila 6 · 4 × 3');
  await closeEditor(page);
  await expectGeometry(page, 2, 'Columna 5, fila 6 · 4 × 3');
  await closeEditor(page);

  // Escritorio: Ctrl + clic añade; la que estaba abierta entra en el conjunto. Escape sale.
  if (!isCompact(page)) {
    await card(page, 1).click();
    await card(page, 2).click({ modifiers: ['Control'] });
    await expect(count).toHaveText('2 SELECCIONADAS');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  }

  // «Todas» y archivar el conjunto de una vez: el tablero queda vacío y el Archivo cuenta 2.
  await selectCard(page, 1);
  if (isCompact(page)) {
    // Las dos fichas se llaman «Nueva nota»: «Acciones de Nueva nota» sería ambiguo entre ambas.
    await page.getByTestId('card-actions-tarjeta-1').focus();
    await page.keyboard.press('Enter');
  } else {
    await card(page, 1).focus();
    await page.keyboard.press('Shift+F10');
  }
  await button(page, 'Seleccionar Nueva nota junto con otras tarjetas').click();
  await button(page, 'Seleccionar todas las tarjetas del tablero').click();
  await expect(count).toHaveText('2 SELECCIONADAS');
  await button(page, 'Archivar las 2 seleccionadas').click();
  await expect(feedback(page)).toHaveText('2 tarjetas archivadas. Guardado en memoria.');
  await expect(page.getByTestId('multi-bar')).toHaveCount(0);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('deshacer y rehacer: mover y archivar, con la barra (o junto al aviso en móvil) y con el teclado; una acción nueva vacía rehacer (ADR 0026)', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Historial');
  const undoButton = page.getByRole('button', { name: /^Deshacer(?::|$)/ });
  const redoButton = page.getByRole('button', { name: /^Rehacer(?::|$)/ });
  await expect(undoButton).toHaveAttribute('aria-disabled', 'true');
  await addCards(page, ['nota']);
  await expect(undoButton).toHaveAccessibleName('Deshacer: Nota añadida');
  // Crear ya no abre el editor por sí sola (auditoría de interacción, 2026-10-02): «Mover a la
  // derecha» es del editor.
  await openFullCardEditor(page, card(page, 1));
  await page.getByRole('button', { name: /^Mover despu/ }).click();
  await expect(feedback(page)).toHaveText('Tarjeta movida. Guardado en memoria.');
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');

  // Deshacer con el editor abierto: vuelve a su sitio y el editor muestra lo guardado. Deshacer/rehacer
  // remonta el editor (cambia su `key` con la revisión): la sección de posición vuelve a su estado
  // cerrado por defecto en escritorio y hay que expandirla de nuevo para leer `card-geometry`.
  await button(page, 'Deshacer: Tarjeta movida').click();
  await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
  await expandPosition(page);
  await expect(geometry(page)).toHaveText('Columna 1, fila 1 · 4 × 3');
  await page.screenshot({ path: testInfo.outputPath('undo.png') });
  await button(page, 'Rehacer: Tarjeta movida').click();
  await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
  await expandPosition(page);
  await expect(geometry(page)).toHaveText('Columna 2, fila 1 · 4 × 3');
  await expect(redoButton).toHaveAttribute('aria-disabled', 'true');

  // Archivar y deshacer: la tarjeta vuelve al tablero y sale del Archivo.
  if (isCompact(page)) {
    await button(page, 'Archivar la tarjeta Nueva nota').click();
  } else {
    // Escritorio: Archivar vive solo en el menú contextual (ADR 0048), no en el editor.
    await closeEditor(page);
    await openCardActions(page, card(page, 1), 'Nueva nota');
    await button(page, 'Archivar Nueva nota').click();
  }
  await expect(feedback(page)).toHaveText('Tarjeta archivada. Guardado en memoria.');
  await expect(card(page, 1)).toHaveCount(0);
  await button(page, 'Deshacer: Tarjeta archivada').click();
  await expect(card(page, 1)).toBeVisible();
  await expect(feedback(page)).toHaveText('Deshecho: Tarjeta archivada. Guardado en memoria.');

  // Teclado (escritorio): Ctrl + Z deshace fuera de los campos; dentro de un campo no toca el proyecto.
  if (!isCompact(page)) {
    await page.getByTestId('board-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
    await page.keyboard.press('Control+Shift+z');
    await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
    await card(page, 1).click();
    await openFullCardEditor(page, card(page, 1));
    await page.getByLabel('Título de la tarjeta').focus();
    await page.keyboard.press('Control+z');
    await expect(feedback(page)).toHaveText('Rehecho: Tarjeta movida. Guardado en memoria.');
    await closeEditor(page);
    await button(page, 'Deshacer: Tarjeta movida').click();
    await expect(feedback(page)).toHaveText('Deshecho: Tarjeta movida. Guardado en memoria.');
  } else {
    await button(page, 'Deshacer: Tarjeta movida').click();
  }

  // Tras deshacer, una acción nueva vacía rehacer.
  await expect(redoButton).toHaveAccessibleName('Rehacer: Tarjeta movida');
  await addCards(page, ['nota']);
  await expect(redoButton).toHaveAttribute('aria-disabled', 'true');
  expect(runtimeErrors).toEqual([]);
});

test('marcos: agrupar la selección, renombrar, mover con sus tarjetas (flechas y arrastrando el título), añadir nota dentro, sus tarjetas y quitar (ADR 0027)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Marcos');
  await sideBySide(page);
  const frameGeometry = page.getByTestId('frame-geometry');
  const header = page.getByTestId('frame-header-marco-1');
  // Justo después de arrastrar el título, una pulsación en él se descarta 400 ms (es el «click» del
  // gesto): se repite hasta abrir el editor. Seleccionar el marco es idempotente.
  const openFrame = async () => {
    await expect(async () => {
      await header.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('frame-inspector')).toBeVisible({ timeout: 300 });
    }).toPass();
  };
  const closeFrame = async () => {
    await button(page, 'Cerrar el editor del marco').click();
    await expect(page.getByTestId('frame-inspector')).toHaveCount(0);
  };

  // Agrupar: el marco rodea la selección con una fila más arriba para el título y se abre su editor.
  await tapCard(page, 1);
  await button(page, 'Seleccionar varias tarjetas empezando por esta').click();
  await tapCard(page, 2, false);
  await button(page, 'Agrupar las 2 seleccionadas en un marco').click();
  await expect(feedback(page)).toHaveText('Marco creado con 2 tarjetas. Guardado en memoria.');
  await expect(page.getByTestId('frame-inspector')).toBeVisible();
  await expect(frameGeometry).toHaveText('X 0, Y -1 · 8 × 4');
  await expect(page.getByTestId('frame-members')).toContainText('2 tarjetas dentro');
  await page.getByLabel('Título del marco').fill('Kioto');
  await button(page, 'Guardar el título del marco').click();
  await expect(feedback(page)).toHaveText('Marco renombrado. Guardado en memoria.');
  await expect(header).toContainText('Kioto');

  // Flechas: el marco baja una fila y sus tarjetas con él.
  await page.getByRole('button', { name: /^Mover despu/ }).click();
  await expect(feedback(page)).toHaveText('Marco movido. Guardado en memoria.');
  await expect(frameGeometry).toHaveText('Columna 1, fila 1 · 8 × 4');
  await page.screenshot({ path: testInfo.outputPath('frame.png') });
  await closeFrame();
  await expectGeometry(page, 2, 'Columna 5, fila 2 · 4 × 3');
  await closeEditor(page);

  // Arrastrar el título mueve el marco con sus tarjetas, con vista previa.
  const cell = cellSize(page);
  await resetView(page);
  if (isCompact(page)) {
    if (browserName === 'chromium' && testInfo.project.use.hasTouch) await touchDrag(page, header, 0, 2 * cell.y, false);
    else await mouseDrag(page, header, 0, 2 * cell.y, { header: false });
  } else {
    await mouseDrag(page, header, 0, 2 * cell.y, { header: false, release: false });
    await expect(page.getByTestId('drag-status')).toHaveText('Mover el marco «Kioto» con 2 tarjetas: +0 columnas, +2 filas. Escape cancela.');
    await page.mouse.up();
  }
  await expect(feedback(page)).toHaveText('Marco movido. Guardado en memoria.');
  await expectGeometry(page, 1, 'Columna 1, fila 4 · 4 × 3');
  await closeEditor(page);

  // Lleno, no añade nada; más alto, la nota aparece dentro (seleccionada, sin abrir su editor por sí sola).
  await openFrame();
  await button(page, 'Añadir nota en el marco').click();
  await expect(feedback(page)).toHaveText('El marco no tiene hueco para otra nota: hazlo más grande.');
  for (let step = 0; step < 3; step += 1) await button(page, 'Marco más alto').click();
  await expect(frameGeometry).toHaveText('Columna 1, fila 3 · 8 × 7');
  await button(page, 'Añadir nota en el marco').click();
  await expect(feedback(page)).toHaveText('Nota añadida en el marco. Guardado en memoria.');
  // Crear ya no abre el editor por sí sola (auditoría de interacción, 2026-10-02): la nota añadida
  // al marco queda seleccionada; se abre su editor completo a mano.
  await openFullCardEditor(page, page.locator('[data-testid^="card-tarjeta-"][aria-pressed="true"]'));
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await closeEditor(page);

  // Sus tarjetas abren la selección múltiple; quitar el marco deja las tarjetas.
  await openFrame();
  await expect(page.getByTestId('frame-members')).toContainText('3 tarjetas dentro');
  await button(page, 'Seleccionar las tarjetas del marco').click();
  await expect(page.getByTestId('multi-count')).toHaveText('3 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();
  await openFrame();
  await button(page, 'Quitar el marco Kioto').click();
  await expect(feedback(page)).toHaveText('Marco quitado; sus tarjetas siguen en el tablero. Guardado en memoria.');
  await expect(page.getByTestId('frame-marco-1')).toHaveCount(0);
  await expect(card(page, 3)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('vista general: selección por área, un toque en el fondo cierra el editor, «Ver todo», minimapa y zoom en móvil (ADR 0028)', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { runtimeErrors } = trackProblems(page);
  await page.goto('./');
  await createWorkspace(page, 'Vista');
  await sideBySide(page);
  const canvas = await box(page.getByTestId('board-canvas'));
  const cell = cellSize(page);

  // Arrastrar sobre el fondo, de abajo a la derecha hacia la primera tarjeta, selecciona las que toca.
  const from = { x: canvas.x + canvas.width - 24, y: canvas.y + 5 * cell.y };
  const to = { x: canvas.x + 30, y: canvas.y + 30 };
  if (isCompact(page) && browserName === 'chromium' && testInfo.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y) }] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(from.x + ((to.x - from.x) * step) / 10), y: Math.round(from.y + ((to.y - from.y) * step) / 10) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await expect(page.getByTestId('selection-area')).toBeVisible();
    await page.mouse.up();
  }
  await expect(page.getByTestId('multi-count')).toHaveText('2 SELECCIONADAS');
  await button(page, 'Cancelar la selección').click();

  // Un toque en el fondo (sin arrastrar) sigue cerrando el editor.
  await tapCard(page, 1);
  await expect(page.getByTestId('card-inspector')).toBeVisible();
  await revealCanvas(page);
  // Con el editor abierto, el lienzo es más estrecho (escritorio): el punto se toma del lienzo actual.
  const now = await box(page.getByTestId('board-canvas'));
  await page.mouse.click(now.x + 20, now.y + 6 * cell.y);
  await expect(page.getByTestId('card-inspector')).toHaveCount(0);

  // Una tarjeta lejos: «Ver todo» encuadra las dos con menos zoom.
  await tapCard(page, 2);
  for (let step = 0; step < 10; step += 1) await button(page, 'Mover abajo').click();
  await expect(geometry(page)).toHaveText('Columna 5, fila 11 · 4 × 3');
  await closeEditor(page);
  await resetView(page);
  await button(page, 'Ver todo el tablero').click();
  await expect(page.getByTestId(isCompact(page) ? 'canvas-zoom' : 'zoom-level')).not.toContainText('100 %');
  // Las dos se ven enteras y ninguna queda bajo los controles inferiores.
  const controls = await box(page.getByTestId('canvas-controls'));
  for (const id of [1, 2]) {
    const found = await box(card(page, id));
    expect(found.y).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(found.y + found.height).toBeLessThanOrEqual(controls.y + 1);
  }

  // Minimapa: tocar la esquina de arriba lleva la vista hacia la primera tarjeta.
  await button(page, 'Mostrar el minimapa').click();
  const map = page.getByTestId('canvas-minimap');
  await expect(map).toHaveAccessibleName('Minimapa: 2 tarjetas; toca para ir a esa zona');
  await page.screenshot({ path: testInfo.outputPath('minimap.png') });
  const before = await box(card(page, 2));
  const mapBox = await box(map);
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height - 8);
  await expect.poll(async () => (await box(card(page, 2))).y).toBeLessThan(before.y);
  await button(page, 'Ocultar el minimapa').click();
  await expect(map).toHaveCount(0);

  // Móvil: el zoom está en los controles del lienzo, sin abrir Configuración.
  if (isCompact(page)) {
    // «Ver todo» calcula un zoom propio (no uno de los pasos fijos) para encuadrar las dos fichas;
    // «Acercar» sube al siguiente paso fijo desde ahí, no desde el 100 % por defecto (UX7-D1).
    await button(page, 'Acercar la vista').click();
    await expect(page.getByTestId('canvas-zoom')).toHaveText('75 %');
    await page.getByTestId('canvas-zoom').click();
    await expect(page.getByTestId('canvas-zoom')).toHaveText('100 %');
  }
  expect(runtimeErrors).toEqual([]);
});
test('UX7-NAV: el zoom conserva identidad, abrir un tablero centra sus Notas y la barra derecha no recorta pestañas', async ({ page }, testInfo) => {
  test.skip(isCompact(page), 'La barra derecha pertenece a la disposición de escritorio.');
  await page.goto('./');
  await createWorkspace(page, 'Navegación visual');
  await addCards(page, ['nota']);

  const tabLabel = page.getByTestId('card-tab-label-tarjeta-1');
  await expect(tabLabel).toContainText('Nueva nota');
  const normalSize = Number.parseFloat(await tabLabel.evaluate((element) => getComputedStyle(element).fontSize));
  await zoomBy(page, 'out', 2);
  const reducedSize = Number.parseFloat(await tabLabel.evaluate((element) => getComputedStyle(element).fontSize));
  expect(reducedSize).toBeGreaterThan(normalSize);
  await expect(card(page, 1)).toContainText('Nueva nota');
  await page.screenshot({ path: testInfo.outputPath('zoom-identificable.png') });
  await resetView(page);

  // Se lleva la Nota fuera de la cámara inicial. Al volver a abrir el tablero, debe quedar dentro del
  // viewport sin modificar sus coordenadas durables.
  const beforeMove = await box(card(page, 1));
  await mouseDrag(page, card(page, 1), 620, 330);
  await expect.poll(async () => (await box(card(page, 1))).x).toBeGreaterThan(beforeMove.x + 500);
  await button(page, 'Crear un tablero').click();
  const rail = page.getByTestId('board-tabs');
  await expect(rail.getByRole('button', { name: 'Tablero Tablero 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await rail.getByRole('button', { name: 'Tablero Tablero principal', exact: true }).click();
  const canvasBox = await box(page.getByTestId('board-canvas'));
  const cardBox = await box(card(page, 1));
  expect(cardBox.x).toBeGreaterThanOrEqual(canvasBox.x);
  expect(cardBox.y).toBeGreaterThanOrEqual(canvasBox.y);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height);

  const railGeometry = await rail.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(railGeometry.scrollWidth).toBeLessThanOrEqual(railGeometry.clientWidth);
  await page.screenshot({ path: testInfo.outputPath('tablero-centrado-barra-derecha.png') });
});
