import { useTheme } from '@noutynotes/ui';
import { Image, StyleSheet } from 'react-native';

import mark from '../../assets/branding/mark-transparent.png';

/**
 * Símbolo de NoutyNotes (ADR 0013, decisión 9). El PNG es verde sobre transparente; se tiñe con el
 * token `brand` para que se lea igual en claro y en oscuro. Es decorativo si va junto al nombre.
 */
export function BrandMark({ size, label }: { readonly size: number; readonly label?: string }) {
  const { theme } = useTheme();
  return (
    <Image
      source={mark}
      {...(label === undefined
        ? { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
      resizeMode="contain"
      style={[styles.mark, { width: size, height: size, tintColor: theme.colors.brand }]}
    />
  );
}

const styles = StyleSheet.create({
  mark: { flexShrink: 0 },
});
