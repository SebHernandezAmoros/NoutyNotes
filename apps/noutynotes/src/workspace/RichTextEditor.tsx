import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EnrichedMarkdownTextInput } from 'react-native-enriched-markdown';
import type { EnrichedMarkdownTextInputInstance, StyleState } from 'react-native-enriched-markdown';

import { useLocale, useTheme } from '@noutynotes/ui';

import { t } from '../i18n';
import { createNativeHistory, recordNativeHistory, stepNativeHistory } from './nativeRichTextHistory';
import type { NativeRichTextHistory } from './nativeRichTextHistory';
import type { RichTextEditorProps } from './RichTextEditor.types';
import { BasicRichTextPreview } from './BasicRichTextPreview';
import { isBasicRichTextDocument } from './basicRichText';

function EditorToolButton({ label, accessibilityLabel, selected = false, disabled = false, onPress }: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.toolButton, {
        borderColor: selected ? colors.selection : colors.border,
        backgroundColor: selected ? colors.accent : colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      }]}
    >
      <Text style={[styles.toolText, { color: colors.textPrimary }, label === 'B' ? styles.bold : null, label === 'I' ? styles.italic : null]}>{label}</Text>
    </Pressable>
  );
}

function inlineText(content: Extract<RichTextEditorProps['document']['blocks'][number], { type: 'image' }>['caption']): string {
  return (content ?? []).map((inline) => inline.type === 'hard-break' ? '\n' : inline.type === 'link'
    ? inline.content.map((leaf) => leaf.type === 'hard-break' ? '\n' : leaf.text).join('') : inline.text).join('');
}

export function RichTextEditor({ document, codec, onChange, images = new Map(), captionPosition = 'bottom', fontFamily, compact = false }: RichTextEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const encoded = codec.serialize(document);
  const [initialMarkdown] = useState(encoded.ok ? encoded.value : '');
  const [initialHistory] = useState(() => createNativeHistory(initialMarkdown));
  const inputRef = useRef<EnrichedMarkdownTextInputInstance>(null);
  const historyRef = useRef<NativeRichTextHistory>(initialHistory);
  const programmaticMarkdown = useRef<string | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [format, setFormat] = useState<StyleState | null>(null);
  const [problem, setProblem] = useState(encoded.ok ? null : t('editor.visual.invalid', locale));

  if (!isBasicRichTextDocument(document)) {
    return (
      <View testID="native-rich-text-editor" style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.cardSurface }]}>
        <ScrollView contentContainerStyle={styles.mixedContent}>
          {document.blocks.map((block, index) => {
            if (block.type === 'image') {
              const uri = images.get(block.assetRef);
              const caption = inlineText(block.caption);
              const horizontal = captionPosition === 'left' || captionPosition === 'right';
              const reverse = captionPosition === 'top' || captionPosition === 'left';
              return <View key={`${block.assetRef}-${index}`} style={[styles.nativeImageBlock, { borderColor: colors.border, flexDirection: horizontal ? (reverse ? 'row-reverse' : 'row') : (reverse ? 'column-reverse' : 'column') }]}>
                {uri ? <Image accessibilityRole="image" accessibilityLabel={block.alt || 'Imagen de la nota'} source={{ uri }} resizeMode="contain" style={styles.nativeImage} />
                  : <Text accessibilityRole="image" accessibilityLabel={`Imagen no disponible: ${block.alt || block.assetRef}`} style={[styles.unavailable, { color: colors.danger }]}>Imagen no disponible</Text>}
                {caption !== '' ? <Text style={[styles.caption, { color: colors.cardText }]}>{caption}</Text> : null}
              </View>;
            }
            if (block.type === 'table' || block.type === 'opaque-markdown') return null;
            return <BasicRichTextPreview key={index} document={{ schemaVersion: 1, blocks: [block] }} numberOfLines={40}
              color={colors.cardText} fontSize={16} lineHeight={24} testID={`native-rich-block-${index}`} />;
          })}
        </ScrollView>
        <Text style={[styles.status, { color: colors.textSecondary }]}>Las imágenes y el formato avanzado se muestran y se conservan. Edítalos en web o cambia a Markdown.</Text>
      </View>
    );
  }

  const publish = (markdown: string) => {
    const parsed = codec.parse(markdown);
    if (!parsed.ok) {
      setProblem(t('editor.visual.invalid', locale));
      return false;
    }
    setProblem(null);
    onChange(parsed.value);
    return true;
  };

  const changeMarkdown = (markdown: string) => {
    if (programmaticMarkdown.current === markdown) {
      programmaticMarkdown.current = null;
      return;
    }
    if (!publish(markdown)) return;
    const next = recordNativeHistory(historyRef.current, markdown);
    historyRef.current = next;
    setHistory(next);
  };

  const travel = (direction: 'undo' | 'redo') => {
    const stepped = stepNativeHistory(historyRef.current, direction);
    if (!stepped || !publish(stepped.markdown)) return;
    programmaticMarkdown.current = stepped.markdown;
    historyRef.current = stepped.history;
    setHistory(stepped.history);
    inputRef.current?.setValue(stepped.markdown);
  };
  const toggleBold = () => inputRef.current?.toggleBold();
  const toggleItalic = () => inputRef.current?.toggleItalic();
  const undo = () => travel('undo');
  const redo = () => travel('redo');

  return (
    <View testID="native-rich-text-editor" style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.cardSurface }]}>
      <View accessibilityRole="toolbar" accessibilityLabel={t('editor.visual.toolbar', locale)} style={styles.toolbar}>
        <EditorToolButton label="B" accessibilityLabel={t('editor.visual.bold', locale)} selected={format?.bold.isActive === true} onPress={toggleBold} />
        <EditorToolButton label="I" accessibilityLabel={t('editor.visual.italic', locale)} selected={format?.italic.isActive === true} onPress={toggleItalic} />
        <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />
        <EditorToolButton label="↶" accessibilityLabel={t('editor.visual.undo', locale)} disabled={history.index === 0} onPress={undo} />
        <EditorToolButton label="↷" accessibilityLabel={t('editor.visual.redo', locale)} disabled={history.index >= history.entries.length - 1} onPress={redo} />
      </View>
      <EnrichedMarkdownTextInput
        ref={inputRef}
        testID="native-rich-text-content"
        accessibilityLabel={t('editor.visual.content', locale)}
        defaultValue={initialMarkdown}
        placeholder={t('editor.visual.placeholder', locale)}
        placeholderTextColor={colors.textSecondary}
        autoFocus
        multiline
        scrollEnabled
        markdownShortcuts={false}
        linkRegex={null}
        cursorColor={colors.selection}
        selectionColor={colors.selection}
        markdownStyle={{
          strong: { color: colors.cardText },
          em: { color: colors.cardText },
        }}
        style={StyleSheet.flatten([styles.input, compact ? styles.inputCompact : null, { color: colors.cardText, backgroundColor: colors.cardSurface, fontFamily }])}
        selectionMenuConfig={{
          format: { enabled: true, label: t('editor.visual.format', locale) },
          copyAsMarkdown: { enabled: false },
        }}
        formatMenuConfig={{
          bold: { enabled: true, label: t('editor.visual.bold', locale) },
          italic: { enabled: true, label: t('editor.visual.italic', locale) },
          underline: { enabled: false },
          strikethrough: { enabled: false },
          spoiler: { enabled: false },
          link: { enabled: false },
        }}
        onChangeState={setFormat}
        onChangeMarkdown={changeMarkdown}
      />
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
  input: { minHeight: 220, maxHeight: 360, padding: 14, fontSize: 16, lineHeight: 24 },
  inputCompact: { minHeight: 96, maxHeight: 180 },
  status: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
  mixedContent: { minHeight: 220, padding: 14, gap: 10 },
  nativeImageBlock: { borderWidth: 1, padding: 8, gap: 8 },
  nativeImage: { minHeight: 160, flex: 1 },
  unavailable: { minHeight: 96, textAlign: 'center', textAlignVertical: 'center' },
  caption: { flex: 1, fontSize: 14, lineHeight: 20 },
});
