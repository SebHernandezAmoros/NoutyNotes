import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
  readonly onLink: () => void;
  readonly onTable: (rows: number, columns: number) => void;
  readonly onShape: () => void;
  readonly onConnector: () => void;
}

/** Entrada única de creación (UX7 P10); Conector permanece reservado para P15. */
export function InsertMenu(props: InsertMenuProps) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const [tableOpen, setTableOpen] = useState(false);
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const rowCount = Number(rows);
  const columnCount = Number(columns);
  const validTable = Number.isInteger(rowCount) && rowCount >= 2 && rowCount <= 20
    && Number.isInteger(columnCount) && columnCount >= 1 && columnCount <= 12;
  return (
    <Dialog visible={props.visible} title={t('insert.title', locale)} compact={props.compact} onClose={props.onClose} testID="insert-dialog">
      <View style={styles.list}>
        <InsertGroup testID="insert-group-content" label={t('insert.group.content', locale)}>
          <InsertOption icon="note" label={t('insert.note', locale)} hint={t('insert.note.hint', locale)} onPress={props.onNote} />
          <InsertOption icon="text" label={t('insert.text', locale)} hint={t('insert.text.hint', locale)} onPress={props.onText} />
          <InsertOption icon="text" label={t('insert.heading', locale)} hint={t('insert.heading.hint', locale)} onPress={props.onTitle} />
          <InsertOption icon="upload" label={t('insert.image', locale)} hint={t('insert.image.hint', locale)} onPress={props.onImage} />
          <InsertOption icon="link" label={t('insert.link', locale)} hint={t('insert.link.hint', locale)} onPress={props.onLink} />
          <InsertOption icon="board" label={t('insert.table', locale)} hint={t('insert.table.hint', locale)} onPress={() => setTableOpen((open) => !open)} />
          {tableOpen ? (
            <View testID="insert-table-size" style={[styles.tableSize, { borderColor: theme.colors.gridLine }]}>
              <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>{t('editor.visual.table.hint', locale)}</Text>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: theme.colors.textPrimary }]}>{t('editor.visual.table.rows', locale)}</Text>
                <TextInput accessibilityLabel={t('editor.visual.table.rows', locale)} keyboardType="number-pad" value={rows} onChangeText={setRows}
                  style={[styles.tableInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} />
                <Text style={[styles.tableLabel, { color: theme.colors.textPrimary }]}>{t('editor.visual.table.columns', locale)}</Text>
                <TextInput accessibilityLabel={t('editor.visual.table.columns', locale)} keyboardType="number-pad" value={columns} onChangeText={setColumns}
                  style={[styles.tableInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('editor.visual.table.insert', locale)} accessibilityState={{ disabled: !validTable }}
                  disabled={!validTable} onPress={() => props.onTable(rowCount, columnCount)}
                  style={({ pressed }) => [styles.createTable, { borderColor: theme.colors.border, opacity: !validTable ? 0.45 : pressed ? 0.7 : 1 }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary }]}>{t('editor.visual.table.insert', locale)}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </InsertGroup>
        <InsertGroup testID="insert-group-diagram" label={t('insert.group.diagram', locale)}>
          <InsertOption icon="frame" label={t('insert.shape', locale)} hint={t('insert.shape.hint', locale)} onPress={props.onShape} />
          <InsertOption icon="connect" label={t('insert.connector', locale)} hint={t('insert.connector.hint', locale)} onPress={props.onConnector} />
        </InsertGroup>
      </View>
    </Dialog>
  );
}

function InsertGroup({ testID, label, children }: { readonly testID: string; readonly label: string; readonly children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View testID={testID} accessibilityRole="list" accessibilityLabel={label} style={styles.group}>
      <Text style={[styles.groupLabel, { color: theme.colors.textSecondary }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
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
  list: { gap: 16 },
  group: { gap: 8 },
  groupLabel: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 0.6 },
  option: { minHeight: 56, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 28, alignItems: 'center' },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18 },
  tableSize: { borderWidth: 1, padding: 10, gap: 8 },
  tableRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tableLabel: { fontSize: 13, fontWeight: '700' },
  tableInput: { width: 58, minHeight: 44, borderWidth: 2, paddingHorizontal: 8 },
  createTable: { minHeight: 44, borderWidth: 2, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
