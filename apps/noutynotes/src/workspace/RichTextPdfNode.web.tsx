import { validateRichTextDocument } from '@noutynotes/domain';
import type { RichTextPdf } from '@noutynotes/domain';
import { $createParagraphNode, $getNodeByKey, DecoratorNode } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { useLocale, useTheme } from '@noutynotes/ui';
import type { LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import type { JSX } from 'react';
import { useState } from 'react';
import { PdfBlockView } from './ContentResources';
import { t } from '../i18n';

type SerializedPdf = Spread<{ type: 'nouty-pdf'; version: 1; block: RichTextPdf }, SerializedLexicalNode>;
export class RichTextPdfNode extends DecoratorNode<JSX.Element> {
  __block: RichTextPdf;
  static getType(): string { return 'nouty-pdf'; }
  static clone(node: RichTextPdfNode): RichTextPdfNode { return new RichTextPdfNode(node.__block, node.__key); }
  static importJSON(serialized: SerializedPdf): RichTextPdfNode {
    if (serialized.version !== 1) throw new Error('Unsupported PDF node.');
    return new RichTextPdfNode(serialized.block);
  }
  constructor(block: RichTextPdf, key?: NodeKey) {
    super(key);
    if (!validateRichTextDocument({ schemaVersion: 4, blocks: [block] }).ok) throw new Error('Invalid PDF block.');
    this.__block = block;
  }
  createDOM(): HTMLElement { return document.createElement('div'); }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  block(): RichTextPdf { return this.getLatest().__block; }
  decorate(): JSX.Element { return <PdfObject block={this.block()} nodeKey={this.getKey()} />; }
  exportJSON(): SerializedPdf { return { ...super.exportJSON(), type: 'nouty-pdf', version: 1, block: this.block() }; }
}
export const $createRichTextPdfNode = (block: RichTextPdf) => new RichTextPdfNode(block);
export const $isRichTextPdfNode = (node: LexicalNode | null | undefined): node is RichTextPdfNode => node instanceof RichTextPdfNode;

export const PDF_CHANGE_TAG = 'nouty-pdf-change';
function PdfObject({ block, nodeKey }: { readonly block: RichTextPdf; readonly nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const [focused, setFocused] = useState(false);
  const { locale } = useLocale();
  const { theme } = useTheme();
  const remove = () => editor.update(() => { $getNodeByKey(nodeKey)?.remove(); }, { tag: PDF_CHANGE_TAG });
  return <div contentEditable={false} tabIndex={0} role="group" aria-label={block.label ?? t('content.pdf', locale)} aria-selected={selected || focused}
    onFocus={() => setFocused(true)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onClick={() => { clearSelection(); setSelected(true); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setFocused(true); clearSelection(); setSelected(true); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        editor.update(() => {
          const node = $getNodeByKey(nodeKey); if (!node) return;
          const next = event.key === 'ArrowDown' ? node.getNextSibling() : node.getPreviousSibling();
          if (next) { if (event.key === 'ArrowDown') next.selectStart(); else next.selectEnd(); }
          else { const paragraph = $createParagraphNode(); if (event.key === 'ArrowDown') node.insertAfter(paragraph); else node.insertBefore(paragraph); paragraph.selectStart(); }
        });
      }
    }}>
    <PdfBlockView block={block} />
    {selected || focused ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, color: theme.colors.cardText }}>
      <input aria-label={t('content.labelPdf', locale)} value={block.label ?? ''} maxLength={1000} style={{ minHeight: 44, minWidth: 0, flex: 1 }} onChange={(event) => {
        const label = event.target.value;
        editor.update(() => { const node = $getNodeByKey(nodeKey); if (node instanceof RichTextPdfNode) { const { label: _previous, ...rest } = node.block(); node.getWritable().__block = label.trim() ? { ...rest, label } : rest; } }, { tag: PDF_CHANGE_TAG });
      }} />
      <button style={{ minHeight: 44 }} onClick={remove}>{t('content.removePdf', locale)}</button>
    </div> : null}
  </div>;
}
