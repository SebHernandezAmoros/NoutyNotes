# Dominio

Paquete `@noutynotes/domain`: modelo y reglas puras de NoutyNotes. No tiene dependencias y solo importa sus propios módulos. No usa React, React Native, Expo, DOM, filesystem, red, almacenamiento, reloj ni números aleatorios. Se ejecuta y se prueba en Node con Vitest.

## Organización

| Ubicación | Contenido |
| --- | --- |
| `src/ids.ts` | Identificadores estables con tipo por entidad; validación sin normalizar |
| `src/errors.ts` | Incidencias con código, ruta y mensaje; `ValidationResult<T, I>` (genérico en la incidencia, para que storage añada sus códigos), `DomainError` y `assertValid` |
| `src/schema-version.ts` | Versión de esquema admitida (1) |
| `src/workspace/` | Workspace, metadata y validación de referencias entre colecciones |
| `src/boards/` | Board como vista ordenada de tarjetas |
| `src/cards/` | Tarjeta, tipos basados en primitivas, definiciones y valores de campo |
| `src/relations/` | Relación dirigida, validación, creación, eliminación y consultas |
| `src/layouts/` | Layout por board, colocaciones en unidades de grilla y modo de visualización; motor de grilla (`grid.ts`, `operations.ts`, `projection.ts`) |
| `src/templates/` | Plantillas completas, validación, remapeo, instanciación y JSON en memoria |
| `src/assets/` | Referencias a assets relativas a la raíz del workspace |

Las pruebas `*.test.ts` están junto a cada módulo. `src/__fixtures__/` contiene datos de prueba que el paquete no exporta.

## Contratos

- **Propiedad.** El workspace posee tarjetas, tipos y relaciones. La tarjeta posee su contenido Markdown (opaco), sus campos y sus referencias a assets.
- **Boards.** Un board referencia tarjetas por ID y define su orden. Una tarjeta puede estar en varios boards o en ninguno. Quitarla de un board no la elimina.
- **Layouts.** Hay un layout por board, identificado por `boardId`. Cada colocación se identifica por `(boardId, cardId)` y guarda un rectángulo entero en unidades de grilla y el modo `expanded`, `collapsed` o `minimized`. Solo puede colocar tarjetas que pertenecen a ese board.
- **Relaciones.** Enlazan dos tarjetas del workspace mediante un tipo declarado, sin depender de boards ni posiciones.
- **Campos.** Cada tarjeta usa un tipo declarado. Solo admite los campos que ese tipo define, con valores del tipo correcto, y exige los obligatorios.
- **Identificadores.** Minúsculas, dígitos, `-` y `_`; como máximo 64 caracteres. Son únicos dentro de su colección y se validan sin transformarlos.
- **Plantillas.** Solo contienen datos compatibles con JSON/YAML. Se rechazan las claves no declaradas en la raíz, el manifiesto, los boards, los tipos de tarjeta, los campos y los tipos de relación. Nada se evalúa.
- **Datos mal formados.** Las funciones de validación devuelven incidencias y no lanzan excepciones ante estructuras inesperadas. Las comprobaciones cruzadas solo profundizan en entidades sin incidencias propias.
- **Versión.** `schemaVersion` versiona el workspace completo y, por separado, el manifiesto de plantilla. Una versión no admitida detiene la validación.

`validateWorkspace` comprueba las referencias de todo el workspace. `validateCard`, `validateBoard`, `validateLayout`, `validateRelation` y `validateCardType` comprueban las reglas locales de cada entidad.

## Motor de grilla

Recibe un `BoardLayout` y una `GridConfig` y devuelve un resultado nuevo o incidencias. No dibuja, no interpreta gestos y no consulta el ancho de pantalla.

- **Configuración:** `DESKTOP_GRID` (12 columnas), `TABLET_GRID` (6) y `MOBILE_GRID` (1). `rows` es opcional; sin él, el board crece hacia abajo.
- **Huella:** `rect` guarda el tamaño expandido. Una tarjeta ocupa `w×h` expandida, `w×1` colapsada y `1×1` minimizada. Límites y colisiones se evalúan sobre la huella; tocarse por un borde no es colisión.
- **Operaciones:** `snapUnit`, `snapPoint` y `snapSize` redondean con empates hacia +∞. `moveCard`, `resizeCard` y `setDisplay` devuelven error en lugar de ajustar en silencio. `findFreeSpace` y `compactLayout` siguen el orden de lectura `(y, x, cardId)`.
- **Restaurar:** al expandir o descontraer, `setDisplay` falla si no hay sitio, o busca el primer hueco con `{ ifOccupied: 'relocate' }`.
- **Proyección:** `projectLayout(layout, from, to)` deriva la vista para otra cantidad de columnas (por ejemplo, móvil de una columna) sin modificar el layout canónico.

Todas las operaciones validan antes el layout de entrada, no lo mutan y producen el mismo resultado con los mismos datos. Los componentes del `rect` son enteros seguros y sus sumas deben ser representables en cualquier modo. Ninguna salida exitosa tiene geometría inválida. La búsqueda y la proyección recorren solo filas candidatas (bordes inferiores de las huellas), así que su coste no depende de la altura. Las entradas nulas o mal formadas devuelven incidencias en lugar de excepciones.

## Relaciones y borrado

`createRelation`, `deleteRelation`, `getIncomingRelations`, `getOutgoingRelations` y `getRelatedCards` operan sobre el workspace validado. Se rechazan autoenlaces y duplicados del mismo tipo/sentido. `deleteCard` restringe por defecto el borrado si hay conexiones; `{ relations: 'cascade' }` elimina vínculos incidentes y apariciones de la tarjeta en todos los boards/layouts, sin borrar assets.

## Template Lab

`validateTemplate` admite tarjetas, relaciones, layouts, catálogo de assets, README y preview, además del contrato mínimo de tipos y boards. Comprueba referencias y grilla inicial de 12 columnas. Plantillas mínimas existentes siguen siendo válidas; las colecciones opcionales se interpretan como vacías al instanciar.

- `importTemplate(objectOrJson)` valida datos y devuelve una copia independiente.
- `exportTemplate(template)` devuelve JSON determinista, con claves ordenadas y arrays en su orden original.
- `instantiateTemplate(template, { workspaceId, name, namespace })` devuelve `{ workspace, assets, readme?, preview? }`.
- `duplicateTemplate(template, { manifest, namespace })` devuelve una plantilla independiente; el manifiesto debe tener otro ID.

Namespace remapea explícitamente IDs a `namespace-id` y todas sus referencias estructurales. No cambia claves/valores de campos, Markdown ni rutas de assets; IDs mayores de 64 caracteres se rechazan sin truncar. `assets` es un catálogo para materialización posterior, no archivos copiados. Las operaciones no usan reloj ni aleatoriedad.

El formato es declarativo, con claves cerradas y protección contra contenido ejecutable, ciclos, getters y estructuras no representables; profundidad máxima 64. Se mantiene validación propia del dominio, sin Zod ni dependencias nuevas. Los fixtures completos viven en `tests/fixtures/templates/` y la integración comprueba los SVG locales.

```sh
pnpm exec vitest run packages/domain/src/templates tests/integration/templates-workspace.test.ts
```

`collectPlainDataIssues` es la guarda de datos inertes (sin getters, funciones, ciclos ni arrays dispersos; profundidad 64). La usan las plantillas y la frontera de archivos de `@noutynotes/storage`. El dominio no depende de YAML, Zod ni storage.

## Fuera de alcance

Aún no incluye empuje de tarjetas al expandir, formas alternativas del nodo minimizado, UI de edición o plantillas, formato de archivos Markdown/YAML, ZIP ni persistencia. El intercambio JSON de plantillas no define todavía cómo se guardan los archivos del workspace ni copia bytes de assets.

Fase 7: `addCard(workspace, card, { boardId, size, config })` agrega una tarjeta aportada por el llamador al final del board y en el primer hueco libre de su layout. `updateCard(workspace, cardId, { title?, content? })` edita solo el título (en blanco lo elimina) y el Markdown (literal).
