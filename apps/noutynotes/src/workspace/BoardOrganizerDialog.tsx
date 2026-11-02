import type { Board, BoardId } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { createElement, useState } from 'react';
import type { DragEvent } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

interface BoardOrganizerDialogProps {
  readonly boards: readonly Board[];
  readonly current: BoardId | undefined;
  readonly compact: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onRename: (boardId: BoardId, title: string) => Promise<boolean>;
  readonly onReorder: (boardId: BoardId, targetIndex: number) => Promise<boolean>;
  readonly onActions: (boardId: BoardId) => void;
}

/** Punto único para ordenar y renombrar tableros, con arrastre y alternativa accesible. */
export function BoardOrganizerDialog({ boards, current, compact, busy, onClose, onRename, onReorder, onActions }: BoardOrganizerDialogProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [selectedId, setSelectedId] = useState<BoardId | undefined>(current ?? boards[0]?.id);
  const [title, setTitle] = useState(() => boards.find(({ id }) => id === (current ?? boards[0]?.id))?.title ?? '');
  const [draggingId, setDraggingId] = useState<BoardId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<TranslationKey | null>(null);
  const selectedIndex = boards.findIndex(({ id }) => id === selectedId);
  const selected = selectedIndex >= 0 ? boards[selectedIndex] : boards[0];

  const reorder = async (boardId: BoardId, targetIndex: number) => {
    const saved = await onReorder(boardId, targetIndex);
    setStatus(saved ? 'boards.savedOrder' : 'boards.failedOrder');
  };
  const rename = async () => {
    if (!selected) return;
    const clean = title.trim();
    if (clean === '' || clean === selected.title || busy) return;
    const saved = await onRename(selected.id, clean);
    setStatus(saved ? 'boards.savedName' : 'boards.failedName');
  };

  return (
    <Dialog visible title={t('boards.organize', locale)} compact={compact} onClose={onClose} testID="board-organizer-dialog">
      <Text style={[styles.help, { color: colors.textSecondary }]}>{t('boards.organizeHint', locale)}</Text>
      <View accessibilityLabel={t('boards.order', locale)} style={styles.list}>
        {boards.map((board, index) => {
          const selectedRow = board.id === selected?.id;
          const row = (
            <View style={[styles.row, {
              backgroundColor: selectedRow ? colors.surfaceRaised : colors.surface,
              borderColor: dropIndex === index && draggingId !== board.id ? colors.selection : colors.border,
              borderTopWidth: dropIndex === index && draggingId !== board.id ? 4 : 2,
              opacity: draggingId === board.id ? 0.55 : 1,
            }]}>
              <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.handle, { color: colors.textSecondary }]}>≡</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('boards.select', locale, { board: board.title })}
                accessibilityState={{ selected: selectedRow }} onPress={() => {
                  if (!selectedRow) setTitle(board.title);
                  setSelectedId(board.id);
                  setStatus(null);
                }} style={styles.nameButton}>
                <Text numberOfLines={1} style={[styles.index, { color: colors.textSecondary }]}>{String(index + 1).padStart(2, '0')}</Text>
                <Text numberOfLines={1} style={[styles.name, { color: colors.textPrimary }]}>{board.title}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('boards.more', locale, { board: board.title })}
                onPress={() => onActions(board.id)} style={[styles.more, { borderColor: colors.border }]}>
                <Text style={[styles.moreText, { color: colors.textPrimary }]}>⋯</Text>
              </Pressable>
            </View>
          );
          return Platform.OS === 'web' ? createElement('div', {
            key: board.id,
            draggable: true,
            'aria-label': t('boards.drag', locale, { board: board.title }),
            onDragStart: (event: DragEvent<HTMLDivElement>) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', board.id);
              setDraggingId(board.id);
              setDropIndex(index);
            },
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropIndex(index);
            },
            onDrop: (event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              event.stopPropagation();
              if (draggingId !== null && draggingId !== board.id) void reorder(draggingId, index);
              setDraggingId(null);
              setDropIndex(null);
            },
            onDragEnd: () => { setDraggingId(null); setDropIndex(null); },
          }, row) : <View key={board.id}>{row}</View>;
        })}
      </View>
      {selected ? (
        <View style={styles.selectionActions}>
          <TextField label={t('boards.selectedName', locale)} value={title} onChangeText={setTitle}
            onSubmitEditing={() => { void rename(); }} editable={!busy} />
          <ActionButton label={t('boards.saveName', locale)} tone="primary"
            disabled={title.trim() === '' || title.trim() === selected.title || busy} onPress={() => { void rename(); }} />
          <View style={styles.moveActions}>
            <ActionButton label={t('boards.moveBefore', locale)} disabled={selectedIndex <= 0 || busy}
              onPress={() => { if (selectedIndex > 0) void reorder(selected.id, selectedIndex - 1); }} />
            <ActionButton label={t('boards.moveAfter', locale)} disabled={selectedIndex < 0 || selectedIndex >= boards.length - 1 || busy}
              onPress={() => { if (selectedIndex >= 0 && selectedIndex < boards.length - 1) void reorder(selected.id, selectedIndex + 1); }} />
          </View>
        </View>
      ) : null}
      {status ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.textSecondary }]}>{t(status, locale)}</Text> : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, lineHeight: 18 },
  list: { gap: 6 },
  row: { minHeight: 48, borderWidth: 2, flexDirection: 'row', alignItems: 'center' },
  handle: { width: 40, textAlign: 'center', fontSize: 24, fontWeight: '900' },
  nameButton: { minHeight: 44, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  index: { fontSize: 11, fontWeight: '900' },
  name: { flex: 1, fontSize: 14, fontWeight: '800' },
  more: { width: 44, height: 44, borderLeftWidth: 2, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 22, lineHeight: 24, fontWeight: '900' },
  selectionActions: { gap: 8 },
  moveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
