import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
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

/** Configuración del workspace: sección «Lienzo y grilla» (ADR 0014). Todo se aplica al instante. */
export function SettingsPanel(props: SettingsPanelProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { preferences } = props;
  return (
    <Dialog visible={props.visible} title="Configuración" compact={props.compact} onClose={props.onClose} testID="settings-panel">
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>Lienzo y grilla</Text>
        <Toggle
          label="Mostrar grilla"
          description="Líneas de columnas y filas sobre el papel."
          value={preferences.showGrid}
          onChange={(showGrid) => props.onChange({ ...preferences, showGrid })}
        />
        <Toggle
          label="Imán en la vista previa"
          description="Al arrastrar, la ficha salta de celda en celda. Sin imán sigue al puntero; al soltar se guarda siempre la celda entera."
          value={preferences.snap}
          onChange={(snap) => props.onChange({ ...preferences, snap })}
        />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Zoom</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>Solo para esta sesión.</Text>
          </View>
          <ActionButton label="−" accessibilityLabel="Alejar el lienzo" onPress={props.onZoomOut} />
          <Text testID="settings-zoom" style={[styles.value, { color: colors.textPrimary }]}>{formatZoom(props.zoom)}</Text>
          <ActionButton label="+" accessibilityLabel="Acercar el lienzo" onPress={props.onZoomIn} />
        </View>
        <ActionButton label="Restablecer vista (100 %)" accessibilityLabel="Restablecer la vista del lienzo" onPress={props.onResetView} />
        {props.zoom <= MIN_ZOOM || props.zoom >= MAX_ZOOM ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>Límite de zoom: 50–200 %.</Text>
        ) : null}
        <Stepper
          label="Alto de fila"
          unit="px"
          value={preferences.rowHeight}
          limits={PREFERENCE_LIMITS.rowHeight}
          onStep={(direction) => props.onChange(stepPreference(preferences, 'rowHeight', direction))}
        />
        <Stepper
          label="Separación entre fichas"
          unit="px"
          value={preferences.cardGap}
          limits={PREFERENCE_LIMITS.cardGap}
          onStep={(direction) => props.onChange(stepPreference(preferences, 'cardGap', direction))}
        />
        <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.gridLine }]}>
          Estas preferencias se guardan en este dispositivo: no cambian las notas, no viajan con el espacio ni con el ZIP.
          La grilla guarda siempre 12 columnas; en el móvil se ve el mismo lienzo con celdas más pequeñas.
        </Text>
        <ActionButton label="Restablecer valores" accessibilityLabel="Restablecer los valores de lienzo y grilla" onPress={props.onResetDefaults} />
      </View>
    </Dialog>
  );
}

function Toggle({ label, description, value, onChange }: { readonly label: string; readonly description: string; readonly value: boolean; readonly onChange: (value: boolean) => void }) {
  const { theme } = useTheme();
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
      <Text style={[styles.state, { color: colors.textPrimary }]}>{value ? 'Sí' : 'No'}</Text>
    </Pressable>
  );
}

function Stepper({ label, unit, value, limits, onStep }: {
  readonly label: string; readonly unit: string; readonly value: number;
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
      <ActionButton label="−" accessibilityLabel={`Reducir ${label.toLowerCase()}`} onPress={() => onStep(-1)} />
      <Text accessibilityLiveRegion="polite" style={[styles.value, { color: colors.textPrimary }]}>{`${value} ${unit}`}</Text>
      <ActionButton label="+" accessibilityLabel={`Aumentar ${label.toLowerCase()}`} onPress={() => onStep(1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
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
