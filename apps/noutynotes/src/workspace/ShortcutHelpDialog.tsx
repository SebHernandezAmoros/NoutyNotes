import { useLocale, useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

export function ShortcutHelpDialog({ visible, compact, onClose }: { readonly visible: boolean; readonly compact: boolean; readonly onClose: () => void }) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  // B9-R3-08/B9-R4-07: el resto de combinaciones son símbolos/teclas, válidos en cualquier idioma sin
  // traducir (comprobado contra el manejador real de `Canvas.tsx`: `event.ctrlKey || event.metaKey`).
  // Esa misma comprobación confirma que la tecla Windows real (expuesta como `metaKey` en Windows, igual
  // que ⌘ en Mac) también activa el zoom — se añade «Win» junto a Ctrl/⌘ en vez de dar la impresión de
  // que solo Ctrl funciona ahí. «rueda del ratón»/«mouse wheel» (no solo «rueda») sigue siendo la única
  // palabra de esta fila que necesita traducción real.
  const shortcuts: readonly { heading: TranslationKey; rows: readonly [TranslationKey, string][] }[] = [
    { heading: 'help.general', rows: [['help.save', 'Ctrl/⌘ + S'], ['help.undo', 'Ctrl/⌘ + Z'], ['help.redo', 'Ctrl/⌘ + Shift + Z'], ['help.copy', 'Ctrl/⌘ + C'], ['help.cut', 'Ctrl/⌘ + X'], ['help.paste', 'Ctrl/⌘ + V'], ['help.duplicate', 'Ctrl/⌘ + D']] },
    { heading: 'help.canvas', rows: [['help.move', '← ↑ → ↓'], ['help.resize', 'Shift + ← ↑ → ↓'], ['help.menu', 'Shift + F10'], ['help.zoom', `Ctrl/⌘/Win + ${t('help.zoom.wheel', locale)}`]] },
    { heading: 'help.editor', rows: [['help.link', 'Ctrl/⌘ + K'], ['help.heading', 'Ctrl/⌘ + Alt + 0…6'], ['help.list', 'Ctrl/⌘ + Shift + 7/8/9']] },
    { heading: 'help.presentation', rows: [['help.navigate', '← →'], ['help.close', 'Escape']] },
  ];
  return <Dialog visible={visible} title={t('help.title', locale)} compact={compact} presentation="centered" onClose={onClose} testID="shortcut-help">
    {shortcuts.map(({ heading, rows }) => <View key={heading} style={[styles.section, { borderColor: colors.gridLine, backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t(heading, locale)}</Text>
      {rows.map(([key, command]) => <View key={key} style={styles.row}>
        <Text style={[styles.description, { color: colors.textPrimary }]}>{t(key, locale)}</Text>
        <Text style={[styles.command, { color: colors.textPrimary, borderColor: colors.border }]}>{command}</Text>
      </View>)}
    </View>)}
    <Text style={{ color: colors.textSecondary }}>{t('help.when', locale)}</Text>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t('help.explorerTitle', locale)}</Text>
      <Text style={{ color: colors.textSecondary }}>{t('help.explorerText', locale)}</Text>
    </View>
  </Dialog>;
}

const styles = StyleSheet.create({ section: { gap: 10, borderWidth: 1, padding: 12 }, heading: { fontWeight: '800', fontSize: 18 }, row: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingVertical: 5 }, description: { flex: 1, minWidth: 140, fontSize: 15, lineHeight: 22 }, command: { fontFamily: 'monospace', fontSize: 14, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 3 } });
