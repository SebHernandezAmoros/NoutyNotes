# Aplicación NoutyNotes

App Expo SDK 57 con React Native Web, Android y Expo Router. Entrada: `expo-router/entry`; rutas en `src/app/` (`/` y `/workspace?id=`); inicio en `src/home/`, tablero en `src/workspace/` y raíz de composición en `src/session/`.

Desde la raíz: `pnpm web` para desarrollo web y `pnpm android` para compilar/instalar en un destino Android configurado. Ver [comandos y validación](../../README.md).

Prototipo de fase 7 (ADR 0009, en `Docs/`): crear espacios y tarjetas, editar título y Markdown, mover, redimensionar y conectar. `WorkspaceSessionProvider` crea una única `MemoryStorage` por carga y la expone como el puerto `WorkspaceStorage`; es el único punto que importa `@noutynotes/storage`. Las pantallas despachan casos de uso de `@noutynotes/application` y no contienen reglas de negocio: límites, colisiones y relaciones los decide el dominio. Los datos se pierden al recargar y la interfaz lo indica. Los colores y la medida de ventana (`useWindowWidth`) vienen de `@noutynotes/ui`.

`android/` es generado por Expo y está excluido del control de versiones. No editarlo como fuente canónica; futuros cambios nativos deben declararse en la configuración/plugins correspondientes.
