import { addNoteToFrame, moveFrameOnBoard, removeFrameFromBoard, renameFrameOnBoard, resizeFrameOnBoard } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { BoardId, CardId, Frame } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

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
  { label: '←', name: 'Mover el marco a la izquierda', dx: -1, dy: 0 },
  { label: '→', name: 'Mover el marco a la derecha', dx: 1, dy: 0 },
  { label: '↑', name: 'Mover el marco arriba', dx: 0, dy: -1 },
  { label: '↓', name: 'Mover el marco abajo', dx: 0, dy: 1 },
] as const;

/** Editor de un marco (ADR 0027): título, posición, tamaño, nota dentro, sus tarjetas y quitarlo. */
export function FrameInspector({ frame, boardId, members, run, inSheet, onClose, onSelectMembers, onNoteAdded }: FrameInspectorProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [title, setTitle] = useState(frame.title);
  const target = { boardId, frameId: frame.id };
  const rename = () => {
    if (title.trim() === frame.title) return;
    void run((storage, id) => renameFrameOnBoard(storage, id, { ...target, title }), 'Marco renombrado. Guardado en memoria.');
  };
  const resize = (dw: number, dh: number) => {
    void run((storage, id) => resizeFrameOnBoard(storage, id, { ...target, size: { w: frame.rect.w + dw, h: frame.rect.h + dh } }), 'Tamaño del marco cambiado. Guardado en memoria.');
  };
  const addNote = async () => {
    // La fecha de creación la pone la interfaz (ADR 0024).
    const result = await run((storage, id) => addNoteToFrame(storage, id, { ...target, createdAt: new Date().toISOString() }), 'Nota añadida en el marco. Guardado en memoria.');
    if (result.ok) onNoteAdded(result.value);
  };
  const remove = async () => {
    const result = await run((storage, id) => removeFrameFromBoard(storage, id, target), 'Marco quitado; sus tarjetas siguen en el tablero. Guardado en memoria.');
    if (result.ok) onClose();
  };
  return (
    <View testID="frame-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {inSheet ? null : (
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>MARCO SELECCIONADO</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{frame.title}</Text>
          </View>
          <ActionButton label="Cerrar" accessibilityLabel="Cerrar el editor del marco" onPress={onClose} />
        </View>
      )}
      <View style={styles.section}>
        <TextField label="Título del marco" value={title} onChangeText={setTitle} onSubmitEditing={rename} testID="frame-title-input" />
        {title.trim() !== frame.title ? <ActionButton label="Guardar título" tone="primary" accessibilityLabel="Guardar el título del marco" onPress={rename} /> : null}
        <Text testID="frame-members" style={[styles.hint, { color: colors.textSecondary }]}>
          {members === 0 ? 'Sin tarjetas: arrastra tarjetas dentro o añade una nota.' : `${members === 1 ? '1 tarjeta' : `${members} tarjetas`} dentro. Una tarjeta es del marco si está entera dentro.`}
        </Text>
      </View>
      <View style={styles.section}>
        <ActionButton label="Añadir nota en el marco" tone="primary" onPress={() => void addNote()} />
        {members > 0 ? <ActionButton label="Seleccionar sus tarjetas" accessibilityLabel="Seleccionar las tarjetas del marco" onPress={onSelectMembers} /> : null}
      </View>
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>POSICIÓN Y TAMAÑO</Text>
        <Text testID="frame-geometry" style={[styles.hint, { color: colors.textPrimary }]}>
          {`${frame.rect.x < 0 || frame.rect.y < 0 ? `X ${frame.rect.x}, Y ${frame.rect.y}` : `Columna ${frame.rect.x + 1}, fila ${frame.rect.y + 1}`} · ${frame.rect.w} × ${frame.rect.h}`}
        </Text>
        <View style={styles.row}>
          {moves.map((move) => (
            <ActionButton key={move.name} label={move.label} accessibilityLabel={move.name}
              onPress={() => void run((storage, id) => moveFrameOnBoard(storage, id, { ...target, delta: { x: move.dx, y: move.dy } }), 'Marco movido. Guardado en memoria.')} />
          ))}
        </View>
        <View style={styles.row}>
          <ActionButton label="Ancho −" accessibilityLabel="Marco más estrecho" onPress={() => resize(-1, 0)} />
          <ActionButton label="Ancho +" accessibilityLabel="Marco más ancho" onPress={() => resize(1, 0)} />
          <ActionButton label="Alto −" accessibilityLabel="Marco más bajo" onPress={() => resize(0, -1)} />
          <ActionButton label="Alto +" accessibilityLabel="Marco más alto" onPress={() => resize(0, 1)} />
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Arrastra el título en el lienzo para moverlo con sus tarjetas. El tamaño nunca corta una tarjeta.</Text>
      </View>
      <View style={styles.section}>
        <ActionButton label="Quitar el marco" accessibilityLabel={`Quitar el marco ${frame.title}`} onPress={() => void remove()} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Las tarjetas se quedan donde están. Se puede deshacer.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, padding: 14, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heading: { fontSize: 20, fontWeight: '900' },
  section: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  hint: { fontSize: 13, lineHeight: 18 },
});
