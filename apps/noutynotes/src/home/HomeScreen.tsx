import { useTheme } from '@noutynotes/ui';
import type { ThemePreference } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'system', label: 'Sistema' },
];

const workspaceActions = [
  { number: '01', title: 'Crear un espacio', description: 'Una página en blanco para lo que viene.', symbol: '+' },
  { number: '02', title: 'Abrir una carpeta', description: 'Vuelve al lugar donde dejaste tus ideas.', symbol: '↗' },
  { number: '03', title: 'Usar una plantilla', description: 'Un pequeño punto de partida.', symbol: '▦' },
];

export function HomeScreen() {
  const { theme, preference, setPreference } = useTheme();
  const colors = theme.colors;
  const { width } = useWindowDimensions();
  const compact = width < 800;
  const [focusedTheme, setFocusedTheme] = useState<ThemePreference | null>(null);

  return (
    <SafeAreaView testID="home-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.page, { padding: compact ? 20 : 44 }]}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <Text style={[styles.brandInitial, { color: colors.accentText }]}>N.</Text>
            </View>
            <Text style={[styles.brandName, { color: colors.textPrimary }]}>NoutyNotes</Text>
          </View>

          <View accessibilityLabel="Apariencia" style={[styles.themeControl, { borderColor: colors.border }]}>
            {themeOptions.map(({ value, label }) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Tema ${label.toLowerCase()}`}
                accessibilityState={{ selected: preference === value }}
                {...(Platform.OS === 'web' ? { 'aria-pressed': preference === value } : {})}
                onPress={() => setPreference(value)}
                onFocus={() => setFocusedTheme(value)}
                onBlur={() => setFocusedTheme(null)}
                style={[
                  styles.themeButton,
                  {
                    backgroundColor: preference === value ? colors.accent : colors.surface,
                    borderColor: focusedTheme === value ? colors.selection : colors.surface,
                  },
                ]}
              >
                <Text style={[styles.themeLabel, { color: preference === value ? colors.accentText : colors.textPrimary }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.metaRow, { borderColor: colors.gridLine }]}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>TU MESA DE IDEAS</Text>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>EDICIÓN INICIAL / 01</Text>
        </View>

        <View style={[styles.main, { flexDirection: compact ? 'column' : 'row', gap: compact ? 36 : 56 }]}>
          <View style={styles.introduction}>
            <View style={[styles.label, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.accentText }]}>MENOS RUIDO. MÁS IDEAS.</Text>
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 44 : 64 }]}>
              Dale un lugar{ '\n' }a tus ideas.
            </Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              Notas, imágenes y conexiones.{ '\n' }Un espacio propio para pensar con calma.
            </Text>

            <View style={[styles.note, { backgroundColor: colors.note, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.noteText }]}>UNA PEQUEÑA DECLARACIÓN</Text>
              <Text style={[styles.noteText, { color: colors.noteText }]}>
                Tus ideas merecen{ '\n' }un espacio que sea tuyo.
              </Text>
              <View style={[styles.noteLine, { backgroundColor: colors.noteText }]} />
            </View>
          </View>

          <View style={styles.workspaceSection}>
            <View style={[styles.folderTab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.textPrimary }]}>001 / TU ESPACIO</Text>
            </View>
            <View style={[styles.workspace, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text accessibilityRole="header" style={[styles.panelTitle, { color: colors.textPrimary }]}>
                Todo empieza{ '\n' }con una idea.
              </Text>
              <Text style={[styles.panelDescription, { color: colors.textSecondary }]}>
                Estamos preparando tu mesa de trabajo.
              </Text>
              <View style={styles.actions}>
                {workspaceActions.map((action) => (
                  <Pressable
                    key={action.number}
                    disabled
                    accessibilityRole="button"
                    accessibilityLabel={action.title}
                    accessibilityHint="Disponible en una próxima versión"
                    accessibilityState={{ disabled: true }}
                    style={[styles.action, { borderColor: colors.gridLine }]}
                  >
                    <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{action.number}</Text>
                    <View style={styles.actionText}>
                      <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{action.title}</Text>
                      <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{action.description}</Text>
                    </View>
                    <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>{action.symbol}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.comingSoon, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.comingSoonText, { color: colors.textSecondary }]}>
                  PRÓXIMAMENTE · Crear y abrir espacios estará disponible en una próxima versión.
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.footer, { borderColor: colors.border }]}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>PENSADO PARA LO LOCAL.</Text>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>NOUTYNOTES / 0.1</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const display = Platform.select({ web: 'Arial Black, Arial, sans-serif', android: 'sans-serif-black', default: 'System' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 22, paddingBottom: 24, borderBottomWidth: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 46, height: 46, borderWidth: 2, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] },
  brandInitial: { fontSize: 26, fontWeight: '900' },
  brandName: { fontSize: 27, fontWeight: '900', letterSpacing: -1 },
  themeControl: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 2 },
  themeButton: { minHeight: 44, minWidth: 68, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  themeLabel: { fontSize: 13, fontWeight: '600' },
  metaRow: { paddingVertical: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1 },
  eyebrow: { fontFamily: mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  main: { flex: 1, alignItems: 'stretch', paddingVertical: 52 },
  introduction: { flex: 1, minWidth: 0, justifyContent: 'center' },
  label: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginBottom: 24 },
  title: { fontFamily: display, fontWeight: '900', letterSpacing: -2.5, marginBottom: 22 },
  description: { fontSize: 18, lineHeight: 29 },
  note: { marginTop: 36, padding: 22, borderWidth: 1, alignSelf: 'flex-start', maxWidth: '100%', transform: [{ rotate: '-2deg' }] },
  noteText: { fontSize: 21, lineHeight: 30, fontWeight: '600', marginTop: 14 },
  noteLine: { width: 70, height: 2, marginTop: 20 },
  workspaceSection: { flex: 1, minWidth: 0, justifyContent: 'center', paddingTop: 8 },
  folderTab: { alignSelf: 'flex-start', borderWidth: 2, borderBottomWidth: 0, paddingHorizontal: 20, paddingVertical: 12, borderTopRightRadius: 16 },
  workspace: { borderWidth: 2, padding: 24 },
  panelTitle: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  panelDescription: { fontSize: 15, lineHeight: 23, marginTop: 12 },
  actions: { marginTop: 28 },
  action: { borderTopWidth: 1, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionNumber: { fontFamily: mono, fontSize: 11 },
  actionText: { flex: 1 },
  actionTitle: { fontSize: 17, fontWeight: '700' },
  actionDescription: { fontSize: 13, lineHeight: 20, marginTop: 5 },
  actionSymbol: { fontSize: 24 },
  comingSoon: { marginTop: 8, padding: 14 },
  comingSoonText: { fontSize: 12, lineHeight: 19 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, paddingTop: 18, borderTopWidth: 2 },
});
