# Aplicación y casos de uso

Paquete `@noutynotes/application`: puertos y casos de uso. Solo depende del API público de `@noutynotes/domain`. No importa implementaciones de storage, UI ni plataforma; los adaptadores se inyectan desde la raíz de composición.

## Puerto `RichTextCodec`

`RichTextCodec` convierte entre Markdown durable y `RichTextDocument` mediante resultados de validación, sin exponer el parser a application ni domain. La implementación CommonMark/GFM vive en `@noutynotes/storage`; los editores de web y Android consumirán el mismo puerto durante la integración UX7.

## Puerto `WorkspaceStorage`

| Operación | Requisito | Efecto |
| --- | --- | --- |
| `create(workspace)` | El ID no existe | Guarda un workspace nuevo; nunca sobrescribe |
| `save(workspace)` | El ID existe | Sustituye la instantánea completa, conservando los documentos sin cambios |
| `open(id)` | El ID existe | Devuelve un `Workspace` nuevo y validado |
| `list()` | — | Resúmenes `{ id, name }` ordenados por ID |
| `rename(from, to)` | `from` existe y `to` no | Cambia el identificador; con `from === to` no cambia nada |
| `delete(id)` | El ID existe | Elimina el workspace |

Todas devuelven `Promise<WorkspaceStorageResult<T>>` y nunca rechazan por datos inválidos. Los errores tienen un código tipado (`workspace-not-found`, `workspace-already-exists`, `invalid-workspace-id`, `invalid-workspace`, `invalid-template`, `invalid-stored-data`) y conservan en `details` las incidencias originales. Un error nunca deja cambios parciales. Cambiar el nombre visible es un `save`, no un `rename`.

## Casos de uso

- `createEmptyWorkspace(storage, { id, name })`: crea un workspace vacío.
- `createWorkspaceFromTemplate(storage, template, { workspaceId, name, namespace })`: instancia una plantilla y la guarda. No copia los assets binarios que la plantilla declare (`instantiateTemplate` solo aporta sus rutas): eso es responsabilidad de `createWorkspaceFromBuiltInTemplate`.
- `createWorkspaceFromBuiltInTemplate(storage, assets, template, { workspaceId, name, namespace }, assetBytes)` (fase 11a, ADR 0033): igual, y además escribe en `assets` cada ruta que la plantilla declare con los bytes de `assetBytes` (`ReadonlyMap<AssetRef, Uint8Array>`, aportado por quien llama). Un solo intento por asset; si falta uno en el mapa o su escritura falla, borra el workspace recién creado — o todo o nada, nunca un espacio con una imagen que no existe.
- `modifyWorkspace(storage, id, transform)`: abre, aplica una transformación pura del dominio (mover, borrar, relacionar…) y guarda. Si falla o cambia el ID, no se guarda nada.

### Prototipo de interfaz (fase 7)

- `createEmptyWorkspaceNamed(storage, name)`: deriva un ID legible y libre del nombre.
- `addCardToBoard(storage, id, { kind, title?, content? })`: añade la tarjeta al primer board (lo crea si falta) en el primer hueco libre y devuelve su ID. `content` solo se admite para crear una nota con contenido inicial en el mismo guardado.
- `editCardContent`, `editCardAppearance`, `moveCardOnBoard`, `resizeCardOnBoard` (grilla canónica `CANONICAL_GRID`), `connectCards` (tipo `relacionada`, que se crea si falta) y `disconnectCards`.
- `addBoardShortcut`: crea en un tablero una tarjeta normal y navegable cuyo `boardTargetId` apunta a otro tablero activo del mismo workspace.
- `ids.ts`: `nextSequentialId` y `workspaceIdFromName`, deterministas y sin reloj ni aleatoriedad. El dominio nunca genera IDs.

Los adaptadores disponibles están en `@noutynotes/storage`: `MemoryStorage`, `FolderStorage` (carpetas web) y `ArchiveStorage` (espacios del navegador con ZIP). Todo adaptador debe pasar la suite `tests/contracts/workspace-storage-contract.ts`.
