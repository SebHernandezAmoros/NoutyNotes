# NoutyNotes

**Un lugar para tus ideas.**

NoutyNotes es un proyecto de espacio visual para organizar notas Markdown, imágenes, tarjetas y relaciones sobre una grilla. Su objetivo es funcionar con archivos locales y compartir un mismo núcleo entre web y Android.

> **En desarrollo inicial.** Hay un prototipo navegable: crear espacios, añadir notas e imágenes de ejemplo, editar su texto, moverlas, redimensionarlas y conectarlas. Puede usar memoria temporal o elegir una carpeta local en un navegador compatible para guardar archivos. La integración de carpetas sigue en validación; las plantillas aún no tienen interfaz.

![Pantalla inicial de NoutyNotes en tema claro](assets/readme/home-light.png)

## Estado actual

Las fases 0B–7 están implementadas y la fase 8, carpetas web, está en curso. El núcleo valida datos, transforma layouts, gestiona relaciones y crea workspaces desde plantillas GDD, Storyboard y Research. Las plantillas se importan/exportan como JSON en memoria. Los workspaces se convierten en archivos Markdown/YAML v1 mediante `@noutynotes/storage`. El prototipo usa casos de uso de `@noutynotes/application`; al elegir una carpeta, guarda allí los espacios creados. Sin carpeta, usa `MemoryStorage` y se pierden al recargar. Tras recargar hay que seleccionar de nuevo la misma carpeta para reconectar. Aún no hay selector de plantillas en la interfaz.

| Disponible | Pendiente |
| --- | --- |
| App Expo con navegación mediante Expo Router | Validación final del selector con carpeta real |
| Prototipo: crear espacios, tarjetas, texto, mover, redimensionar y conectar | Vista previa de Markdown e imágenes reales |
| Inicio y tablero responsive; temas claro, oscuro y del sistema | Arrastre y gestos, selector de plantillas |
| Dominio, grilla, relaciones y plantillas declarativas probadas | Importación/exportación ZIP |
| Formato de archivos v1 Markdown/YAML, memoria y adaptador de carpetas web | Almacenamiento Android |
| TypeScript estricto, lint y pruebas automatizadas | Ejecución Android verificada y arranque web sin conexión |
| Export web, bundle Android y proyecto nativo generado | |

La preferencia de tema y los espacios de memoria duran la sesión actual. «Abrir una carpeta» se habilita en navegadores compatibles después de cargar la página; «Usar una plantilla» sigue desactivado. Hay una [demo inicial en GitHub Pages](https://sebhernandezamoros.github.io/NoutyNotes/), cuyo contenido público puede ir detrás de esta copia local; todavía no hay un APK validado.

## Tecnologías

| Herramienta | Versión |
| --- | --- |
| Node.js | 24.11 o posterior de la rama 24 |
| Gestor de paquetes | pnpm 11.17.0 |
| Expo | SDK 57 |
| React Native / React | 0.86.3 / 19.2.3 |
| TypeScript | 6.0 |
| Calidad | ESLint, Vitest y Playwright |

Las versiones concretas están fijadas en los manifiestos y en `pnpm-lock.yaml`. El proyecto usa pnpm workspaces y un único lockfile.

## Ejecutar

Requisitos: Node.js y pnpm en las versiones indicadas. Desde una copia del repositorio, ejecutar en la raíz:

```sh
pnpm install --frozen-lockfile
pnpm web
```

Abrir la dirección indicada por Expo, normalmente `http://localhost:8081`. Detener el servidor con `Ctrl+C`. Si el puerto está ocupado, usar `pnpm web --port 8082`.

### Android

Se necesita Android Studio, SDK, Java y un emulador o dispositivo configurados:

```sh
pnpm android:prepare
pnpm android
```

`android:prepare` genera o actualiza el proyecto nativo sin limpiarlo ni instalar dependencias. `android` compila e intenta instalar la app, y puede descargar herramientas adicionales.

Se verificaron la generación del proyecto nativo y el bundle Hermes. La compilación e instalación de un APK en dispositivo o emulador siguen pendientes de validación.

## Validar

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:smoke
pnpm build:pages
pnpm test:pages
pnpm build:web
pnpm build:android:bundle
pnpm android:prepare
```

Chromium se instala una vez por entorno; en Linux puede requerir también sus dependencias del sistema. Playwright inicia el servidor web durante las pruebas; no hace falta iniciarlo manualmente.

| Comando | Qué comprueba o genera |
| --- | --- |
| `pnpm check` | Lint, TypeScript y pruebas unitarias |
| `pnpm lint` | ESLint sin avisos permitidos |
| `pnpm typecheck` | Tipos de paquetes, pruebas y aplicación |
| `pnpm test` | Pruebas unitarias del dominio, grilla, relaciones, plantillas y formato de archivos; integración con fixtures; fronteras del núcleo y de storage; temas, contraste y breakpoint |
| `pnpm test:smoke` | Web en escritorio y móvil: inicio, tablero y flujo de carpetas con un doble de File System Access y con handles reales de Origin Private File System; también borradores pendientes, accesibilidad y responsive |
| `pnpm build:pages` y `pnpm test:pages` | Export bajo `/NoutyNotes/` y el mismo flujo funcional/visual servido desde sus archivos estáticos |
| `pnpm build:web` | Export estático en `apps/noutynotes/dist/` |
| `pnpm build:android:bundle` | JavaScript y assets en `apps/noutynotes/dist/android/`; no produce un APK |
| `pnpm android:prepare` | Proyecto nativo generado en `apps/noutynotes/android/` |

Ejecutar el bundle Android después del export web, porque este último regenera `dist/`. Las capturas y trazas de Playwright se guardan en `artifacts/playwright/`.

Para revisar la fase 8 en Chromium sobre `localhost`, crear una carpeta vacía de prueba y abrirla con «Abrir una carpeta». Crear un espacio, añadir una nota, editar su título y esperar el aviso de guardado. Verificar que aparecieron archivos `.nouty/workspace.yaml`, `.nouty/layout.yaml`, `.nouty/relations.yaml` y `cards/tarjeta-1.md` bajo un subdirectorio. Recargar: hay que volver a seleccionar la misma carpeta y reabrir el espacio; el título debe seguir allí. Editar de nuevo y cerrar inmediatamente el editor o volver al inicio: al reabrir, el texto debe persistir. Cambiar el manifiesto fuera de la app mientras el espacio está abierto y probar otra edición: debe mostrarse el conflicto, conservarse el cambio externo y mantenerse el borrador en el editor. Probar la cancelación del selector y el ancho de 390 px. Usar solo una carpeta desechable: **el selector del sistema y sus permisos en una carpeta visible siguen sin validación manual**, por lo que la fase 8 permanece en curso.

**Verificación local adicional del 24 de septiembre de 2026 (fase 8):** `pnpm check` pasó con 820 pruebas en 42 archivos. `test:smoke` y `test:pages` terminaron con salida 0, 33 pruebas correctas y 3 omisiones previstas cada uno; 34 capturas coincidieron entre desarrollo y Pages. Una regresión posterior de conflicto con borrador pasó en escritorio y móvil en ambos entornos. Los builds de Pages, web y bundle Android fueron correctos. Origin Private File System comprobó archivos con handles nativos de Chromium, pero no reemplaza la validación del selector físico. Detalle en `Docs/testing.md` (documentación local).

**Validación local registrada el 24 de septiembre de 2026 (fase 7):** lint y tipos correctos; 783 pruebas unitarias, de integración y de contrato; 19 pruebas web correctas en desarrollo y 19 en el export de Pages (3 casos se omiten a propósito en el perfil móvil), con capturas idénticas entre ambos; export de Pages, export web y bundle Android correctos. Estos resultados no equivalen a ejecución nativa Android.

El [workflow de GitHub Actions](.github/workflows/ci.yml) está preparado para ejecutar las comprobaciones en pushes y pull requests. Su ejecución remota todavía no se ha verificado.

## GitHub Pages

La configuración para publicar esta demo inicial está en [Deploy GitHub Pages](.github/workflows/pages.yml). El usuario confirmó la carga de la demo mediante una captura el 23 de septiembre de 2026 en `https://SebHernandezAmoros.github.io/NoutyNotes/`. Esa versión muestra una sola columna en escritorio. La causa se reprodujo y corrigió localmente: el HTML estático se genera sin conocer el ancho de la ventana y la hidratación conservaba sus estilos compactos. La pantalla ahora usa una medida compatible con la hidratación. Las pruebas locales comparan desarrollo y export con el mismo viewport y tema. El sitio público cambiará al publicar esta corrección.

El workflow instala con pnpm, ejecuta lint/tipos/tests, exporta con la ruta base `/NoutyNotes` y comprueba el resultado en escritorio y móvil antes de publicarlo. Los pushes a `main` publican automáticamente; los pull requests hacia `main` solo construyen y validan. También puede iniciarse manualmente desde Actions en `main`.

### Activar la publicación

1. Subir estos archivos a la rama `main` del repositorio.
2. En GitHub, abrir **Settings → Pages → Build and deployment → Source** y seleccionar **GitHub Actions**.
3. Abrir **Actions → Deploy GitHub Pages → Run workflow**, seleccionar `main` y ejecutar. Si el primer push falló porque Pages aún no estaba habilitado, repetir el workflow después de activarlo.
4. Esperar a que terminen correctamente los trabajos `build` y `deploy`, y abrir la URL del despliegue.

No se necesita una rama `gh-pages`, publicar `Docs/` ni añadir un token personal. Se utiliza el token del workflow con permisos de Pages y se sube únicamente `apps/noutynotes/dist/pages/`.

### Comprobar el export antes de subir

```sh
pnpm build:pages
pnpm test:pages
pnpm preview:pages
```

Para las pruebas se necesita Chromium instalado con `pnpm exec playwright install chromium`. `test:pages` ejecuta las mismas comprobaciones que `test:smoke` y solo arranca el servidor estático; no necesita Metro ni el puerto 8081. Antes de cargar JavaScript, el HTML estático muestra la versión compacta de una columna; la versión de escritorio aparece al hidratar, sin interacción. La vista previa abre un servidor en `http://127.0.0.1:8082/NoutyNotes/`; detenerlo con `Ctrl+C`. `test:pages` inicia y cierra su propio servidor, por lo que el puerto 8082 debe estar libre. Las capturas quedan en `artifacts/playwright-pages/`.

`build:pages` genera `apps/noutynotes/dist/pages/` y aplica la ruta base solo a ese proceso. El desarrollo local y el export web normal mantienen la ruta raíz. Ejecutar `build:pages` después de `build:web`, que regenera `dist/`. Si cambia el nombre del repositorio o se configura un dominio propio, ajustar la ruta en `apps/noutynotes/app.config.ts` y la vista previa correspondiente.

La versión pública puede ir detrás de la copia local. El export local incluye el prototipo y guardado en carpeta en navegadores compatibles; no se ha comprobado funcionamiento offline ni el selector físico en Pages. Configuración basada en las guías de [Expo](https://docs.expo.dev/guides/publishing-websites/#github-pages) y [GitHub Actions para Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Arquitectura

```text
apps/noutynotes/        App Expo, rutas y pantalla inicial
packages/domain/       Entidades, invariantes, validación y motor de grilla puros
packages/application/  Puerto WorkspaceStorage y casos de uso
packages/storage/      Formato de archivos v1, MemoryStorage y FolderStorage
packages/ui/           Tokens, temas y medida de ventana compartidos
tests/                 Smoke web, contratos, integración y fixtures del formato
assets/readme/         Capturas propias para esta documentación
```

Están activos la app, el paquete UI, el dominio y `@noutynotes/storage` (formato de archivos Markdown/YAML y adaptadores); la app usa application y el dominio, y su raíz de composición elige `MemoryStorage` o `FolderStorage` al seleccionar una carpeta. El dominio no depende de React, Expo, filesystem, red ni almacenamiento, y no genera identificadores ni fechas. Las tarjetas pertenecen al workspace; los boards las muestran por referencia, así que una tarjeta puede aparecer en varios. Las posiciones se guardan aparte, en unidades de grilla, y las relaciones no dependen de ellas. Las plantillas son solo datos. Ver [el README del dominio](packages/domain/README.md). Storage depende del API público del dominio y application, de `yaml` y de `zod`; el dominio no depende de storage. `@noutynotes/application` define el puerto `WorkspaceStorage` y los casos de uso, y solo depende del dominio. Ver [application](packages/application/README.md).

## Plan de trabajo

| Etapa | Alcance | Estado |
| --- | --- | --- |
| A — Fundaciones | Estructura, herramientas, inicio y temas | Completada |
| B — Núcleo | Dominio, grilla, relaciones y plantillas | Completada |
| C — Persistencia y prototipo | Serialización, almacenamiento en memoria y edición básica | Completada: serialización, almacenamiento en memoria y prototipo de interfaz |
| D — Web y Android | Carpetas, importación/exportación y persistencia nativa | Fase 8 en curso; 9–10 pendientes |
| E — Experiencia y calidad | Plantillas en UI, móvil, regresión y rendimiento | Pendiente |
| F — Publicación y v1 | Demo, documentación completa y release | Pendiente |

La visión del producto es trabajar con Markdown/YAML y assets portables como fuente de verdad, sin backend obligatorio, cuentas, plugins ejecutables ni Git integrado. El almacenamiento local y el funcionamiento sin conexión se implementarán y validarán en sus fases correspondientes.

## Contribuir

Mantener los cambios acotados a la fase actual, respetar los límites entre capas y ejecutar las comprobaciones relevantes antes de proponer un cambio. Para cambios de interfaz, revisar también escritorio, móvil y ambos temas. Actualizar este README cuando cambien los comandos o el comportamiento disponible.

La planificación detallada y la bitácora de trabajo se mantienen localmente en `Docs/`, excluido del repositorio. La aplicación no necesita esa carpeta para instalarse ni ejecutarse; este README contiene las instrucciones públicas.

## Licencia

[MIT](LICENSE).
