import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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
}

/** Botón táctil de al menos 44 × 44 con foco visible (borde con el token `selection`). */
export function ActionButton({ label, accessibilityLabel, onPress, tone = 'default', testID, style, pressed }: ActionButtonProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const primary = tone === 'primary' || pressed === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(pressed === undefined ? {} : { accessibilityState: { selected: pressed } })}
      {...(Platform.OS === 'web' && pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      {...(testID === undefined ? {} : { testID })}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.button,
        { backgroundColor: primary ? colors.accent : colors.surface, borderColor: focused ? colors.selection : colors.border },
        style,
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? colors.accentText : colors.textPrimary }]}>{label}</Text>
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
}

/** Campo con etiqueta visible, nombre accesible y foco visible. */
export function TextField({ label, value, onChangeText, placeholder, multiline = false, testID, onSubmitEditing, editable = true }: TextFieldProps) {
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
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 44, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 132, textAlignVertical: 'top' },
});
