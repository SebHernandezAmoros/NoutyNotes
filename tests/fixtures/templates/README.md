# Fixtures de Template Lab

`gdd.json`, `storyboard.json` y `research.json` son plantillas declarativas completas de fase 4. Las rutas de assets son relativas a esta carpeta; los SVG son placeholders propios, sin scripts ni recursos externos. El dominio solo valida el catálogo y devuelve un plan de materialización; estas pruebas leen los fixtures, no lo hace el dominio.

Probar desde la raíz: `pnpm exec vitest run packages/domain/src/templates tests/integration/templates-workspace.test.ts`.

Formato de intercambio actual: JSON en memoria. No representa todavía el paquete de archivos YAML/Markdown ni el import/export ZIP de fases posteriores. La URL de Research es contenido de ejemplo y no se descarga.
