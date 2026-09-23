# Interfaz compartida

Paquete interno `@noutynotes/ui`, consumido por la app a través de `workspace:*`. Exporta tokens semánticos, `ThemeProvider`, `useTheme` y el resolvedor de preferencia de tema.

También exporta `useWindowWidth` y `resolveLayoutMode`. La distribución es amplia desde 800 px y compacta por debajo, o mientras no se conoce el ancho. `useWindowWidth` usa `useSyncExternalStore` con un snapshot de servidor `null`. Así el HTML estático y la hidratación coinciden, y justo después React vuelve a renderizar con la medida real. Con `useWindowDimensions`, la hidratación conservaba los estilos compactos del export estático.

`useSystemTheme.ts` observa el tema nativo. `useSystemTheme.web.ts` usa `matchMedia` y `useSyncExternalStore`, con un snapshot de servidor estable. Metro selecciona la implementación según plataforma. La preferencia se guarda en memoria; no escribe archivos ni almacenamiento del navegador.

Las pruebas unitarias comprueban precedencia de preferencias, fallback y contraste de texto. Las pruebas web verifican cambios efectivos de tema, incluida la reacción al sistema.

Sin reglas de dominio ni lectura de archivos. La estética editorial/retro se adapta a touch y accesibilidad. Las referencias privadas no se distribuyen como assets del producto.
