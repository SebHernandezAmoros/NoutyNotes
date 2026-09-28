import { useLocale, useTheme } from '@noutynotes/ui';
import type { Locale, ThemePreference } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { NOTE_FONT_VALUES } from './fonts';
import { PREFERENCE_LIMITS, stepPreference } from './canvas/preferences';
import type { ViewPreferences } from './canvas/preferences';
import { MAX_ZOOM, MIN_ZOOM, formatZoom } from './canvas/viewport';

interface SettingsPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly preferences: ViewPreferences;
  readonly onChange: (preferences: ViewPreferences) => void;
  readonly onResetDefaults: () => void;
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetView: () => void;
  readonly onClose: () => void;
}

const themes: readonly ThemePreference[] = ['light', 'dark', 'system'];
const themeLabelKey = { light: 'settings.theme.light', dark: 'settings.theme.dark', system: 'settings.theme.system' } as const;
const themeUseKey = { light: 'settings.theme.use.light', dark: 'settings.theme.use.dark', system: 'settings.theme.use.system' } as const;
const fontLabelKey = { system: 'settings.font.system', serif: 'settings.font.serif', mono: 'settings.font.mono' } as const;
const fontUseKey = { system: 'settings.font.use.system', serif: 'settings.font.use.serif', mono: 'settings.font.use.mono' } as const;

/** Nombre de un idioma en sí mismo (no se traduce: «English» se ve igual venga del idioma que venga). */
const languageNames: Record<Locale, string> = { es: 'Español', en: 'English' };
const languageUseKey = { es: 'settings.language.use.es', en: 'settings.language.use.en' } as const;

/**
 * Configuración del workspace (ADR 0014, ADR 0029, ADR 0032): apariencia, idioma, fechas, tipografía y
 * lienzo. Todo es del dispositivo y se aplica al instante; ninguna preferencia cambia las notas ni viaja
 * con el espacio. El idioma de este panel es el de la interfaz (ADR 0032); las notas no se traducen.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const { theme, preference, setPreference } = useTheme();
  const { locale, setLocale } = useLocale();
  const colors = theme.colors;
  const { preferences } = props;
  return (
    <Dialog visible={props.visible} title={t('settings.title', locale)} compact={props.compact} onClose={props.onClose} testID="settings-panel">
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.appearance', locale)}</Text>
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={t('settings.theme.group', locale)}>
          {themes.map((value) => (
            <ActionButton key={value} label={t(themeLabelKey[value], locale)} accessibilityLabel={t(themeUseKey[value], locale)} pressed={preference === value} onPress={() => setPreference(value)} />
          ))}
        </View>
        <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('settings.appearance.note', locale)}</Text>
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.language', locale)}</Text>
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={t('settings.language', locale)}>
          {(['es', 'en'] as const).map((value) => (
            <ActionButton key={value} label={languageNames[value]} accessibilityLabel={t(languageUseKey[value], locale)} pressed={locale === value} onPress={() => setLocale(value)} />
          ))}
        </View>
        <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('settings.language.note', locale)}</Text>
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.dates', locale)}</Text>
        <Toggle
          label={t('settings.dates.show', locale)}
          description={t('settings.dates.show.description', locale)}
          value={preferences.showDates}
          onChange={(showDates) => props.onChange({ ...preferences, showDates })}
        />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.fonts', locale)}</Text>
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={t('settings.fonts.group', locale)}>
          {NOTE_FONT_VALUES.map((value) => (
            <ActionButton key={value} label={t(fontLabelKey[value], locale)} accessibilityLabel={t(fontUseKey[value], locale)}
              pressed={preferences.noteFont === value} onPress={() => props.onChange({ ...preferences, noteFont: value })} />
          ))}
          {/* Solo si ya hay una fuente activada en este workspace (ADR 0041): sin eso, un botón sin función. */}
          {preferences.customFontRef !== null ? (
            <ActionButton label={t('settings.font.custom', locale)} accessibilityLabel={t('settings.font.use.custom', locale)}
              pressed={preferences.noteFont === 'custom'} onPress={() => props.onChange({ ...preferences, noteFont: 'custom' })} />
          ) : null}
        </View>
        <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('settings.fonts.note', locale)}</Text>
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t('settings.canvas', locale)}</Text>
        <Toggle
          label={t('settings.grid.show', locale)}
          description={t('settings.grid.show.description', locale)}
          value={preferences.showGrid}
          onChange={(showGrid) => props.onChange({ ...preferences, showGrid })}
        />
        <Toggle
          label={t('settings.snap', locale)}
          description={t('settings.snap.description', locale)}
          value={preferences.snap}
          onChange={(snap) => props.onChange({ ...preferences, snap })}
        />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>{t('settings.zoom', locale)}</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>{t('settings.zoom.description', locale)}</Text>
          </View>
          <ActionButton label="−" accessibilityLabel={t('settings.zoom.out', locale)} onPress={props.onZoomOut} />
          <Text testID="settings-zoom" style={[styles.value, { color: colors.textPrimary }]}>{formatZoom(props.zoom)}</Text>
          <ActionButton label="+" accessibilityLabel={t('settings.zoom.in', locale)} onPress={props.onZoomIn} />
        </View>
        <ActionButton label={t('settings.zoom.resetView', locale)} accessibilityLabel={t('settings.zoom.resetView.label', locale)} onPress={props.onResetView} />
        {props.zoom <= MIN_ZOOM || props.zoom >= MAX_ZOOM ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>{t('settings.zoom.limit', locale)}</Text>
        ) : null}
        <Stepper
          label={t('settings.rowHeight', locale)}
          decreaseLabel={t('settings.rowHeight.decrease', locale)}
          increaseLabel={t('settings.rowHeight.increase', locale)}
          unit="px"
          value={preferences.rowHeight}
          limits={PREFERENCE_LIMITS.rowHeight}
          onStep={(direction) => props.onChange(stepPreference(preferences, 'rowHeight', direction))}
        />
        <Stepper
          label={t('settings.cardGap', locale)}
          decreaseLabel={t('settings.cardGap.decrease', locale)}
          increaseLabel={t('settings.cardGap.increase', locale)}
          unit="px"
          value={preferences.cardGap}
          limits={PREFERENCE_LIMITS.cardGap}
          onStep={(direction) => props.onChange(stepPreference(preferences, 'cardGap', direction))}
        />
        <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('settings.canvas.note', locale)}</Text>
        <ActionButton label={t('settings.resetDefaults', locale)} accessibilityLabel={t('settings.resetDefaults.label', locale)} onPress={props.onResetDefaults} />
      </View>
    </Dialog>
  );
}

function Toggle({ label, description, value, onChange }: { readonly label: string; readonly description: string; readonly value: boolean; readonly onChange: (value: boolean) => void }) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      {...(Platform.OS === 'web' ? { 'aria-checked': value } : {})}
      onPress={() => onChange(!value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, styles.toggle, { borderColor: focused ? colors.selection : colors.gridLine }]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: value ? colors.accent : colors.surfaceRaised, borderColor: colors.border }]}>
        <View style={[styles.thumb, { backgroundColor: value ? colors.accentText : colors.surface, borderColor: colors.border, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
      <Text style={[styles.state, { color: colors.textPrimary }]}>{value ? t('toggle.yes', locale) : t('toggle.no', locale)}</Text>
    </Pressable>
  );
}

function Stepper({ label, decreaseLabel, increaseLabel, unit, value, limits, onStep }: {
  readonly label: string; readonly decreaseLabel: string; readonly increaseLabel: string; readonly unit: string; readonly value: number;
  readonly limits: { readonly min: number; readonly max: number }; readonly onStep: (direction: 1 | -1) => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{`${limits.min}–${limits.max} ${unit}`}</Text>
      </View>
      <ActionButton label="−" accessibilityLabel={decreaseLabel} onPress={() => onStep(-1)} />
      <Text accessibilityLiveRegion="polite" style={[styles.value, { color: colors.textPrimary }]}>{`${value} ${unit}`}</Text>
      <ActionButton label="+" accessibilityLabel={increaseLabel} onPress={() => onStep(1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginBottom: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  toggle: { borderWidth: 2, padding: 8 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 15, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 18 },
  value: { minWidth: 64, textAlign: 'center', fontSize: 15, fontWeight: '800' },
  track: { width: 44, height: 26, borderWidth: 2, padding: 2, justifyContent: 'center' },
  thumb: { width: 16, height: 16, borderWidth: 2 },
  state: { width: 24, fontSize: 13, fontWeight: '800' },
  note: { fontSize: 13, lineHeight: 18, borderLeftWidth: 3, paddingLeft: 10 },
});
