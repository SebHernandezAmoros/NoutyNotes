# Aplicación NoutyNotes

App Expo SDK 57 con React Native Web, Android y Expo Router. Entrada: `expo-router/entry`; rutas en `src/app/` (`/` y `/workspace?id=`); inicio en `src/home/`, tablero en `src/workspace/` y raíz de composición en `src/session/`.

Desde la raíz: `pnpm web` para desarrollo web y `pnpm android` para compilar/instalar en un destino Android configurado. Ver [comandos y validación](../../README.md).

Prototipo de fase 7 (ADR 0009, en `Docs/`; en la fase 9 `ArchiveStorage` sustituyó a `MemoryStorage`, ver abajo): crear espacios y tarjetas, editar título y Markdown, mover, redimensionar y conectar. `WorkspaceSessionProvider` crea una única `MemoryStorage` por carga y la expone como el puerto `WorkspaceStorage`; es el único punto que importa `@noutynotes/storage`. Las pantallas despachan casos de uso de `@noutynotes/application` y no contienen reglas de negocio: límites, colisiones y relaciones los decide el dominio. Los datos se pierden al recargar y la interfaz lo indica. Los colores y la medida de ventana (`useWindowWidth`) vienen de `@noutynotes/ui`.

`android/` es generado por Expo y está excluido del control de versiones. No editarlo como fuente canónica; futuros cambios nativos deben declararse en la configuración/plugins correspondientes.

Fase 9 (ADR 0011):
- los espacios del navegador usan `ArchiveStorage`: «Importar un ZIP» y «Exportar ZIP», con aviso de cambios sin exportar y confirmación al salir o al abrir una carpeta. Iniciar la descarga no los da por guardados: siguen «SIN EXPORTAR» hasta que el usuario pulsa «Ya lo guardé» para esa misma revisión;
- `src/session/archiveFiles.ts` contiene el selector y la descarga, solo en web;
- `src/offline/registerOfflineWorker.ts` registra el worker del export para arrancar sin conexión;
- en Android, importar y exportar ZIP quedan ocultos hasta la fase 10.
