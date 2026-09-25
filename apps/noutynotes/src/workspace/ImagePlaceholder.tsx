import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Marcador de imagen dibujado con vistas: no hay archivo ni asset detrás (ADR 0009). Las imágenes
 * locales reales llegarán con los adaptadores de archivos.
 */
export function ImagePlaceholder() {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Imagen de ejemplo (marcador de posición, sin archivo)"
      style={[styles.frame, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.sun, { backgroundColor: colors.accent, borderColor: colors.border }]} />
      <View style={[styles.hill, styles.hillBack, { backgroundColor: colors.gridLine, borderColor: colors.border }]} />
      <View style={[styles.hill, styles.hillFront, { backgroundColor: colors.note, borderColor: colors.border }]} />
      <Text style={[styles.caption, { color: colors.textPrimary, backgroundColor: colors.surface }]}>IMAGEN DE EJEMPLO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 48, borderWidth: 1, overflow: 'hidden' },
  sun: { position: 'absolute', top: 10, right: 14, width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  hill: { position: 'absolute', width: 120, height: 120, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  hillBack: { left: -30, bottom: -95 },
  hillFront: { left: 40, bottom: -105 },
  caption: { position: 'absolute', left: 6, top: 6, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 4 },
});
