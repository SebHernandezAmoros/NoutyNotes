# Aplicación NoutyNotes

App Expo SDK 57 con React Native Web, Android y Expo Router. Entrada: `expo-router/entry`; rutas en `src/app/` (`/` y `/workspace?id=`); inicio en `src/home/`, tablero en `src/workspace/` y raíz de composición en `src/session/`.

Desde la raíz: `pnpm web` para desarrollo web y `pnpm android` para compilar/instalar en un destino Android configurado. Ver [comandos y validación](../../README.md).

Prototipo de fase 7 (ADR 0009, en `Docs/`; en la fase 9 `ArchiveStorage` sustituyó a `MemoryStorage`, ver abajo): crear espacios y tarjetas, editar título y Markdown, mover, redimensionar y conectar. `WorkspaceSessionProvider` crea una única `MemoryStorage` por carga y la expone como el puerto `WorkspaceStorage`; es el único punto que importa `@noutynotes/storage`. Las pantallas despachan casos de uso de `@noutynotes/application` y no contienen reglas de negocio: límites, colisiones y relaciones los decide el dominio. Los datos se pierden al recargar y la interfaz lo indica. Los colores y la medida de ventana (`useWindowWidth`) vienen de `@noutynotes/ui`.

`android/` es generado por Expo y está excluido del control de versiones. No editarlo como fuente canónica; futuros cambios nativos deben declararse en la configuración/plugins correspondientes.

Fase 9 (ADR 0011):
- los espacios del navegador usan `ArchiveStorage`: «Importar un ZIP» y «Exportar ZIP», con aviso de cambios sin exportar y confirmación al salir o al abrir una carpeta. Iniciar la descarga no los da por guardados: siguen «SIN EXPORTAR» hasta que el usuario pulsa «Ya lo guardé» para esa misma revisión;
- `src/session/archiveFiles.ts` contiene el selector y la descarga, solo en web;
- `src/offline/registerOfflineWorker.ts` registra el worker del export para arrancar sin conexión;
- en Android, importar y exportar ZIP siguen ocultos: Android usa carpetas (fase 10).

Fase 10 (ADR 0012):
- `src/session/androidFolder.android.ts` usa `expo-file-system` 57: selector SAF, permiso persistente y la última carpeta guardada en un archivo privado para «Reabrir»; `androidFolder.ts` es el sustituto vacío para web;
- `src/session/safTree.ts` adapta el SAF al contrato `DocumentTree` de storage (nombres visibles, verificación de lo creado y listados reutilizados), y `FolderStorage` hace el resto;
- `app.json` bloquea `READ/WRITE_EXTERNAL_STORAGE`, que el SAF no necesita.

Experiencia del workspace (ADR 0013):
- `src/workspace/WorkspaceScreen.tsx` compone la cabecera, la barra lateral (desde 1100 px), las pestañas de tableros, `Toolbar`, el lienzo o la vista de lista y el inspector (panel desde 800 px; hoja ocultable en móvil);
- `src/workspace/canvas/` contiene el lienzo (`Canvas`, `CanvasCard`) y su lógica pura: `geometry` (celdas ↔ píxeles, arrastre, asas, validación con el dominio), `viewport` (zoom y desplazamiento), `connect` (herramienta Conectar) y `boardCards` (tarjetas sin posición);
- los gestos usan `PanResponder` de React Native (ratón y táctil en web, táctil en Android), sin dependencias nuevas;
- `src/components/BrandMark.tsx` dibuja el símbolo de `assets/branding/mark-transparent.png` teñido por tema.

Lienzo en dos ejes, listas y pulido (ADR 0017, ADR 0018):
- `canvas/viewport.ts`:
  - `worldPan`, `visibleGridLines` (solo líneas visibles);
  - `visibleCells`: zona visible, donde se colocan las tarjetas nuevas;
  - `panToRevealWorld`;
  - `renderBase`: pintado respecto a una base cercana a la cámara, porque lejos del origen la coma flotante de 32 bits del compositor pintaba mal.
- `Canvas`:
  - revela la tarjeta seleccionada al seleccionarla, moverla o redimensionarla, pero no con el zoom ni al guardar;
  - deshace el scroll nativo;
  - anula `dragstart` y no admite selección de texto.
- `src/workspace/markdownLists.ts` (puro): comandos de lista, Enter, renumeración por nivel (con el número inicial al borrar el primero), casillas y extracto como texto seguro.
- **Pantalla:**
  - desde 800 px, el estado del ZIP y «Exportar ZIP» van en la cabecera;
  - desde 1100 px, el aviso ocupa el final de la barra de herramientas;
  - la hoja móvil del editor tiene una sola barra (`CardInspector` con `inSheet`).

Controles de tarjeta y proyectos (ADR 0016):
- `src/workspace/canvas/cardChrome.ts` (puro): acciones y posición de los controles en píxeles de pantalla. `CardControls.tsx` los dibuja fuera de la escala del zoom, junto con el menú `⋯`, y `CardIcon.tsx` dibuja los iconos de nota e imagen;
- `src/workspace/ProjectTabs.tsx`: pestañas verticales de proyectos (≥ 800 px) y hoja «Proyectos» en móvil. Cambiar de proyecto guarda antes el borrador.

Configuración, representación, imágenes y Papelera (ADR 0014, ADR 0015):
- `src/components/Dialog.tsx`: modal centrado desde 800 px u hoja inferior en móvil; cierra con Escape (web) o atrás (Android);
- `src/workspace/SettingsPanel.tsx` («Lienzo y grilla») y `canvas/preferences.ts` (límites y `metricsFor`, puros). Las preferencias se guardan en `src/session/viewPreferencesStore(.android).ts`, fuera del workspace;
- `src/workspace/TrashPanel.tsx`: restaurar y eliminar definitivamente con confirmación;
- `src/session/imageFiles(.android).ts` elige el archivo (`<input type=file>` o `File.pickFileAsync`), con las constantes en el módulo neutro `imageTypes.ts`. Un `x.android.ts` no puede importar valores de `./x`, porque Metro lo resuelve a sí mismo;
- `src/workspace/useImagePreviews.ts` y `dataUri.ts`: vista previa sin red;
- en web, el lienzo deshace el scroll nativo, y una tarjeta enfocada con el teclado se muestra con `panToReveal` (`canvas/viewport.ts`).
