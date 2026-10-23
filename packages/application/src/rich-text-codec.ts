import type { IssueLike, RichTextDocument, ValidationResult } from '@noutynotes/domain';

/** Incidencia mínima del codec; el adaptador puede usar códigos más específicos. */
export type RichTextCodecResult<T> = ValidationResult<T, IssueLike>;

/**
 * Puerto puro entre una representación durable y el documento enriquecido. La aplicación no conoce
 * el parser, el serializador ni una biblioteca de editor concreta.
 */
export interface RichTextCodec {
  parse(source: string): RichTextCodecResult<RichTextDocument>;
  serialize(document: RichTextDocument): RichTextCodecResult<string>;
  /** Solo lectura: omite metadatos de transporte reconocidos de la fuente usada para previews.
   * Nunca utilizar el resultado para guardar o editar el documento durable. */
  projectLegacyNotePreview?(source: string): string;
}
