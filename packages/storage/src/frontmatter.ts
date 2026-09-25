import { fail, storageIssue, succeed } from './issues';
import type { StorageResult } from './issues';

export interface FrontmatterDocument {
  /** YAML entre delimitadores, tal como aparece en el archivo. */
  readonly frontmatter: string;
  /** Todo lo que sigue a la línea de cierre, sin ninguna transformación. */
  readonly body: string;
}

/**
 * Separa el frontmatter obligatorio. Los delimitadores son líneas `---` con salto LF o CRLF; el
 * cierre también puede terminar el archivo. El cuerpo se devuelve carácter a carácter.
 */
export function splitFrontmatter(text: string, file: string): StorageResult<FrontmatterDocument> {
  const invalid = (message: string): StorageResult<FrontmatterDocument> => fail([storageIssue('invalid-document', file, message)]);
  if (text.startsWith('\uFEFF')) return invalid('No se admite BOM; el archivo debe empezar por "---".');
  const opening = text.startsWith('---\n') ? 4 : text.startsWith('---\r\n') ? 5 : 0;
  if (opening === 0) return invalid('Falta el frontmatter: la primera línea debe ser "---".');
  let position = opening;
  for (;;) {
    const newline = text.indexOf('\n', position);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(position, end);
    if ((line.endsWith('\r') ? line.slice(0, -1) : line) === '---') {
      return succeed({ frontmatter: text.slice(opening, position), body: newline === -1 ? '' : text.slice(newline + 1) });
    }
    if (newline === -1) return invalid('Falta la línea "---" que cierra el frontmatter.');
    position = newline + 1;
  }
}

/** Escribe delimitadores LF; `yaml` ya termina en salto de línea. El cuerpo se copia literal. */
export function joinFrontmatter(yaml: string, body: string): string {
  return `---\n${yaml}---\n${body}`;
}
