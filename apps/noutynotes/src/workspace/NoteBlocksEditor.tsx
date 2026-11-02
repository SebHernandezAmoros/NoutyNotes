import { moveNoteBlock, parseNoteBlocks, removeNoteBlock, setNoteImageAlt } from '@noutynotes/application';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { markdownExcerpt } from './markdownLists';
import { t } from '../i18n';

interface NoteBlocksEditorProps {
  readonly content: string;
  /** Nuevo contenido tras mover, quitar o cambiar un texto alternativo: va al borrador, como al escribir. */
  readonly onChange: (content: string) => void;
  readonly images: ReadonlyMap<string, string>;
  readonly onInsert: () => void;
  readonly onReplace: (index: number) => void;
  readonly canPickImages: boolean;
}

/**
 * «Contenido en orden» de una nota (ADR 0021): párrafos e imágenes tal como están en el Markdown, con
 * subir, bajar, reemplazar y quitar. Quitar una imagen no borra su archivo (queda sin usar).
 */
export function NoteBlocksEditor({ content, onChange, images, onInsert, onReplace, canPickImages }: NoteBlocksEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const blocks = parseNoteBlocks(content);
  const imageCount = blocks.filter((block) => block.kind === 'image').length;
  const name = (index: number) => {
    const block = blocks[index];
    if (block?.kind === 'image') return t('blocks.image', locale, { name: block.alt || String(blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'image').length) });
    return t('blocks.paragraph', locale, { number: String(blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'text').length) });
  };

  return (
    <View testID="note-blocks" style={styles.section}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('blocks.title', locale)}</Text>
      <ActionButton label={t('blocks.insert', locale)} tone="primary" accessibilityLabel={t('blocks.insertLabel', locale)} onPress={onInsert} />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('blocks.insertHint', locale)}</Text>
      {!canPickImages ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('blocks.pickUnavailable', locale)}</Text> : null}
      {imageCount === 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('blocks.markdownHint', locale)}
        </Text>
      ) : null}
      {blocks.length > 1 || imageCount > 0 ? blocks.map((block, index) => (
        <View key={`${index}-${block.kind === 'image' ? block.ref : block.start}`} testID={`note-block-${index}`}
          style={[styles.block, { borderColor: colors.gridLine, backgroundColor: colors.background }]}>
          {block.kind === 'image' ? (
            <>
              {images.get(block.ref) ? (
                <Image accessibilityRole="image" accessibilityLabel={block.alt || t('blocks.imageAlt', locale)} source={{ uri: images.get(block.ref) }}
                  // «contain», no «cover» (UX7-C2, mismo criterio que la ficha de imagen única en CanvasCard):
                  // recortar sin que la persona lo pida oculta parte de su imagen.
                  resizeMode="contain"
                  style={[styles.thumb, { borderColor: colors.border, backgroundColor: colors.background }]} />
              ) : (
                <Text style={[styles.hint, { color: colors.danger }]}>{t('blocks.imageMissing', locale, { ref: block.ref })}</Text>
              )}
              <TextField label={t('blocks.altLabel', locale, { number: String(blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'image').length) })}
                value={block.alt} onChangeText={(alt) => onChange(setNoteImageAlt(content, index, alt))} placeholder={t('blocks.altPlaceholder', locale)} />
            </>
          ) : (
            <Text numberOfLines={3} style={[styles.text, { color: colors.textPrimary }]}>{markdownExcerpt(block.text)}</Text>
          )}
          <View style={styles.row}>
            <ActionButton label="↑" accessibilityLabel={t('blocks.moveUp', locale, { name: name(index) })} onPress={() => onChange(moveNoteBlock(content, index, -1))} />
            <ActionButton label="↓" accessibilityLabel={t('blocks.moveDown', locale, { name: name(index) })} onPress={() => onChange(moveNoteBlock(content, index, 1))} />
            {block.kind === 'image' ? (
              <>
                <ActionButton label={t('blocks.replace', locale)} accessibilityLabel={t('blocks.replaceNamed', locale, { name: name(index) })} onPress={() => onReplace(index)} />
                <ActionButton label={t('blocks.remove', locale)} accessibilityLabel={t('blocks.removeNamed', locale, { name: name(index) })} onPress={() => onChange(removeNoteBlock(content, index))} />
              </>
            ) : null}
          </View>
        </View>
      )) : null}
      {imageCount > 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('blocks.keepFile', locale)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  hint: { fontSize: 12, lineHeight: 17 },
  block: { borderWidth: 1, padding: 8, gap: 6 },
  thumb: { height: 120, width: '100%', borderWidth: 1 },
  text: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
