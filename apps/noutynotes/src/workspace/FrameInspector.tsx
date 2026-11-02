import { addNoteToFrame, moveFrameOnBoard, removeFrameFromBoard, renameFrameOnBoard, resizeFrameOnBoard } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { BoardId, CardId, Frame } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { DialogCloseButton } from '../components/Dialog';
import { t } from '../i18n';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface FrameInspectorProps {
  readonly frame: Frame;
  readonly boardId: BoardId;
  readonly members: number;
  readonly run: Run;
  /** En la hoja móvil, la barra de la hoja ya muestra el título y «Cerrar». */
  readonly inSheet: boolean;
  readonly onClose: () => void;
  /** Abre la selección múltiple con las tarjetas del marco (ADR 0025). */
  readonly onSelectMembers: () => void;
  readonly onNoteAdded: (cardId: CardId) => void;
}

const moves = [
  { label: '←', name: 'frame.moveLeft', dx: -1, dy: 0 },
  { label: '→', name: 'frame.moveRight', dx: 1, dy: 0 },
  { label: '↑', name: 'frame.moveUp', dx: 0, dy: -1 },
  { label: '↓', name: 'frame.moveDown', dx: 0, dy: 1 },
] as const;

/** Editor de un marco (ADR 0027): título, posición, tamaño, nota dentro, sus tarjetas y quitarlo. */
export function FrameInspector({ frame, boardId, members, run, inSheet, onClose, onSelectMembers, onNoteAdded }: FrameInspectorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [title, setTitle] = useState(frame.title);
  const target = { boardId, frameId: frame.id };
  const rename = () => {
    if (title.trim() === frame.title) return;
    void run((storage, id) => renameFrameOnBoard(storage, id, { ...target, title }), 'action.frameRenamed');
  };
  const resize = (dw: number, dh: number) => {
    void run((storage, id) => resizeFrameOnBoard(storage, id, { ...target, size: { w: frame.rect.w + dw, h: frame.rect.h + dh } }), 'action.frameSizeChanged');
  };
  const addNote = async () => {
    // La fecha de creación la pone la interfaz (ADR 0024).
    const result = await run((storage, id) => addNoteToFrame(storage, id, { ...target, createdAt: new Date().toISOString() }), 'action.frameNoteAdded');
    if (result.ok) onNoteAdded(result.value);
  };
  const remove = async () => {
    const result = await run((storage, id) => removeFrameFromBoard(storage, id, target), 'action.frameRemoved');
    if (result.ok) onClose();
  };
  return (
    <View testID="frame-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {inSheet ? null : (
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('frame.selected', locale)}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{frame.title}</Text>
          </View>
          <DialogCloseButton label={t('frame.close', locale)} onPress={onClose} />
        </View>
      )}
      <View style={styles.section}>
        <TextField label={t('frame.title', locale)} value={title} onChangeText={setTitle} onSubmitEditing={rename} testID="frame-title-input" />
        {title.trim() !== frame.title ? <ActionButton label={t('frame.saveTitle', locale)} tone="primary" accessibilityLabel={t('frame.saveTitleLabel', locale)} onPress={rename} /> : null}
        <Text testID="frame-members" style={[styles.hint, { color: colors.textSecondary }]}>
          {members === 0 ? t('frame.empty', locale) : t(members === 1 ? 'frame.memberOne' : 'frame.memberMany', locale, { count: String(members) })}
        </Text>
      </View>
      <View style={styles.section}>
        <ActionButton label={t('frame.addNote', locale)} tone="primary" onPress={() => void addNote()} />
        {members > 0 ? <ActionButton label={t('frame.selectCards', locale)} accessibilityLabel={t('frame.selectCardsLabel', locale)} onPress={onSelectMembers} /> : null}
      </View>
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('frame.geometry', locale)}</Text>
        <Text testID="frame-geometry" style={[styles.hint, { color: colors.textPrimary }]}>
          {`${frame.rect.x < 0 || frame.rect.y < 0 ? `X ${frame.rect.x}, Y ${frame.rect.y}` : t('frame.columnRow', locale, { column: String(frame.rect.x + 1), row: String(frame.rect.y + 1) })} · ${frame.rect.w} × ${frame.rect.h}`}
        </Text>
        <View style={styles.row}>
          {moves.map((move) => (
            <ActionButton key={move.name} label={move.label} accessibilityLabel={t(move.name, locale)}
              onPress={() => void run((storage, id) => moveFrameOnBoard(storage, id, { ...target, delta: { x: move.dx, y: move.dy } }), 'action.frameMoved')} />
          ))}
        </View>
        <View style={styles.row}>
          <ActionButton label={t('frame.widthMinus', locale)} accessibilityLabel={t('frame.narrower', locale)} onPress={() => resize(-1, 0)} />
          <ActionButton label={t('frame.widthPlus', locale)} accessibilityLabel={t('frame.wider', locale)} onPress={() => resize(1, 0)} />
          <ActionButton label={t('frame.heightMinus', locale)} accessibilityLabel={t('frame.shorter', locale)} onPress={() => resize(0, -1)} />
          <ActionButton label={t('frame.heightPlus', locale)} accessibilityLabel={t('frame.taller', locale)} onPress={() => resize(0, 1)} />
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('frame.dragHint', locale)}</Text>
      </View>
      <View style={styles.section}>
        <ActionButton label={t('frame.remove', locale)} accessibilityLabel={t('frame.removeNamed', locale, { title: frame.title })} onPress={() => void remove()} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('frame.removeHint', locale)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, padding: 14, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heading: { fontSize: 20, fontWeight: '900' },
  section: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  hint: { fontSize: 13, lineHeight: 18 },
});
