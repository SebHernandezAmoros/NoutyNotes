import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';
import type { CardIconName } from '@noutynotes/domain';

/**
 * Icono de la ficha minimizada (ADR 0016), dibujado con vistas: igual en web y Android, sin fuentes de
 * iconos ni emoji. Nota: hoja con renglones y esquina doblada. Imagen: marco con sol y montaña.
 */
export function CardIcon({ kind, testID }: { readonly kind: CardIconName; readonly testID?: string }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const ink = colors.headerText;
  if (kind === 'note') {
    return (
      <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.page, { borderColor: ink, backgroundColor: colors.cardSurface }]}>
        <View style={[styles.fold, { borderColor: ink, backgroundColor: colors.headerNote }]} />
        {[5, 10, 15].map((top) => <View key={top} style={[styles.line, { top, backgroundColor: ink }]} />)}
      </View>
    );
  }
  if (kind === 'folder') {
    return <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.folder, { borderColor: ink, backgroundColor: colors.cardSurface }]}><View style={[styles.folderTab, { borderColor: ink, backgroundColor: colors.cardSurface }]} /></View>;
  }
  if (kind !== 'image') {
    const glyph = kind === 'link' ? '↗' : kind === 'check' ? '✓' : '★';
    return <Text testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.symbol, { color: ink }]}>{glyph}</Text>;
  }
  return (
    <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, { borderColor: ink, backgroundColor: colors.cardSurface }]}>
      <View style={[styles.sun, { backgroundColor: ink }]} />
      <View style={[styles.mountain, { backgroundColor: ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: 18, height: 22, borderWidth: 2, overflow: 'hidden' },
  fold: { position: 'absolute', right: -5, top: -5, width: 9, height: 9, borderWidth: 2, transform: [{ rotate: '45deg' }] },
  line: { position: 'absolute', left: 2, right: 4, height: 2 },
  frame: { width: 24, height: 19, borderWidth: 2, overflow: 'hidden' },
  sun: { position: 'absolute', right: 3, top: 2, width: 5, height: 5, borderRadius: 3 },
  mountain: { position: 'absolute', left: 2, bottom: -8, width: 13, height: 13, transform: [{ rotate: '45deg' }] },
  folder: { width: 25, height: 17, marginTop: 5, borderWidth: 2 },
  folderTab: { position: 'absolute', left: -2, top: -7, width: 13, height: 7, borderWidth: 2, borderBottomWidth: 0 },
  symbol: { width: 26, textAlign: 'center', fontSize: 24, lineHeight: 26, fontWeight: '900' },
});
