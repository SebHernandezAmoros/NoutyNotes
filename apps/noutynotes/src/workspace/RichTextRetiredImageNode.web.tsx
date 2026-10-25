import type { RichTextRetiredImage } from '@noutynotes/domain';
import { validateRichTextDocument } from '@noutynotes/domain';
import { DecoratorNode } from 'lexical';
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import type { JSX } from 'react';
import { RetiredImageBlock } from './RetiredImageBlock';

type SerializedRetiredImage = Spread<{ readonly type: 'nouty-retired-image'; readonly version: 1; readonly block: RichTextRetiredImage }, SerializedLexicalNode>;

/** Immutable data; ordinary neighboring text/history is handled by Lexical. No retirement command. */
export class RichTextRetiredImageNode extends DecoratorNode<JSX.Element> {
  __block: RichTextRetiredImage;
  static getType(): string { return 'nouty-retired-image'; }
  static clone(node: RichTextRetiredImageNode): RichTextRetiredImageNode { return new RichTextRetiredImageNode(node.__block, node.__key); }
  static importJSON(serialized: SerializedRetiredImage): RichTextRetiredImageNode {
    if (serialized.version !== 1) throw new Error('Versión de marcador no admitida.');
    return new RichTextRetiredImageNode(serialized.block);
  }
  constructor(block: RichTextRetiredImage, key?: NodeKey) {
    super(key);
    if (!validateRichTextDocument({ schemaVersion: 3, blocks: [block] }).ok) throw new Error('Marcador de imagen retirada no válido.');
    this.__block = block;
  }
  createDOM(_config: EditorConfig): HTMLElement { return document.createElement('div'); }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate(): JSX.Element { return <RetiredImageBlock block={this.block()} testID="editor-retired-image" />; }
  block(): RichTextRetiredImage { return this.getLatest().__block; }
  exportJSON(): SerializedRetiredImage { return { ...super.exportJSON(), type: 'nouty-retired-image', version: 1, block: this.block() }; }
}

export function $createRichTextRetiredImageNode(block: RichTextRetiredImage): RichTextRetiredImageNode { return new RichTextRetiredImageNode(block); }
export function $isRichTextRetiredImageNode(node: LexicalNode | null | undefined): node is RichTextRetiredImageNode { return node instanceof RichTextRetiredImageNode; }
