import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '../components/AppIcon';
import type { AppIconName } from '../components/AppIcon';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

interface InsertMenuProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly onClose: () => void;
  readonly onNote: () => void;
  readonly onText: () => void;
  readonly onTitle: () => void;
  readonly onImage: () => void;
  readonly onExampleImage: () => void;
  readonly onLink: () => void;
  readonly onTable: () => void;
  readonly onShape: () => void;
  readonly onConnector: () => void;
}

/** Entrada única de creación (UX7 P10); Conector permanece reservado para P15. */
export function InsertMenu(props: InsertMenuProps) {
  const { locale } = useLocale();
  return (
    <Dialog visible={props.visible} title={t('insert.title', locale)} compact={props.compact} onClose={props.onClose} testID="insert-dialog">
      <View style={styles.list}>
        <InsertOption icon="note" label={t('insert.note', locale)} hint={t('insert.note.hint', locale)} onPress={props.onNote} />
        <InsertOption icon="text" label={t('insert.text', locale)} hint={t('insert.text.hint', locale)} onPress={props.onText} />
        <InsertOption icon="text" label={t('insert.heading', locale)} hint={t('insert.heading.hint', locale)} onPress={props.onTitle} />
        <InsertOption icon="upload" label={t('insert.image', locale)} hint={t('insert.image.hint', locale)} onPress={props.onImage} />
        <InsertOption icon="image" label={t('insert.exampleImage', locale)} hint={t('insert.exampleImage.hint', locale)} onPress={props.onExampleImage} />
        <InsertOption icon="link" label={t('insert.link', locale)} hint={t('insert.link.hint', locale)} onPress={props.onLink} />
        <InsertOption icon="board" label={t('insert.table', locale)} hint={t('insert.table.hint', locale)} onPress={props.onTable} />
        <InsertOption icon="frame" label={t('insert.shape', locale)} hint={t('insert.shape.hint', locale)} onPress={props.onShape} />
        <InsertOption icon="connect" label={t('insert.connector', locale)} hint={t('insert.connector.hint', locale)} onPress={props.onConnector} />
      </View>
    </Dialog>
  );
}

function InsertOption({ icon, label, hint, disabled = false, onPress }: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly hint: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.option, {
        borderColor: focused && !disabled ? colors.selection : colors.border,
        backgroundColor: pressed && !disabled ? colors.surfaceRaised : colors.surface,
        opacity: disabled ? 0.55 : 1,
      }]}
    >
      <View style={styles.icon}><AppIcon name={icon} size={24} color={colors.textPrimary} /></View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  option: { minHeight: 56, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 28, alignItems: 'center' },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18 },
});
