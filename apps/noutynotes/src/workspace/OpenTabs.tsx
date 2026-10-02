import type { Board, BoardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface OpenTabsProps {
  /** Pestañas abiertas en esta sesión, en su orden de apertura (ADR 0035). */
  readonly boards: readonly Board[];
  readonly current: BoardId | undefined;
  readonly onSelect: (boardId: BoardId) => void;
  readonly onClose: (boardId: BoardId) => void;
  /** Tableros del proyecto que no están abiertos, ofrecidos por el selector `+`. */
  readonly closed: readonly Board[];
  readonly onOpen: (boardId: BoardId) => void;
  readonly onCreate: () => void;
  /** UX7-A3: «Tablero» salió de la barra principal; el acceso rápido se ofrece aquí donde no hay franja derecha. */
  readonly onInsertShortcut: () => void;
  readonly compact: boolean;
  /** Móvil: una sola fila desplazable en horizontal, para no robar alto al lienzo. */
  readonly scroll?: boolean;
}

/**
 * Pestañas de tableros abiertos en la sesión (ADR 0035), distintas de la lista completa de
 * `BoardTabs`: un subconjunto que se puede cerrar sin borrar nada y reabrir desde el selector `+`.
 */
export function OpenTabs({ boards, current, onSelect, onClose, closed, onOpen, onCreate, onInsertShortcut, compact, scroll = false }: OpenTabsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const canClose = boards.length > 1;
  const tabs = (
    <>
      {boards.map((board) => (
        <Tab
          key={board.id}
          board={board}
          active={board.id === current}
          closable={canClose}
          onSelect={() => onSelect(board.id)}
          onClose={() => onClose(board.id)}
        />
      ))}
      <ActionButton label="+" accessibilityLabel="Abrir un tablero" testID="open-tabs-add" onPress={() => setPickerOpen(true)} />
    </>
  );
  return (
    <>
      {scroll ? (
        <ScrollView testID="open-tabs" accessibilityLabel="Pestañas abiertas" horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollRow}>
          {tabs}
        </ScrollView>
      ) : (
        <View testID="open-tabs" accessibilityLabel="Pestañas abiertas" style={styles.row}>
          {tabs}
        </View>
      )}
      <Dialog visible={pickerOpen} title="Abrir un tablero" compact={compact} onClose={() => setPickerOpen(false)} testID="open-tabs-picker">
        <View style={styles.picker}>
          {closed.map((board) => (
            <ActionButton
              key={board.id}
              label={board.title}
              accessibilityLabel={`Abrir el tablero ${board.title}`}
              onPress={() => { setPickerOpen(false); onOpen(board.id); }}
            />
          ))}
          <ActionButton label="+ Tablero" accessibilityLabel="Crear un tablero" onPress={() => { setPickerOpen(false); onCreate(); }} />
          <ActionButton label="Acceso rápido a un tablero" accessibilityLabel="Crear acceso rápido a un tablero" onPress={() => { setPickerOpen(false); onInsertShortcut(); }} />
        </View>
      </Dialog>
    </>
  );
}

function Tab({ board, active, closable, onSelect, onClose }: {
  readonly board: Board;
  readonly active: boolean;
  readonly closable: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    // Sin borde propio: el borde va en el botón (abajo), no aquí, para que este envoltorio no le
    // sume alto a los 44 px del botón y desplace la geometría exacta del lienzo debajo.
    <View style={styles.tab}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Tablero ${board.title}`}
        accessibilityState={{ selected: active }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
        onPress={onSelect}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.tabPress, {
          backgroundColor: active ? colors.brand : colors.surface,
          borderColor: focused ? colors.selection : colors.border,
        }]}
      >
        <Text numberOfLines={1} style={[styles.label, { color: active ? colors.brandText : colors.textPrimary }]}>{board.title}</Text>
        <Text style={[styles.count, { color: active ? colors.brandText : colors.textSecondary }]}>{board.cardIds.length}</Text>
      </Pressable>
      {closable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cerrar la pestaña de ${board.title}`}
          onPress={onClose}
          style={[styles.closeButton, { borderColor: focused ? colors.selection : colors.border }]}
        >
          <Text style={[styles.closeGlyph, { color: colors.textSecondary }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scroll: { flexGrow: 0, flexShrink: 0 },
  scrollRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  tab: { flexDirection: 'row', gap: 4, maxWidth: 300 },
  // Alto fijo de 44 px con el borde incluido (no `minHeight`, que dejaría un alto intrínseco donde el
  // borde de un envoltorio exterior se sumaría encima y desplazaría la geometría exacta del lienzo).
  tabPress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderWidth: 2, flexShrink: 1 },
  label: { flexShrink: 1, fontSize: 14, fontWeight: '800' },
  count: { fontSize: 12, fontWeight: '700' },
  closeButton: { width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 18, fontWeight: '900' },
  picker: { gap: 8 },
});
