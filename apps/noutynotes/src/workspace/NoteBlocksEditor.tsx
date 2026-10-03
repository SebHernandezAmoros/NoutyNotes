import { moveNoteBlock, parseNoteBlocks, removeNoteBlock, setNoteImageAlt } from '@noutynotes/application';
import { useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { markdownExcerpt } from './markdownLists';

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
  const colors = theme.colors;
  const blocks = parseNoteBlocks(content);
  const imageCount = blocks.filter((block) => block.kind === 'image').length;
  const name = (index: number) => {
    const block = blocks[index];
    if (block?.kind === 'image') return `la imagen ${block.alt || blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'image').length}`;
    return `el párrafo ${blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'text').length}`;
  };

  return (
    <View testID="note-blocks" style={styles.section}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>CONTENIDO EN ORDEN</Text>
      <ActionButton label="Insertar imagen" tone="primary" accessibilityLabel="Insertar una imagen en la nota" onPress={onInsert} />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Se coloca después del párrafo donde está el cursor (al final si no has escrito en el texto).</Text>
      {!canPickImages ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Este entorno no permite elegir imágenes.</Text> : null}
      {imageCount === 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Las imágenes se guardan en el texto como una línea «![texto](assets/images/…)»: su posición es su orden.
        </Text>
      ) : null}
      {blocks.length > 1 || imageCount > 0 ? blocks.map((block, index) => (
        <View key={`${index}-${block.kind === 'image' ? block.ref : block.start}`} testID={`note-block-${index}`}
          style={[styles.block, { borderColor: colors.gridLine, backgroundColor: colors.background }]}>
          {block.kind === 'image' ? (
            <>
              {images.get(block.ref) ? (
                <Image accessibilityRole="image" accessibilityLabel={block.alt || 'Imagen de la nota'} source={{ uri: images.get(block.ref) }}
                  // «contain», no «cover» (UX7-C2, mismo criterio que la ficha de imagen única en CanvasCard):
                  // recortar sin que la persona lo pida oculta parte de su imagen.
                  resizeMode="contain"
                  style={[styles.thumb, { borderColor: colors.border, backgroundColor: colors.background }]} />
              ) : (
                <Text style={[styles.hint, { color: colors.danger }]}>{`Imagen no disponible: ${block.ref}`}</Text>
              )}
              <TextField label={`Texto alternativo de la imagen ${blocks.slice(0, index + 1).filter((candidate) => candidate.kind === 'image').length}`}
                value={block.alt} onChangeText={(alt) => onChange(setNoteImageAlt(content, index, alt))} placeholder="Describe la imagen" />
            </>
          ) : (
            <Text numberOfLines={3} style={[styles.text, { color: colors.textPrimary }]}>{markdownExcerpt(block.text)}</Text>
          )}
          <View style={styles.row}>
            <ActionButton label="↑" accessibilityLabel={`Subir ${name(index)}`} onPress={() => onChange(moveNoteBlock(content, index, -1))} />
            <ActionButton label="↓" accessibilityLabel={`Bajar ${name(index)}`} onPress={() => onChange(moveNoteBlock(content, index, 1))} />
            {block.kind === 'image' ? (
              <>
                <ActionButton label="Reemplazar" accessibilityLabel={`Reemplazar ${name(index)}`} onPress={() => onReplace(index)} />
                <ActionButton label="Quitar" accessibilityLabel={`Quitar ${name(index)} de la nota`} onPress={() => onChange(removeNoteBlock(content, index))} />
              </>
            ) : null}
          </View>
        </View>
      )) : null}
      {imageCount > 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Quitar o reemplazar una imagen no borra su archivo: queda sin usar en assets/images.</Text>
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
