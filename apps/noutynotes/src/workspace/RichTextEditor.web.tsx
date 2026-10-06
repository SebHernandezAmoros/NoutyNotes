import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  mergeRegister,
} from 'lexical';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { isLinkUrl } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';

import { t } from '../i18n';
import { $loadWebRichTextDocument, $readWebRichTextDocument } from './richTextLexical';
import { $createRichTextImageNode, $isRichTextImageNode, RichTextImageNode, RichTextImageProvider } from './RichTextImageNode.web';
import type { RichTextEditorProps } from './RichTextEditor.types';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type BlockKind = 'paragraph' | `heading-${HeadingLevel}` | 'bullet' | 'ordered' | 'checklist';

function EditorToolbar({ onInsertImage }: Pick<RichTextEditorProps, 'onInsertImage'>) {
  const [editor] = useLexicalComposerContext();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [block, setBlock] = useState<BlockKind>('paragraph');
  const [selectionLink, setSelectionLink] = useState('');
  const [linkHref, setLinkHref] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkProblem, setLinkProblem] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const readSelection = useCallback(() => {
    const selection = $getSelection();
    setBold($isRangeSelection(selection) && selection.hasFormat('bold'));
    setItalic($isRangeSelection(selection) && selection.hasFormat('italic'));
    if (!$isRangeSelection(selection)) return false;
    const top = selection.anchor.getNode().getTopLevelElement();
    // Los controles de una imagen decorada pueden dejar el ancla temporalmente en la raíz.
    if (!top) return false;
    if ($isHeadingNode(top)) setBlock(`heading-${Number(top.getTag().slice(1)) as HeadingLevel}`);
    else if ($isListNode(top)) setBlock(top.getListType() === 'number' ? 'ordered' : top.getListType() === 'check' ? 'checklist' : 'bullet');
    else setBlock('paragraph');
    let current = selection.anchor.getNode();
    let href = '';
    while (current.getParent() !== null) {
      if ($isLinkNode(current)) href = current.getURL();
      current = current.getParent() ?? current;
    }
    setSelectionLink(href);
    return false;
  }, []);

  useEffect(() => mergeRegister(
    editor.registerCommand(SELECTION_CHANGE_COMMAND, readSelection, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
  ), [editor, readSelection]);

  const chooseBlock = useCallback((next: BlockKind) => {
    if (next === 'bullet' || next === 'ordered' || next === 'checklist') {
      const command = next === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : next === 'ordered' ? INSERT_ORDERED_LIST_COMMAND : INSERT_CHECK_LIST_COMMAND;
      editor.dispatchCommand(block === next ? REMOVE_LIST_COMMAND : command, undefined);
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => next === 'paragraph'
        ? $createParagraphNode()
        : $createHeadingNode(`h${next.slice(-1)}` as `h${HeadingLevel}`));
    });
  }, [block, editor]);

  const openLink = useCallback(() => {
    setLinkHref(selectionLink);
    setLinkProblem(false);
    setLinkOpen(true);
  }, [selectionLink]);

  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if (!(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    if (key === 'k') { event.preventDefault(); openLink(); return true; }
    if (event.altKey && /^[0-6]$/.test(key)) {
      event.preventDefault();
      chooseBlock(key === '0' ? 'paragraph' : `heading-${Number(key) as HeadingLevel}`);
      return true;
    }
    if (event.shiftKey && ['7', '8', '9'].includes(key)) {
      event.preventDefault();
      chooseBlock(key === '7' ? 'ordered' : key === '8' ? 'bullet' : 'checklist');
      return true;
    }
    return false;
  }, COMMAND_PRIORITY_LOW), [chooseBlock, editor, openLink]);

  const applyLink = () => {
    const href = linkHref.trim();
    if (!isLinkUrl(href)) { setLinkProblem(true); return; }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, href);
    setSelectionLink(href);
    setLinkOpen(false);
  };
  const removeLink = () => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setSelectionLink('');
    setLinkHref('');
    setLinkProblem(false);
    setLinkOpen(false);
  };
  const insertImage = async () => {
    if (!onInsertImage) return;
    const snapshot = editor.getEditorState().read(() => {
      const selection = $getSelection();
      const document = $readWebRichTextDocument();
      if (!document) return null;
      if (!$isRangeSelection(selection)) return { document, afterBlock: $getRoot().getChildrenSize() - 1 };
      const top = selection.anchor.getNode().getTopLevelElement();
      const children = $getRoot().getChildren();
      let afterBlock = top ? children.indexOf(top) : children.length - 1;
      // Repetir «Insertar imagen» desde el mismo párrafo construye una galería en el orden elegido,
      // en vez de anteponer cada archivo nuevo al anterior.
      while ($isRichTextImageNode(children[afterBlock + 1])) afterBlock += 1;
      return { document, afterBlock };
    });
    if (!snapshot) return;
    const { document, afterBlock } = snapshot;
    const image = await onInsertImage(document, afterBlock);
    if (!image) return;
    editor.update(() => {
      const root = $getRoot();
      const node = $createRichTextImageNode(image);
      const target = root.getChildren()[afterBlock];
      if (target) target.insertAfter(node);
      else root.append(node);
    });
  };

  const button = (label: string, accessibilityLabel: string, selected: boolean, disabled: boolean, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={action}
      style={({ pressed }) => [styles.toolButton, {
        borderColor: selected ? colors.selection : colors.border,
        backgroundColor: selected ? colors.accent : colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      }]}
    >
      <Text style={[styles.toolText, { color: colors.textPrimary }, label === 'B' ? styles.bold : null, label === 'I' ? styles.italic : null]}>{label}</Text>
    </Pressable>
  );

  return (
    <View>
      <View accessibilityRole="toolbar" accessibilityLabel={t('editor.visual.toolbar', locale)} style={styles.toolbar}>
        <select
          aria-label={t('editor.visual.block', locale)}
          value={block.startsWith('heading-') || block === 'paragraph' ? block : 'paragraph'}
          onChange={(event) => chooseBlock(event.currentTarget.value as BlockKind)}
          style={{ height: 44, minWidth: 116, border: `2px solid ${colors.border}`, background: colors.surface, color: colors.textPrimary, fontWeight: 700, padding: '0 8px' }}
        >
          <option value="paragraph">{t('editor.visual.paragraph', locale)}</option>
          {([1, 2, 3, 4, 5, 6] as const).map((level) => <option key={level} value={`heading-${level}`}>{`${t('editor.visual.heading', locale)} ${level}`}</option>)}
        </select>
        {button('B', t('editor.visual.bold', locale), bold, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); })}
        {button('I', t('editor.visual.italic', locale), italic, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'); })}
        <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />
        {button('•', t('editor.visual.bullet', locale), block === 'bullet', false, () => chooseBlock('bullet'))}
        {button('1.', t('editor.visual.ordered', locale), block === 'ordered', false, () => chooseBlock('ordered'))}
        {button('☐', t('editor.visual.checklist', locale), block === 'checklist', false, () => chooseBlock('checklist'))}
        {button('↗', t('editor.visual.link', locale), selectionLink !== '', false, openLink)}
        {onInsertImage ? button('▧', 'Insertar una imagen', false, false, () => { void insertImage(); }) : null}
        <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />
        {button('↶', t('editor.visual.undo', locale), false, !canUndo, () => { editor.dispatchCommand(UNDO_COMMAND, undefined); })}
        {button('↷', t('editor.visual.redo', locale), false, !canRedo, () => { editor.dispatchCommand(REDO_COMMAND, undefined); })}
      </View>
      {linkOpen ? (
        <View style={[styles.linkEditor, { borderColor: linkProblem ? colors.danger : colors.gridLine, backgroundColor: colors.surface }]}>
          <TextInput
            autoFocus
            accessibilityLabel={t('editor.visual.link.url', locale)}
            value={linkHref}
            onChangeText={(value) => { setLinkHref(value); setLinkProblem(false); }}
            onSubmitEditing={applyLink}
            placeholder="https://example.com"
            placeholderTextColor={colors.textSecondary}
            style={[styles.linkInput, { color: colors.textPrimary, borderColor: colors.border }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={t('editor.visual.link.apply', locale)} onPress={applyLink} style={[styles.linkAction, { borderColor: colors.border }]}>
            <Text style={[styles.linkActionText, { color: colors.textPrimary }]}>{t('editor.visual.link.apply', locale)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('editor.visual.link.remove', locale)} disabled={selectionLink === ''} onPress={removeLink} style={[styles.linkAction, { borderColor: colors.border, opacity: selectionLink === '' ? 0.45 : 1 }]}>
            <Text style={[styles.linkActionText, { color: colors.textPrimary }]}>{t('editor.visual.link.remove', locale)}</Text>
          </Pressable>
          {button('×', t('editor.visual.link.close', locale), false, false, () => setLinkOpen(false))}
          {linkProblem ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{t('editor.visual.link.invalid', locale)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function ImageEditorBridge({ images, captionPosition, onReplaceImage, children }: Pick<RichTextEditorProps, 'images' | 'captionPosition' | 'onReplaceImage'> & { readonly children: ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const replace = onReplaceImage ? async (blockIndex: number) => {
    const document = editor.getEditorState().read(() => $readWebRichTextDocument());
    return document ? onReplaceImage(document, blockIndex) : null;
  } : undefined;
  return (
    <RichTextImageProvider value={{ images: images ?? new Map(), captionPosition: captionPosition ?? 'bottom', onReplace: replace }}>
      {children}
    </RichTextImageProvider>
  );
}

function DocumentChanges({ initialDocument, onChange }: Pick<RichTextEditorProps, 'document' | 'onChange'> & { readonly initialDocument: RichTextEditorProps['document'] }) {
  const [initialSignature] = useState(() => JSON.stringify(initialDocument));
  const lastSignature = useRef(initialSignature);
  const changed = useRef(false);
  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        let next = null;
        editorState.read(() => { next = $readWebRichTextDocument(); });
        if (next === null) return;
        const signature = JSON.stringify(next);
        if (!changed.current && signature === initialSignature) return;
        if (signature === lastSignature.current) return;
        changed.current = true;
        lastSignature.current = signature;
        onChange(next);
      }}
    />
  );
}

const editorTheme = {
  heading: { h1: 'nouty-h1', h2: 'nouty-h2', h3: 'nouty-h3', h4: 'nouty-h4', h5: 'nouty-h5', h6: 'nouty-h6' },
  link: 'nouty-link',
  list: {
    checklist: 'nouty-checklist', listitem: 'nouty-listitem', listitemChecked: 'nouty-checked', listitemUnchecked: 'nouty-unchecked',
    nested: { listitem: 'nouty-nested-listitem' }, ol: 'nouty-ol', ul: 'nouty-ul',
  },
};

export function RichTextEditor({ cardId, document, onChange, images = new Map(), captionPosition = 'bottom', fontFamily, onInsertImage, onReplaceImage, compact = false }: RichTextEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [problem, setProblem] = useState<string | null>(null);
  const [initialDocument] = useState(document);
  const [initialConfig] = useState(() => ({
    namespace: `noutynotes-card-${cardId}`,
    nodes: [HeadingNode, LinkNode, ListNode, ListItemNode, RichTextImageNode],
    theme: editorTheme,
    editorState: () => $loadWebRichTextDocument(initialDocument),
    onError: (error: Error) => setProblem(error.message),
  }));

  return (
    <View testID="web-rich-text-editor" style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.cardSurface }]}>
      <style>{`
        .nouty-h1,.nouty-h2,.nouty-h3,.nouty-h4,.nouty-h5,.nouty-h6{font-weight:800;margin:0 0 .35em}
        .nouty-h1{font-size:2em}.nouty-h2{font-size:1.65em}.nouty-h3{font-size:1.4em}.nouty-h4{font-size:1.2em}.nouty-h5{font-size:1.05em}.nouty-h6{font-size:1em}
        .nouty-link{text-decoration:underline}.nouty-ul,.nouty-ol{margin:.35em 0;padding-left:1.6em}
        .nouty-listitem{margin:.2em 0}.nouty-checklist{list-style:none;padding-left:.3em}
        .nouty-unchecked,.nouty-checked{position:relative;list-style:none;padding-left:1.7em}.nouty-unchecked:before,.nouty-checked:before{position:absolute;box-sizing:border-box;left:0;top:.08em;width:1.25em;height:1.25em;cursor:pointer}
        .nouty-unchecked:before{content:'☐'}.nouty-checked:before{content:'☑'}
      `}</style>
      <LexicalComposer initialConfig={initialConfig}>
        <ImageEditorBridge images={images} captionPosition={captionPosition} onReplaceImage={onReplaceImage}>
        <EditorToolbar onInsertImage={onInsertImage} />
        <View style={[styles.editArea, compact ? styles.editAreaCompact : null]}>
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                aria-label={t('editor.visual.content', locale)}
                data-testid="web-rich-text-content"
                spellCheck
                style={{
                  boxSizing: 'border-box', minHeight: compact ? 96 : 220, outline: 'none', padding: 14,
                  color: colors.cardText,
                  fontFamily: fontFamily ?? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                  fontSize: 16, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}
              />
            )}
            placeholder={<span style={{ position: 'absolute', left: 14, top: 14, color: colors.textSecondary, pointerEvents: 'none' }}>{t('editor.visual.placeholder', locale)}</span>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </View>
        <HistoryPlugin delay={700} />
        <ListPlugin shouldPreserveNumbering />
        <CheckListPlugin />
        <LinkPlugin validateUrl={isLinkUrl} attributes={{ rel: 'noreferrer' }} />
        <AutoFocusPlugin />
        <DocumentChanges document={document} initialDocument={initialDocument} onChange={onChange} />
        </ImageEditorBridge>
      </LexicalComposer>
      <Text accessibilityLiveRegion="polite" style={[styles.status, { color: problem ? colors.danger : colors.textSecondary }]}>
        {problem ?? t('editor.visual.status', locale)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { width: '100%', borderWidth: 2 },
  toolbar: { minHeight: 52, padding: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  toolButton: { width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 17 },
  bold: { fontWeight: '900' },
  italic: { fontStyle: 'italic' },
  separator: { width: 1, height: 30, marginHorizontal: 2 },
  linkEditor: { minHeight: 54, borderTopWidth: 1, borderBottomWidth: 1, padding: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  linkInput: { minWidth: 220, flexGrow: 1, height: 44, borderWidth: 2, paddingHorizontal: 10 },
  linkAction: { minHeight: 44, borderWidth: 2, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  linkActionText: { fontSize: 13, fontWeight: '800' },
  editArea: { position: 'relative', minHeight: 220 },
  editAreaCompact: { minHeight: 96 },
  status: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
});
