# Interfaz compartida

Paquete interno `@noutynotes/ui`, consumido por la app a través de `workspace:*`. Exporta tokens semánticos, `ThemeProvider`, `useTheme` y el resolvedor de preferencia de tema.

`useSystemTheme.ts` observa el tema nativo. `useSystemTheme.web.ts` usa `matchMedia` y `useSyncExternalStore`, con un snapshot de servidor estable. Metro selecciona la implementación según plataforma. La preferencia se guarda en memoria; no escribe archivos ni almacenamiento del navegador.

Las pruebas unitarias comprueban precedencia de preferencias, fallback y contraste de texto. Las pruebas web verifican cambios efectivos de tema, incluida la reacción al sistema.

Sin reglas de dominio ni lectura de archivos. La estética editorial/retro se adapta a touch y accesibilidad. Las referencias privadas no se distribuyen como assets del producto.
