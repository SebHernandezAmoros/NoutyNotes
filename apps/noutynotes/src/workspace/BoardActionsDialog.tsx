import type { Board } from '@noutynotes/domain';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@noutynotes/ui';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface BoardActionsDialogProps {
  readonly board: Board;
  readonly compact: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onRename: (title: string) => Promise<boolean>;
  readonly onArchive: () => Promise<boolean>;
}

/** Acciones del tablero compartidas por la pestaña móvil y la franja lateral de escritorio. */
export function BoardActionsDialog({ board, compact, busy, onClose, onRename, onArchive }: BoardActionsDialogProps) {
  const { theme } = useTheme();
  const [title, setTitle] = useState(board.title);
  const clean = title.trim();
  const canRename = clean !== '' && clean !== board.title && !busy;
  const canArchive = board.cardIds.length > 0 && !busy;
  const dialogTitle = `Opciones de ${board.title}`;

  return (
    <Dialog visible title={dialogTitle} compact={compact} onClose={onClose} testID="board-actions-dialog">
      <TextField
        label="Nombre del tablero"
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={() => { if (canRename) void onRename(clean); }}
      />
      <View style={styles.actions}>
        <ActionButton label="Guardar nombre" disabled={!canRename} tone="primary" onPress={() => { void onRename(clean); }} />
        <ActionButton label="Archivar tablero" disabled={!canArchive} onPress={() => { void onArchive(); }} />
      </View>
      {!canArchive && board.cardIds.length === 0 ? (
        <Text style={[styles.note, { color: theme.colors.textSecondary }]}>Añade al menos una tarjeta antes de archivar este tablero.</Text>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  note: { fontSize: 13, lineHeight: 18 },
});
