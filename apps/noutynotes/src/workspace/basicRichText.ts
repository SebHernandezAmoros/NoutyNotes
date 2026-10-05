import type { RichTextDocument } from '@noutynotes/domain';

/** Alcance visual compartido por los editores básicos de P04/P05. */
export function isBasicRichTextDocument(document: RichTextDocument): boolean {
  return document.blocks.every((block) => block.type === 'paragraph'
    && block.content.every((inline) => inline.type === 'text' || inline.type === 'hard-break'));
}
