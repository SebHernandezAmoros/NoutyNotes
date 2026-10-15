import type { Board } from '@noutynotes/domain';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@noutynotes/ui';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface BoardActionsDialogProps {
  readonly board: Board;
  readonly boardIndex: number;
  readonly boardCount: number;
  readonly compact: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onRename: (title: string) => Promise<boolean>;
  readonly onReorder: (targetIndex: number) => Promise<boolean>;
  readonly onArchive: () => Promise<boolean>;
}

/** Acciones del tablero compartidas por la pestaña móvil y la franja lateral de escritorio. */
export function BoardActionsDialog({ board, boardIndex, boardCount, compact, busy, onClose, onRename, onReorder, onArchive }: BoardActionsDialogProps) {
  const { theme } = useTheme();
  const [title, setTitle] = useState(board.title);
  const [pending, setPending] = useState<'rename' | 'reorder' | 'archive' | null>(null);
  const [status, setStatus] = useState('');
  const locked = busy || pending !== null;
  const cleanTitle = title.trim();
  const canRename = cleanTitle !== '' && cleanTitle !== board.title && !locked;
  const canMoveBefore = boardIndex > 0 && !locked;
  const canMoveAfter = boardIndex >= 0 && boardIndex < boardCount - 1 && !locked;
  const canArchive = board.cardIds.length > 0 && !locked;
  const dialogTitle = `Acciones de ${board.title}`;

  const rename = async () => {
    if (!canRename) return;
    setPending('rename');
    const saved = await onRename(cleanTitle);
    if (saved) setTitle(cleanTitle);
    setStatus(saved ? 'Nombre guardado.' : 'No se pudo guardar el nombre.');
    setPending(null);
  };
  const reorder = async (targetIndex: number) => {
    if (locked || targetIndex < 0 || targetIndex >= boardCount) return;
    setPending('reorder');
    const saved = await onReorder(targetIndex);
    setStatus(saved ? 'Orden guardado automáticamente.' : 'No se pudo guardar el orden.');
    setPending(null);
  };
  const archive = async () => {
    if (!canArchive) return;
    setPending('archive');
    if (!await onArchive()) setPending(null);
  };

  return (
    <Dialog visible title={dialogTitle} compact={compact} onClose={onClose} testID="board-actions-dialog">
      <View style={styles.organizeActions}>
        <TextField label="Nombre del tablero" value={title} onChangeText={(value) => { setTitle(value); setStatus(''); }}
          onSubmitEditing={() => { void rename(); }} editable={!locked} />
        <ActionButton label="Guardar nombre" tone="primary" disabled={!canRename} onPress={() => { void rename(); }} />
        <View style={styles.moveActions}>
          <ActionButton label="Mover antes" style={styles.moveButton} disabled={!canMoveBefore}
            onPress={() => { void reorder(boardIndex - 1); }} />
          <ActionButton label="Mover después" style={styles.moveButton} disabled={!canMoveAfter}
            onPress={() => { void reorder(boardIndex + 1); }} />
        </View>
      </View>
      {status !== '' ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.colors.textSecondary }]}>{status}</Text> : null}
      <View style={[styles.archiveSection, { borderTopColor: theme.colors.border }]}>
        <ActionButton label="Archivar tablero" disabled={!canArchive} onPress={() => { void archive(); }} />
      </View>
      {!canArchive && board.cardIds.length === 0 ? (
        <Text style={[styles.note, { color: theme.colors.textSecondary }]}>Añade al menos una tarjeta antes de archivar este tablero.</Text>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  organizeActions: { gap: 8 },
  moveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moveButton: { flex: 1, minWidth: 140 },
  status: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  archiveSection: { borderTopWidth: 2, paddingTop: 16 },
  note: { fontSize: 13, lineHeight: 18 },
});
