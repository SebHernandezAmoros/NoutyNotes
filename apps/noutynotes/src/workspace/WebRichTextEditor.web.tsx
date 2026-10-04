import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  mergeRegister,
} from 'lexical';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocale, useTheme } from '@noutynotes/ui';

import { t } from '../i18n';
import { $loadBasicRichTextDocument, $readBasicRichTextDocument } from './richTextLexical';
import type { WebRichTextEditorProps } from './WebRichTextEditor.types';

function EditorToolbar() {
  const [editor] = useLexicalComposerContext();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const readSelection = useCallback(() => {
    const selection = $getSelection();
    setBold($isRangeSelection(selection) && selection.hasFormat('bold'));
    setItalic($isRangeSelection(selection) && selection.hasFormat('italic'));
    return false;
  }, []);

  useEffect(() => mergeRegister(
    editor.registerCommand(SELECTION_CHANGE_COMMAND, readSelection, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
  ), [editor, readSelection]);

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
    <View accessibilityRole="toolbar" accessibilityLabel={t('editor.visual.toolbar', locale)} style={styles.toolbar}>
      {button('B', t('editor.visual.bold', locale), bold, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); })}
      {button('I', t('editor.visual.italic', locale), italic, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'); })}
      <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />
      {button('↶', t('editor.visual.undo', locale), false, !canUndo, () => { editor.dispatchCommand(UNDO_COMMAND, undefined); })}
      {button('↷', t('editor.visual.redo', locale), false, !canRedo, () => { editor.dispatchCommand(REDO_COMMAND, undefined); })}
    </View>
  );
}

function DocumentChanges({ initialDocument, onChange }: Pick<WebRichTextEditorProps, 'document' | 'onChange'> & { readonly initialDocument: WebRichTextEditorProps['document'] }) {
  const [initialSignature] = useState(() => JSON.stringify(initialDocument));
  const lastSignature = useRef(initialSignature);
  const changed = useRef(false);
  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        let next = null;
        editorState.read(() => { next = $readBasicRichTextDocument(); });
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

export function WebRichTextEditor({ cardId, document, onChange }: WebRichTextEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [problem, setProblem] = useState<string | null>(null);
  const [initialDocument] = useState(document);
  const [initialConfig] = useState(() => ({
    namespace: `noutynotes-card-${cardId}`,
    editorState: () => $loadBasicRichTextDocument(initialDocument),
    onError: (error: Error) => setProblem(error.message),
  }));

  return (
    <View testID="web-rich-text-editor" style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.cardSurface }]}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorToolbar />
        <View style={styles.editArea}>
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                aria-label={t('editor.visual.content', locale)}
                data-testid="web-rich-text-content"
                spellCheck
                style={{
                  boxSizing: 'border-box', minHeight: 220, outline: 'none', padding: 14,
                  color: colors.cardText, fontSize: 16, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}
              />
            )}
            placeholder={<span style={{ position: 'absolute', left: 14, top: 14, color: colors.textSecondary, pointerEvents: 'none' }}>{t('editor.visual.placeholder', locale)}</span>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </View>
        <HistoryPlugin delay={700} />
        <AutoFocusPlugin />
        <DocumentChanges document={document} initialDocument={initialDocument} onChange={onChange} />
      </LexicalComposer>
      <Text accessibilityLiveRegion="polite" style={[styles.status, { color: problem ? colors.danger : colors.textSecondary }]}>
        {problem ?? t('editor.visual.status', locale)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { width: '100%', borderWidth: 2 },
  toolbar: { minHeight: 52, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolButton: { width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 17 },
  bold: { fontWeight: '900' },
  italic: { fontStyle: 'italic' },
  separator: { width: 1, height: 30, marginHorizontal: 2 },
  editArea: { position: 'relative', minHeight: 220 },
  status: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
});
