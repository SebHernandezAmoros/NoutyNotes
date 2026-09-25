# Persistencia

Paquete `@noutynotes/storage`: formato de archivos v1 de NoutyNotes. Convierte workspaces y plantillas del dominio en archivos de texto en memoria (`TextFiles`: ruta relativa → texto) y viceversa. Los codecs son síncronos y puros: no leen ni escriben disco, no usan red ni UI y no generan fechas ni valores aleatorios. Sobre ellos, `MemoryStorage` implementa el puerto `WorkspaceStorage` de `@noutynotes/application` (fase 6). `FolderStorage` (carpetas web, fase 8) y `ArchiveStorage` (espacios del navegador con ZIP, fase 9, aceptación manual pendiente) implementan el mismo puerto; el adaptador Android llegará en la fase 10.

Depende del API público de `@noutynotes/domain` y `@noutynotes/application`, de `yaml` (YAML real), de `zod` (sobres y frontmatter con claves cerradas) y de `fflate` (inflado y deflado ZIP). Las invariantes semánticas las sigue validando el dominio.

## API

| Función | Resultado |
| --- | --- |
| `serializeWorkspace(workspace, previousFiles?)` | `TextFiles` del paquete de workspace |
| `parseWorkspace(files)` | `Workspace` validado |
| `serializeTemplate(template, previousFiles?)` | `template.yaml` y `README.md` opcional |
| `parseTemplate(files)` | `Template` validada |
| `serializeRelations` / `parseRelations`, `serializeLayouts` / `parseLayouts` | Documentos `.nouty/relations.yaml` y `.nouty/layout.yaml` |
| `assetRefToMarkdownLink(fromFile, assetRef)` / `markdownLinkToAssetRef(fromFile, href)` | Conversión explícita entre ruta desde la raíz y enlace relativo codificado |
| `validateTextFiles`, `validatePortablePath` | Contenedor, límites y rutas portables |

Todas devuelven `StorageResult<T>`, un `ValidationResult` con incidencias `código` + `archivo#ruta`. No lanzan excepciones ante datos inválidos.

## MemoryStorage

Implementa `WorkspaceStorage` guardando cada workspace como paquete `TextFiles` escrito con `serializeWorkspace` y leído con `parseWorkspace`. Nunca guarda referencias a los objetos recibidos.
- `save` y `rename` conservan los bytes de los documentos sin cambios y los extras.
- Cada operación se confirma completa o no cambia nada.
- Fuera del puerto: `MemoryStorage.fromPackages(paquetes)` carga paquetes v1 validados (por ejemplo, fixtures) y `exportPackage(id)` devuelve una copia del paquete.
- Pasa la suite contractual `tests/contracts/workspace-storage-contract.ts`.
- No persiste entre ejecuciones.

## Paquete de workspace

```text
.nouty/workspace.yaml   versión, ID, metadata, tipos y listas ordenadas de tarjetas y boards
.nouty/layout.yaml      layouts por board
.nouty/relations.yaml   relaciones
cards/<id>.md           frontmatter + contenido Markdown literal
boards/<id>.md          frontmatter + descripción Markdown literal
README.md, assets/**    extras admitidos, conservados sin interpretar
```

- **Salida:** determinista, con claves YAML ordenadas, listas en su orden y LF. Los cuerpos Markdown se conservan carácter a carácter, incluidos CRLF. `contentPresent` y `descriptionPresent` distinguen ausente de vacío.
- **Lectura:** YAML 1.2 core estricto y claves cerradas. Se rechazan versiones distintas de 1, claves duplicadas, anchors, aliases, tags, `__proto__`, BOM y archivos no declarados. También se rechazan las identidades que no coinciden entre manifiesto, ruta y documento, y las rutas no portables o que colisionan sin distinguir mayúsculas.
- **Con `previousFiles`:** el paquete anterior se valida primero. Cada documento sin cambios semánticos conserva sus bytes (comentarios incluidos), solo se regeneran los modificados y se conservan los extras admitidos. Un documento regenerado pierde sus comentarios YAML.
- **Límites:** 10 000 archivos, 2 000 000 de caracteres por texto y profundidad de datos 64.

Las reglas completas están en el ADR 0007 del proyecto. Pruebas: `pnpm exec vitest run packages/storage tests/integration/workspace-files.test.ts tests/integration/template-files.test.ts tests/contracts/storage-boundaries.test.ts`.

## ZIP de workspace (fase 9)

- **`readWorkspaceArchive(bytes, limits?)`:** lee un ZIP no confiable y devuelve `{ workspace, files, assets }`, o incidencias `invalid-archive`, `invalid-path`, `path-collision`, `limit-exceeded` o `unexpected-file` más las del formato. No usa filesystem ni red.
- **`writeWorkspaceArchive(files, assets)`:** produce un ZIP determinista.
- **`ArchiveStorage`:** implementa `WorkspaceStorage`; añade `importArchive`, `exportArchive` (bytes y revisión, sin confirmar nada), `confirmExported(id, revisión)`, `unexportedIds` y `subscribe`.
- **Límites:** ZIP de 32 MiB, 10 000 entradas, 16 MiB por entrada y 64 MiB en total.
- **Dependencia:** `fflate` 0.8.3.

Reglas en el ADR 0011 del proyecto.
