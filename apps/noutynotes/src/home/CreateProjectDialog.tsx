import { useLocale, useTheme } from '@noutynotes/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { ProjectCreationTarget } from './projectCreation';

interface CreateProjectDialogProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly name: string;
  readonly target: ProjectCreationTarget;
  readonly selecting: boolean;
  readonly creating: boolean;
  readonly createdPending: boolean;
  readonly error: string | null;
  readonly onNameChange: (name: string) => void;
  readonly onChooseFolder: () => void;
  readonly onCancel: () => void;
  readonly onCreate: () => void;
}

export function CreateProjectDialog(props: CreateProjectDialogProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const disabled = props.creating || props.selecting;
  const editingDisabled = disabled || props.createdPending;
  return (
    <Dialog visible={props.visible} compact={props.compact} title={t('home.create.dialog.title', locale)} onClose={props.onCancel} testID="create-project-dialog">
      <TextField
        label={t('home.create.dialog.name', locale)}
        value={props.name}
        onChangeText={props.onNameChange}
        placeholder={t('home.create.dialog.placeholder', locale)}
        editable={!editingDisabled}
        onSubmitEditing={props.onCreate}
      />
      <View testID="create-project-destination" style={[styles.destination, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('home.create.dialog.destination', locale)}</Text>
        <Text style={[styles.folder, { color: colors.textPrimary }]}>{props.target.folderName}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t(props.target.kind === 'local-pending' ? 'folder.choose.destination' : props.target.kind === 'current' && props.target.backend === 'memory' ? 'folder.temporary.warning' : 'home.create.dialog.destinationHint', locale)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.create.dialog.chooseFolder', locale)}
          accessibilityState={{ disabled: editingDisabled }}
          disabled={editingDisabled}
          onPress={props.onChooseFolder}
          style={[styles.choose, { borderColor: colors.border }]}
        >
          <Text style={[styles.chooseText, { color: colors.textPrimary }]}>{t(props.selecting ? 'home.create.dialog.checkingFolder' : 'home.create.dialog.chooseFolder', locale)}</Text>
        </Pressable>
      </View>
      {props.error ? <Text accessibilityRole="alert" style={[styles.error, { borderColor: colors.border, color: colors.textPrimary }]}>{props.error}</Text> : null}
      <View style={styles.actions}>
        <ActionButton label={t('home.create.dialog.cancel', locale)} disabled={props.creating} onPress={props.onCancel} style={styles.button} />
        <ActionButton label={t(props.creating ? 'home.create.dialog.creating' : props.createdPending ? 'home.create.dialog.retryOpen' : 'home.create.dialog.submit', locale)} disabled={disabled || props.target.kind === 'local-pending'} onPress={props.onCreate} tone="primary" style={styles.button} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  destination: { borderWidth: 2, padding: 14, gap: 6 },
  label: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  folder: { fontSize: 17, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 19 },
  choose: { minHeight: 44, borderWidth: 2, marginTop: 6, paddingHorizontal: 12, alignSelf: 'flex-start', justifyContent: 'center' },
  chooseText: { fontSize: 14, fontWeight: '700' },
  error: { borderWidth: 1, padding: 12, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  button: { minWidth: 140 },
});
