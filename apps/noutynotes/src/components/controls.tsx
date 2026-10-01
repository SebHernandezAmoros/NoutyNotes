import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';

type Tone = 'primary' | 'default';

interface ActionButtonProps {
  readonly label: string;
  /** Nombre accesible cuando el texto visible es un símbolo o necesita contexto. */
  readonly accessibilityLabel?: string;
  readonly onPress: () => void;
  readonly tone?: Tone;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}

/** Botón táctil de al menos 44 × 44 con foco visible (borde con el token `selection`). */
export function ActionButton({ label, accessibilityLabel, onPress, tone = 'default', testID, style, pressed, disabled = false }: ActionButtonProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const primary = tone === 'primary' || pressed === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(pressed === undefined ? (disabled ? { accessibilityState: { disabled } } : {}) : { accessibilityState: { selected: pressed, disabled } })}
      disabled={disabled}
      {...(Platform.OS === 'web' && pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      {...(testID === undefined ? {} : { testID })}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.button,
        { backgroundColor: primary ? colors.accent : colors.surface, borderColor: focused && !disabled ? colors.selection : colors.border, opacity: disabled ? 0.5 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? colors.accentText : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

interface ToolButtonProps {
  /** Símbolo visible sobre la etiqueta. */
  readonly glyph?: string;
  /** Icono portable del catálogo común; tiene prioridad sobre `glyph`. */
  readonly icon?: AppIconName;
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly onPress: () => void;
  /** Herramienta activa o interruptor encendido: se anuncia como pulsado y se rellena con el acento. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/** Botón de la barra de herramientas: símbolo y etiqueta corta, 44 × 44 como mínimo, foco visible. */
export function ToolButton({ glyph, icon, label, accessibilityLabel, accessibilityHint, onPress, active, disabled = false, testID, style }: ToolButtonProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const on = active === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ selected: on, disabled }}
      {...(Platform.OS === 'web' && active !== undefined ? { 'aria-pressed': on } : {})}
      {...(testID === undefined ? {} : { testID })}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.tool,
        {
          backgroundColor: on ? colors.accent : colors.surface,
          // Un botón que se desactiva con el foco puede no recibir blur en web: sin foco visible si está desactivado.
          borderColor: focused && !disabled ? colors.selection : on ? colors.border : colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon ? <AppIcon name={icon} size={20} color={on ? colors.accentText : colors.textPrimary} />
        : <Text style={[styles.toolGlyph, { color: on ? colors.accentText : colors.textPrimary }]}>{glyph}</Text>}
      <Text numberOfLines={2} style={[styles.toolLabel, { color: on ? colors.accentText : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly testID?: string;
  readonly onSubmitEditing?: () => void;
  /** Falso mientras el campo no pueda conservar lo que se escriba. */
  readonly editable?: boolean;
  /** Cursor opcional para comandos de edición; sin él, el campo gestiona su propia selección. */
  readonly selection?: { readonly start: number; readonly end: number } | undefined;
  readonly onSelectionChange?: (selection: { start: number; end: number }) => void;
  /** Tipografía de las notas (ADR 0030): solo en el campo de contenido. */
  readonly fontFamily?: string | undefined;
}

/** Campo con etiqueta visible, nombre accesible y foco visible. */
export function TextField({ label, value, onChangeText, placeholder, multiline = false, testID, onSubmitEditing, editable = true, selection, onSelectionChange, fontFamily }: TextFieldProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        {...(selection === undefined ? {} : { selection })}
        {...(onSelectionChange === undefined ? {} : { onSelectionChange: (event) => onSelectionChange(event.nativeEvent.selection) })}
        multiline={multiline}
        editable={editable}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(testID === undefined ? {} : { testID })}
        {...(onSubmitEditing === undefined ? {} : { onSubmitEditing })}
        placeholderTextColor={colors.textSecondary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          { color: colors.textPrimary, backgroundColor: colors.background, borderColor: focused ? colors.selection : colors.border },
          fontFamily === undefined ? null : { fontFamily },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tool: { minHeight: 48, minWidth: 48, paddingHorizontal: 6, paddingVertical: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 1 },
  toolGlyph: { fontSize: 17, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  toolLabel: { fontSize: 11, lineHeight: 13, fontWeight: '700', textAlign: 'center' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 44, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 132, textAlignVertical: 'top' },
});
