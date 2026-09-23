# Aplicación NoutyNotes

App Expo SDK 57 con React Native Web, Android y Expo Router. Entrada: `expo-router/entry`; rutas en `src/app/`; pantalla de bienvenida en `src/home/`.

Desde la raíz: `pnpm web` para desarrollo web y `pnpm android` para compilar/instalar en un destino Android configurado. Ver [comandos y validación](../../README.md).

La pantalla permite cambiar el tema; las acciones de workspace aún no están disponibles. Los colores y la medida de ventana (`useWindowWidth`, compatible con la hidratación del export estático) vienen de `@noutynotes/ui`. No usa todavía el dominio ni tiene reglas de grilla o persistencia.

`android/` es generado por Expo y está excluido del control de versiones. No editarlo como fuente canónica; futuros cambios nativos deben declararse en la configuración/plugins correspondientes.
