// Revisión visual local: mismas escenas, viewport, zoom y tema en desarrollo o en el export de Pages.
// Uso: node scripts/capture-workspace.mjs [url] [carpeta]
//   desarrollo: node scripts/capture-workspace.mjs http://localhost:8081 artifacts/visual-qa/dev
//   Pages:      node scripts/capture-workspace.mjs http://127.0.0.1:8082/NoutyNotes/ artifacts/visual-qa/pages
// Requiere el servidor correspondiente en marcha; no publica ni modifica datos del proyecto.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:8081';
const destination = resolve(process.argv[3] ?? 'artifacts/visual-qa');
await mkdir(destination, { recursive: true });
// Se espera a que carguen las imágenes (p. ej., la marca que aparece al pasar a menos de 1100 px):
// sin esto, desarrollo y Pages podían diferir solo por el momento de la captura.
const shot = async (page, name) => {
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.screenshot({ path: resolve(destination, `${name}.png`) });
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ colorScheme: 'light' });
  const button = (name) => page.getByRole('button', { name, exact: true });
  // Búsqueda local con filtro de etiqueta (ADR 0019): hoja en móvil, modal desde 800 px.
  const searchShots = async (theme) => {
    for (const [size, width, height] of [['mobile', 390, 844], ['tablet', 900, 900], ['desktop', 1366, 900]]) {
      await page.setViewportSize({ width, height });
      await button('Abrir la búsqueda').click();
      await page.getByTestId('search-input').fill('#plan');
      await page.getByTestId('search-result-tarjeta-2').waitFor();
      await shot(page, `search-${size}-${theme}`);
      await page.keyboard.press('Escape');
      await page.getByTestId('search-panel').waitFor({ state: 'detached' });
    }
  };
  // Biblioteca de assets (ADR 0022): en móvil se abre desde «Más».
  const assetsShots = async (theme) => {
    for (const [size, width, height] of [['mobile', 390, 844], ['tablet', 900, 900], ['desktop', 1366, 900]]) {
      await page.setViewportSize({ width, height });
      // Se decide por el ancho y se espera a que el diseño cambie: justo tras redimensionar aún está la barra anterior.
      const more = button('Más secciones');
      if (width < 800) await more.click();
      else await more.waitFor({ state: 'detached' });
      await button('Abrir los assets').click();
      await page.getByTestId('assets-count').filter({ hasText: 'ARCHIVO' }).waitFor();
      await shot(page, `assets-${size}-${theme}`);
      await page.keyboard.press('Escape');
      await page.getByTestId('assets-panel').waitFor({ state: 'detached' });
    }
  };
  await page.goto(base);
  await button('Tema claro').click();

  // Estado vacío: el lienzo invita a crear la primera nota, sin inspector vacío.
  await page.getByLabel('Nombre del nuevo espacio').fill('Estudio de ideas');
  await button('Crear un espacio').click();
  await page.getByTestId('board-empty').waitFor();
  for (const [name, width, height] of [['empty-mobile-light', 390, 844], ['empty-desktop-light', 1366, 900]]) {
    await page.setViewportSize({ width, height });
    await shot(page, name);
  }

  // Tablero con título flotante, checklist e imagen de ejemplo; la nota queda seleccionada.
  await button('Añadir título flotante').click();
  await page.getByLabel('Título de la tarjeta').fill('Estudio de ideas');
  await button('Guardar texto').click();
  await button('Añadir nota').click();
  await page.getByLabel('Título de la tarjeta').fill('Próximos pasos');
  await page.getByLabel('Contenido Markdown').fill('- [x] Definir el concepto\n- [ ] Reunir referencias\n- [ ] Preparar la primera versión');
  await button('Guardar texto').click();
  // Imagen intercalada en la nota (ADR 0021): la ficha muestra texto e imagen en orden.
  await page.getByLabel('Contenido Markdown').press('Control+End');
  const chooser = page.waitForEvent('filechooser');
  await button('Insertar una imagen en la nota').click();
  await (await chooser).setFiles(fileURLToPath(new URL('../apps/noutynotes/assets/branding/app-icon.png', import.meta.url)));
  await page.getByText('insertada en la nota').waitFor();
  for (const tag of ['plan', 'Ideas']) {
    await page.getByTestId('tag-input').fill(tag);
    await button('Añadir la etiqueta').click();
    await button(`Quitar la etiqueta ${tag.toLowerCase()}`).waitFor();
  }
  await button('Añadir imagen de ejemplo').click();
  // Tarjeta de enlace (ADR 0020): dominio y ruta, sin vista previa descargada.
  await button('Añadir enlace').click();
  await page.getByTestId('link-url-input').fill('ejemplo.com/referencias');
  await page.getByTestId('link-title-input').fill('Referencias');
  await button('Crear enlace').click();
  await page.getByTestId('link-dialog').waitFor({ state: 'detached' });
  await button('Cerrar el editor de la tarjeta').click();
  await page.getByTestId('card-tarjeta-2').click();
  for (const [name, width, height] of [['desktop-light', 1366, 900], ['tablet-light', 900, 900], ['mobile-light', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await shot(page, name);
  }
  await searchShots('light');
  await assetsShots('light');

  // Oscuro explícito y Sistema (sigue al sistema operativo, aquí oscuro).
  await page.setViewportSize({ width: 1366, height: 900 });
  await button('Volver a mis espacios').click();
  await button('Tema oscuro').click();
  await button('Abrir Estudio de ideas').click();
  for (const [name, width, height] of [['desktop-dark', 1366, 900], ['tablet-dark', 900, 900], ['mobile-dark', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await shot(page, name);
  }
  await searchShots('dark');
  await assetsShots('dark');
  await page.setViewportSize({ width: 1366, height: 900 });
  await button('Volver a mis espacios').click();
  await button('Tema sistema').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await button('Abrir Estudio de ideas').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'mobile-system-dark');

  // Error honesto: al recargar, el espacio en memoria ya no existe.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await page.getByTestId('workspace-missing').waitFor();
  await shot(page, 'missing-mobile');
  await page.close();
} finally {
  await browser.close();
}
console.log(destination);
