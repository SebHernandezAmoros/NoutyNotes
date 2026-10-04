import type { IssueLike, RichTextDocument, ValidationResult } from '@noutynotes/domain';

/** Incidencia mínima del codec; el adaptador puede usar códigos más específicos. */
export type RichTextCodecResult<T> = ValidationResult<T, IssueLike>;

/**
 * Puerto puro entre el formato durable Markdown y el borrador enriquecido. La aplicación no conoce
 * el parser, el serializador ni una biblioteca de editor concreta.
 */
export interface RichTextCodec {
  parse(markdown: string): RichTextCodecResult<RichTextDocument>;
  serialize(document: RichTextDocument): RichTextCodecResult<string>;
}
