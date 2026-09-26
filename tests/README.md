# Pruebas compartidas

`smoke/` contiene las comprobaciones Playwright en escritorio y móvil: el inicio (`home.spec.ts`) y el prototipo del workspace (`workspace.spec.ts`), con auxiliares comunes en `support.ts`. `contracts/` comprueba reglas que cruzan módulos; por ahora, que el dominio solo importa módulos propios y no usa reloj, aleatoriedad, plataforma ni I/O. `integration/` contiene pruebas que cruzan módulos: grilla, relaciones y plantillas sobre workspaces completos, y el formato de archivos frente a fixtures. `fixtures/templates/` guarda las plantillas GDD, Storyboard y Research. `fixtures/workspace-v1/` es la salida canónica exacta del formato v1, escrita a mano. `fixtures/workspace-v1-edited/` es el mismo workspace editado a mano (comentarios, comillas, CRLF, README y un asset de texto). Estos fixtures dependen de bytes exactos; `.gitattributes` evita que Git convierta sus finales de línea. `e2e/` queda reservado; los flujos del prototipo viven en `smoke/` para ejecutarse igual en desarrollo y en el export de Pages. `integration/workspace-editing.test.ts` recorre los casos de uso del prototipo con MemoryStorage real. `contracts/storage-boundaries.test.ts` comprueba que storage solo usa los API públicos del dominio y de application, `yaml` y `zod`; `contracts/application-boundaries.test.ts`, que application solo depende del dominio. `contracts/workspace-storage-contract.ts` es la suite reutilizable de `WorkspaceStorage`: cada adaptador la ejecuta con su fábrica (hoy, `memory-storage.contract.test.ts`).

Las pruebas unitarias están junto a la lógica correspondiente, en `packages/domain/src/**` y `packages/ui/src/**`. Desde la raíz: `pnpm test` y `pnpm test:smoke`. Chromium se instala una vez con `pnpm exec playwright install chromium`.

El smoke mide la geometría desde la carga inicial, antes de pulsar botones o redimensionar. Comprueba la posición relativa de la introducción y del panel de acciones, su reparto del ancho, el margen de página y el tamaño del título. Lo repite tras cambiar de tema, recargar y redimensionar en ambos sentidos. En escritorio también comprueba el límite de 799/800 px y el HTML servido sin JavaScript, que es compacto a propósito. En ambos perfiles verifica la accesibilidad básica: orden de tabulación, activación con Enter y Espacio, foco visible y controles de al menos 44 px. Las aserciones reintentan hasta cumplirse; no hay esperas fijas.

Capturas y trazas se escriben en `artifacts/playwright/`. Ver los [comandos de validación](../README.md#validar). La estrategia detallada de trabajo se mantiene localmente en `Docs/testing.md`, fuera del repositorio.

Para comprobar la versión estática bajo `/NoutyNotes/`: `pnpm build:pages` y `pnpm test:pages`. Se ejecutan las mismas pruebas contra un servidor local de archivos exportados, sin arrancar Metro, así que desarrollo y export deben cumplir las mismas expectativas con el mismo viewport y tema. Las capturas quedan en `artifacts/playwright-pages/`. El puerto 8082 debe estar libre. Ver [GitHub Pages](../README.md#github-pages).

`smoke/folder-disk.spec.ts` recorre la carpeta web sobre archivos reales del disco: reemplaza `showDirectoryPicker` y crea objetos propios de directorio, archivo, permiso y escritura que llaman a `node:fs` mediante `window.__disk`, confinados a su carpeta `notes`. Hay regresiones de rutas hostiles y de sus bordes: `""` es la raíz, «/» se rechaza y `...txt` es un nombre válido. No ejercita el selector, los permisos ni los handles nativos de Chrome; `folder-native-api.spec.ts` (OPFS) sí usa handles nativos. Sus archivos quedan en la carpeta de salida de Playwright.

Fase 9:
- `smoke/zip.spec.ts` recorre el fallback ZIP con `showDirectoryPicker` retirado;
- `smoke/offline.spec.ts` comprueba el arranque sin conexión y solo se ejecuta contra el export de Pages;
- los ZIP de entrada se construyen con `packages/storage/src/__fixtures__/zip.ts`, un constructor independiente del lector;
- `integration/workspace-archive.test.ts` y `contracts/archive-storage.contract.test.ts` cubren `ArchiveStorage`.

Fase 10:
- `contracts/document-tree-storage.contract.test.ts` ejecuta la suite de `WorkspaceStorage` sobre `DocumentTreeFolderPort`;
- `integration/web-android-equivalence.test.ts` comprueba que el mismo fixture con asset binario produce los mismos bytes en Android, carpeta web y ZIP;
- `integration/android-saf-cost.test.ts` limita los listados SAF por operación, e `integration/android-permissions.test.ts` comprueba los permisos bloqueados;
- `integration/android-folder-session.test.ts` cubre elegir y reabrir carpetas en Android: la carpeta se recuerda solo tras leerse bien y solo se olvida con pérdida de acceso confirmada;
- la validación en emulador es manual y está registrada en `Docs/progress.md`.

Auditoría de fase 9: `pnpm test:firefox` (`playwright.firefox.config.ts`) ejecuta `smoke/` contra el export en Firefox. `repro/firefox-beforeunload-reload.mjs` es una reproducción mínima manual, fuera de las suites, del comportamiento de Firefox bajo Playwright tras cancelar un `beforeunload`.

Experiencia del workspace (ADR 0013):
- `smoke/workspace.spec.ts` recorre:
  - el estado vacío, crear, editar y conectar (herramienta e inspector);
  - arrastrar con ratón (vista previa, imán, colisión, límites, Escape) y asas;
  - táctil real con eventos touch de Chromium (solo perfil móvil);
  - Mano, zoom, grilla y lista, tableros y espacios;
  - la distribución a 390, 768, 799, 800, 1024 y 1366 px en ambos sentidos, y la accesibilidad.
- `smoke/folder.spec.ts` comprueba que arrastrar en carpeta reescribe `layout.yaml` y que un destino inválido no cambia ningún byte.
- `smoke/zip.spec.ts` comprueba el fixture v1 con dos tableros y una tarjeta sin posición.
- `integration/workspace-boards.test.ts` cubre los casos de uso de tableros.

Lienzo, listas y títulos (ADR 0017, ADR 0018):
- `smoke/cards.spec.ts`:
  - «Restablecer vista» con selección;
  - foco que revela sin scroll nativo;
  - listas con teclado, casilla táctil y HTML/JS como texto;
  - título flotante con Papelera.
- `smoke/folder.spec.ts`:
  - posiciones negativas y lejanas reabiertas;
  - pintado con números pequeños a x = 999 000.
- Los arrastres mantienen el puntero dentro de la ventana (Firefox lo fija en el borde).
- `tapCard` espera al foco real antes de pulsar Espacio.
- `sideBySide` coloca dos tarjetas lado a lado cuando la prueba lo necesita.

Controles de tarjeta y proyectos (ADR 0016):
- `smoke/cards.spec.ts` comprueba los controles de cabecera, la ficha con icono, el menú `⋯` y los 44 px con el zoom alejado;
- `smoke/workspace.spec.ts` comprueba las pestañas y la hoja de proyectos;
- `smoke/folder.spec.ts` comprueba que el borrador se guarda al cambiar de proyecto.

Los arrastres por cabecera agarran la franja izquierda, que los controles dejan libre.

Configuración, representación, imágenes y Papelera (ADR 0014, ADR 0015):
- `smoke/cards.spec.ts`:
  - Configuración: modal o hoja, cambios al instante, restablecer, Escape y preferencias del dispositivo tras recargar;
  - minimizar, contraer y expandir con colisión y reubicación elegida;
  - imagen real: vista previa, archivo inválido, cancelación y ejemplo aparte;
  - Papelera;
  - regresión del foco: una tarjeta fuera de la vista se muestra con el pan, nunca con scroll nativo.
- `smoke/folder.spec.ts` y `zip.spec.ts`: la imagen, la ficha minimizada y la Papelera sobreviven a recargar y a reimportar el ZIP; eliminar definitivamente borra el binario.
- `integration/cards-trash-display.test.ts` y `image-assets.test.ts`: reserva de IDs, fallo inyectado sin borrado parcial, persistencia en carpeta, colisión al expandir, validación y compensación de assets.
- `contracts/platform-files.test.ts`: un `.android.ts` no importa valores de su propio nombre base.
- En las pruebas de humo, `tapCard` activa con el teclado (foco y Espacio) las tarjetas que el pan o la barra de acciones pueden dejar fuera de la vista o tapadas.
