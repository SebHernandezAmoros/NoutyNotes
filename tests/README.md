# Pruebas compartidas

`smoke/` contiene la comprobación Playwright del inicio en escritorio y móvil. `fixtures/`, `contracts/`, `integration/` y `e2e/` permanecen reservados para las fases siguientes.

Los tests unitarios viven junto a la lógica correspondiente, empezando por `packages/ui/src/theme.test.ts`. Desde la raíz: `pnpm test` y `pnpm test:smoke`. Chromium se instala una vez con `pnpm exec playwright install chromium`.

Capturas y trazas se escriben en `artifacts/playwright/`. Ver los [comandos de validación](../README.md#validar). La estrategia detallada de trabajo se mantiene localmente en `Docs/testing.md`, fuera del repositorio.

Para comprobar la versión estática bajo `/NoutyNotes/`: `pnpm build:pages` y `pnpm test:pages`. Reutiliza las mismas pruebas contra un servidor local de archivos exportados; las capturas quedan en `artifacts/playwright-pages/`. El puerto 8082 debe estar libre. Ver [GitHub Pages](../README.md#github-pages).
