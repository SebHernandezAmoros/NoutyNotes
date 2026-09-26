import { useTheme } from '@noutynotes/ui';
import { StyleSheet, View } from 'react-native';

/**
 * Icono de la ficha minimizada (ADR 0016), dibujado con vistas: igual en web y Android, sin fuentes de
 * iconos ni emoji. Nota: hoja con renglones y esquina doblada. Imagen: marco con sol y montaña.
 */
export function CardIcon({ kind, testID }: { readonly kind: 'note' | 'image'; readonly testID?: string }) {
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
});
