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
- `src/workspace/canvas/cardChrome.ts` (puro): acciones y posición de los controles en píxeles de pantalla. `CardControls.tsx` los dibuja fuera de la escala del zoom, junto con el menú `⋯`, y `CardIcon.tsx` dibuja el catálogo portable de iconos;
- `src/workspace/ProjectTabs.tsx`: pestañas verticales de proyectos (≥ 800 px) y hoja «Proyectos» en móvil. Cambiar de proyecto guarda antes el borrador.

ADR 0046 conecta el interruptor de imán con el contrato persistente: activo usa celdas completas y desactivado cuartos de celda. `WorkspaceScreen` ofrece el selector de icono y el diálogo «Tablero» para crear una tarjeta que abre otro tablero, sin código de filesystem en la interfaz.

Configuración y fechas (ADR 0029):
- `ThemeProvider` (`@noutynotes/ui`) recibe `load` y `save`; la app los implementa en `session/viewPreferencesStore(.android).ts`. Se lee con `useSyncExternalStore`: al hidratar el export estático vale «system» y después lo guardado, sin errores de hidratación.
- `src/workspace/dates.ts`: «26 sep 2026» y «Creada el …, HH:MM» con `localDay`/`localTime`, sin `Intl`.

Idioma de la interfaz (ADR 0032):
- `packages/ui/src/externalPreference.ts` (puro): almacén get/set/subscribe compartido por `ThemeProvider` y el nuevo `LocaleProvider` (menos duplicación). `apps/noutynotes/src/i18n.ts` (puro): diccionario `es`/`en` y `t(key, locale)`; una prueba comprueba que ninguna clave se queda sin su pareja. Traducido: `Toolbar.tsx`, la navegación de `WorkspaceScreen.tsx` (barra lateral y «Más»), `SettingsPanel.tsx` completo y el botón «Cerrar» genérico de `Dialog.tsx` (para no mezclar idiomas dentro de un mismo panel).

Imprimir y presentar (ADR 0031):
- `packages/application/src/print.ts` (puro): `printableDocument(workspace, boardId)` en orden de lectura (fila, columna; la huella cuenta para minimizadas/contraídas), con imágenes propias o intercaladas sin duplicar y conexiones en texto.
- `src/workspace/printHtml.ts` (puro): documento HTML propio, todo el texto del usuario escapado (nunca se ejecuta, igual que en las notas). `src/workspace/PresentView.tsx`: diapositivas a pantalla completa, montado solo mientras está abierto (empieza siempre en la primera). `printBoard()` en `WorkspaceScreen` abre una pestaña (`window.open` + `document.write` + `print()`), solo en web.

Tipografía de las notas (ADR 0030):
- `src/workspace/fonts.ts` (puro): `noteFontFamily(font, platform)` resuelve la pila por plataforma; «Sistema» no fija ninguna. `noteFont` se añadió a `ViewPreferences`. `CanvasCard`, `NotePreview` y el campo «Contenido Markdown» del editor reciben la familia ya resuelta.

Vista general (ADR 0028):
- `src/workspace/canvas/overview.ts` (puro): límites del contenido, `fitView` (reserva el alto de los controles), minimapa ↔ mundo y `cardsInArea`. `CanvasOverview.tsx` dibuja los controles y el minimapa con `zIndex` por encima de los controles de tarjeta. El fondo del lienzo usa un PanResponder: toque → cerrar; arrastre → rectángulo.

Marcos (ADR 0027):
- `src/workspace/canvas/CanvasFrame.tsx`: marco bajo las tarjetas; su título selecciona (toque) o mueve (arrastre, `FrameGestures` en `Canvas`, con `checkFrameMove` para la vista previa). `FrameInspector.tsx` ocupa el sitio del editor de la tarjeta (panel o hoja). Al seleccionar un marco, el lienzo revela su título.

Deshacer y rehacer (ADR 0026):
- `useWorkspaceEditor`: el último workspace leído es el «antes» de la siguiente acción; tras el éxito, el recargado es el «después». `run(action, success, { history: 'clear' | 'record', mergeKey })`. `undo`/`redo` usan `revertWorkspace`, que no toca nada si lo guardado cambió. `revision` vuelve a montar el editor de la tarjeta tras deshacer, para que su borrador local muestre lo guardado.

Selección múltiple (ADR 0025):
- `WorkspaceScreen`: estado `multi` y barra `multi-bar`; `Canvas` arrastra el conjunto (`Gesture.group`, `checkMoveMany`) y atiende Ctrl + clic con un `click` nativo en captura, porque el sistema de respuesta de RN Web descarta las pulsaciones con Ctrl o Alt.

Diario (ADR 0024):
- `src/workspace/DailyLogPanel.tsx`: día con ←, Hoy y →, fecha exacta, resumen, entradas editables, cronología de creadas y archivadas con «Ir» y calendario del mes. `WorkspaceScreen` pasa la hora actual y el desfase de la zona; `application` no usa el reloj.

Notas con imágenes y editor enfocado (ADR 0021):
- `src/workspace/NoteBlocksEditor.tsx` («Contenido en orden») dentro de `CardInspector`; insertar y reemplazar usan `addNoteImage`;
- `src/workspace/canvas/NotePreview.tsx`: bloques de la nota en la ficha; `useImagePreviews` devuelve `{ cards, refs }`;
- el doble toque lo detecta el controlador de `Canvas` (`tapCard`); el modo enfocado es el estado `focus` de `WorkspaceScreen`.

Búsqueda global y enlaces (ADR 0020):
- `src/workspace/LinkDialog.tsx` (nuevo enlace) y `openLink.ts` (abre con `Linking` solo direcciones admitidas);
- `SearchPanel.tsx`: alcance «Este proyecto» o «Todos»; la búsqueda global se lanza con Enter o con el botón;
- `WorkspaceScreen`: el parámetro `card` de la ruta revela la tarjeta al llegar desde otro proyecto, y el aviso `place-offer` coloca una tarjeta sin posición;
- `src/components/useKeyboardInset.ts`: teclado de Android con edge-to-edge (ADR 0019).

Etiquetas y búsqueda (ADR 0019):
- `src/workspace/SearchPanel.tsx`: panel «Buscar en este proyecto» (`Dialog`) con los resultados de `searchWorkspace`, chips de etiquetas con recuento que activan o quitan el filtro, y renombrar o quitar de todas con confirmación;
- `CardInspector.tsx` (sección ETIQUETAS) y `canvas/CanvasCard.tsx` (pie con hasta tres etiquetas; el texto cede sus líneas para que el pie no se corte).

Configuración, representación, imágenes y Papelera (ADR 0014, ADR 0015):
- `src/components/Dialog.tsx`: modal centrado desde 800 px u hoja inferior en móvil; cierra con Escape (web) o atrás (Android);
- `src/workspace/SettingsPanel.tsx` («Lienzo y grilla») y `canvas/preferences.ts` (límites y `metricsFor`, puros). Las preferencias se guardan en `src/session/viewPreferencesStore(.android).ts`, fuera del workspace;
- `src/workspace/TrashPanel.tsx`: restaurar y eliminar definitivamente con confirmación;
- `src/session/imageFiles(.android).ts` elige el archivo (`<input type=file>` o `File.pickFileAsync`), con las constantes en el módulo neutro `imageTypes.ts`. Un `x.android.ts` no puede importar valores de `./x`, porque Metro lo resuelve a sí mismo;
- `src/workspace/useImagePreviews.ts` y `dataUri.ts`: vista previa sin red;
- en web, el lienzo deshace el scroll nativo, y una tarjeta enfocada con el teclado se muestra con `panToReveal` (`canvas/viewport.ts`).
