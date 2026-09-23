# Dominio

Paquete `@noutynotes/domain`: modelo y reglas puras de NoutyNotes. No tiene dependencias y solo importa sus propios módulos. No usa React, React Native, Expo, DOM, filesystem, red, almacenamiento, reloj ni números aleatorios. Se ejecuta y se prueba en Node con Vitest.

## Organización

| Ubicación | Contenido |
| --- | --- |
| `src/ids.ts` | Identificadores estables con tipo por entidad; validación sin normalizar |
| `src/errors.ts` | Incidencias con código, ruta y mensaje; `ValidationResult`, `DomainError` y `assertValid` |
| `src/schema-version.ts` | Versión de esquema admitida (1) |
| `src/workspace/` | Workspace, metadata y validación de referencias entre colecciones |
| `src/boards/` | Board como vista ordenada de tarjetas |
| `src/cards/` | Tarjeta, tipos basados en primitivas, definiciones y valores de campo |
| `src/relations/` | Relación dirigida y tipos de relación |
| `src/layouts/` | Layout por board, colocaciones en unidades de grilla y modo de visualización |
| `src/templates/` | Manifiesto y validación mínima de plantillas como datos |
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

## Fuera de alcance

Aún no incluye el motor de grilla (límites de columnas, colisiones, snap, compactación ni vista móvil), los casos de uso de relaciones (autoenlaces, duplicados y borrado) ni la instanciación de plantillas. Tampoco define el formato de archivos, parsers ni persistencia. Esas partes llegan en las fases 2 a 5; estos contratos no fijan todavía cómo se guardan los archivos.
