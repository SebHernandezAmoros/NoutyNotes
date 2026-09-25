// Reproducción mínima (auditoría de fase 9), sin NoutyNotes: en Firefox bajo Playwright,
// location.reload() no recarga después de cancelar un beforeunload, aunque se quite el escuchador;
// en Chromium sí. Uso: node tests/repro/firefox-beforeunload-reload.mjs (requiere Firefox de Playwright).
import { createServer } from 'node:http';
import { chromium, firefox } from '@playwright/test';

let loads = 0;
const server = createServer((request, response) => {
  loads += 1;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><title>carga ${loads}</title><button id="b">x</button><script>
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    window.quitar = () => window.removeEventListener('beforeunload', warn);
  </script>`);
});
await new Promise((resolve) => server.listen(8093, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, type] of [['firefox', firefox], ['chromium', chromium]]) {
    const browser = await type.launch();
    const page = await browser.newPage();
    page.on('dialog', (dialog) => { results.push(`${name}: diálogo ${dialog.type()}`); void dialog.dismiss(); });
    await page.goto('http://127.0.0.1:8093/');
    await page.click('#b'); // activación de usuario, necesaria para beforeunload
    const before = await page.title();
    void page.evaluate(() => window.location.reload());
    await page.waitForTimeout(1000);
    results.push(`${name}: tras cancelar sigue en «${await page.title()}» (antes «${before}»)`);
    await page.evaluate(() => window.quitar());
    await page.evaluate(() => window.location.reload()).catch(() => undefined);
    await page.waitForTimeout(1500);
    results.push(`${name}: tras quitar el escuchador y recargar: «${await page.title()}»`);
    await browser.close();
  }
} finally {
  console.log(results.join('\n'));
  server.close();
}
