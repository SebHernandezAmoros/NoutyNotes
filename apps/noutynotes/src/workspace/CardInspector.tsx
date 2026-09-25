import { connectCards, disconnectCards, editCardContent, moveCardOnBoard, resizeCardOnBoard } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { BoardId, Card, CardPlacement, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { cardTitle } from './Board';
import type { WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string) => Promise<WorkspaceStorageResult<T>>;

interface CardInspectorProps {
  readonly workspace: Workspace;
  readonly boardId: BoardId;
  readonly card: Card;
  readonly placement: CardPlacement | undefined;
  readonly run: Run;
  readonly onClose: () => void;
}

const moves = [
  { label: '←', name: 'Mover a la izquierda', dx: -1, dy: 0 },
  { label: '→', name: 'Mover a la derecha', dx: 1, dy: 0 },
  { label: '↑', name: 'Mover arriba', dx: 0, dy: -1 },
  { label: '↓', name: 'Mover abajo', dx: 0, dy: 1 },
] as const;

const resizes = [
  { label: 'Ancho −', name: 'Más estrecha', dw: -1, dh: 0 },
  { label: 'Ancho +', name: 'Más ancha', dw: 1, dh: 0 },
  { label: 'Alto −', name: 'Más baja', dw: 0, dh: -1 },
  { label: 'Alto +', name: 'Más alta', dw: 0, dh: 1 },
] as const;

/**
 * Editor de la tarjeta seleccionada. Cada botón despacha un caso de uso; los límites y colisiones
 * los decide el motor de grilla y los errores se muestran tal como los devuelve.
 */
export function CardInspector({ workspace, boardId, card, placement, run, onClose }: CardInspectorProps) {
  const { mode } = useWorkspaceSession();
  const { theme } = useTheme();
  const colors = theme.colors;
  const [title, setTitle] = useState(card.title ?? '');
  const [content, setContent] = useState(card.content ?? '');
  const dirty = title !== (card.title ?? '') || content !== (card.content ?? '');
  useEffect(() => {
    if (mode !== 'folder' || !dirty) return;
    const timer = setTimeout(() => {
      void run((storage, id) => editCardContent(storage, id, card.id, { title, content }), 'Texto guardado en la carpeta.');
    }, 700);
    return () => clearTimeout(timer);
  }, [mode, dirty, title, content, card.id, run]);
  const titles = new Map(workspace.cards.map((other) => [other.id, cardTitle(other)]));
  const connected = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id);
  const targets = workspace.cards.filter((other) => other.id !== card.id
    && !workspace.relations.some((relation) => relation.from === card.id && relation.to === other.id));
  const rect = placement?.rect;

  return (
    <View testID="card-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>TARJETA SELECCIONADA</Text>
          <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{cardTitle(card)}</Text>
        </View>
        <ActionButton label="Cerrar" accessibilityLabel="Cerrar el editor de la tarjeta" onPress={onClose} />
      </View>

      <View style={styles.section}>
        <TextField label="Título de la tarjeta" value={title} onChangeText={setTitle} placeholder="Sin título" />
        <TextField label="Contenido Markdown" value={content} onChangeText={setContent} multiline placeholder="# Una idea" />
        <View style={styles.row}>
          <ActionButton
            label="Guardar texto"
            tone="primary"
            onPress={() => void run((storage, id) => editCardContent(storage, id, card.id, { title, content }), 'Texto guardado en memoria.')}
          />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>POSICIÓN EN LA GRILLA DE 12 COLUMNAS</Text>
        <Text testID="card-geometry" style={[styles.body, { color: colors.textPrimary }]}>
          {rect ? `Columna ${rect.x + 1}, fila ${rect.y + 1} · ${rect.w} × ${rect.h}` : 'Sin colocación en este tablero'}
        </Text>
        {rect ? (
          <>
            <View style={styles.row}>
              {moves.map((move) => (
                <ActionButton
                  key={move.name}
                  label={move.label}
                  accessibilityLabel={move.name}
                  onPress={() => void run((storage, id) => moveCardOnBoard(storage, id, {
                    boardId, cardId: card.id, to: { x: rect.x + move.dx, y: rect.y + move.dy },
                  }), 'Tarjeta movida. Guardado en memoria.')}
                />
              ))}
            </View>
            <View style={styles.row}>
              {resizes.map((resize) => (
                <ActionButton
                  key={resize.name}
                  label={resize.label}
                  accessibilityLabel={resize.name}
                  onPress={() => void run((storage, id) => resizeCardOnBoard(storage, id, {
                    boardId, cardId: card.id, size: { w: rect.w + resize.dw, h: rect.h + resize.dh },
                  }), 'Tamaño cambiado. Guardado en memoria.')}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>

      <View testID="card-connections" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>CONEXIONES</Text>
        {connected.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Sin conexiones.</Text>
        ) : connected.map((relation) => {
          const outgoing = relation.from === card.id;
          const other = titles.get(outgoing ? relation.to : relation.from) ?? 'Sin título';
          return (
            <View key={relation.id} style={styles.connection}>
              <Text style={[styles.body, styles.connectionText, { color: colors.textPrimary }]}>
                {outgoing ? `→ ${other}` : `← ${other}`}
              </Text>
              <ActionButton
                label="Desconectar"
                accessibilityLabel={outgoing ? `Desconectar de ${other}` : `Desconectar desde ${other}`}
                onPress={() => void run((storage, id) => disconnectCards(storage, id, relation.id), 'Conexión eliminada. Guardado en memoria.')}
              />
            </View>
          );
        })}
        {targets.length > 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Conectar con:</Text> : null}
        <View style={styles.row}>
          {targets.map((target) => (
            <ActionButton
              key={target.id}
              label={cardTitle(target)}
              accessibilityLabel={`Conectar con ${cardTitle(target)}`}
              onPress={() => void run((storage, id) => connectCards(storage, id, { from: card.id, to: target.id }), 'Tarjetas conectadas. Guardado en memoria.')}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, padding: 16, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  section: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionText: { flex: 1, minWidth: 0 },
});
