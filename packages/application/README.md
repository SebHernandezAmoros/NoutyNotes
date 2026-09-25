# Aplicación y casos de uso

Paquete `@noutynotes/application`: puertos y casos de uso. Solo depende del API público de `@noutynotes/domain`. No importa implementaciones de storage, UI ni plataforma; los adaptadores se inyectan desde la raíz de composición.

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
- `createWorkspaceFromTemplate(storage, template, { workspaceId, name, namespace })`: instancia una plantilla y la guarda.
- `modifyWorkspace(storage, id, transform)`: abre, aplica una transformación pura del dominio (mover, borrar, relacionar…) y guarda. Si falla o cambia el ID, no se guarda nada.

### Prototipo de interfaz (fase 7)

- `createEmptyWorkspaceNamed(storage, name)`: deriva un ID legible y libre del nombre.
- `addCardToBoard(storage, id, { kind: 'note' | 'image', title? })`: añade la tarjeta al primer board (lo crea si falta) en el primer hueco libre y devuelve su ID. Crea bajo demanda los tipos `nota` o `imagen`.
- `editCardContent`, `moveCardOnBoard`, `resizeCardOnBoard` (grilla canónica `CANONICAL_GRID`), `connectCards` (tipo `relacionada`, que se crea si falta) y `disconnectCards`.
- `ids.ts`: `nextSequentialId` y `workspaceIdFromName`, deterministas y sin reloj ni aleatoriedad. El dominio nunca genera IDs.

Los adaptadores disponibles están en `@noutynotes/storage`: `MemoryStorage`, `FolderStorage` (carpetas web) y `ArchiveStorage` (espacios del navegador con ZIP). Todo adaptador debe pasar la suite `tests/contracts/workspace-storage-contract.ts`.
