import type { Board, BoardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface BoardTabsProps {
  readonly boards: readonly Board[];
  readonly current: BoardId | undefined;
  readonly onSelect: (boardId: BoardId) => void;
  readonly onCreate: () => void;
  readonly vertical: boolean;
  /** Móvil: una sola fila desplazable en horizontal, para no robar alto al lienzo. */
  readonly scroll?: boolean;
}

const RAIL_WIDTH = 48;
const RAIL_LENGTH = 174;

/** Tableros reales del workspace y «+ Tablero», que crea uno con el caso de uso (ADR 0013, decisión 7). */
export function BoardTabs({ boards, current, onSelect, onCreate, vertical, scroll = false }: BoardTabsProps) {
  const tabs = (
    <>
      {boards.map((board) => (
        <Tab key={board.id} label={board.title} count={board.cardIds.length} active={board.id === current} vertical={vertical}
          accessibilityLabel={`Tablero ${board.title}`} onPress={() => onSelect(board.id)} />
      ))}
      <Tab label="+ Tablero" active={false} vertical={vertical} accessibilityLabel="Crear un tablero" onPress={onCreate} />
    </>
  );
  if (scroll) {
    return (
      <ScrollView testID="board-tabs" accessibilityLabel="Tableros" horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollRow}>
        {tabs}
      </ScrollView>
    );
  }
  return (
    <View testID="board-tabs" accessibilityLabel="Tableros" style={[styles.row, vertical ? styles.vertical : null]}>
      {tabs}
    </View>
  );
}

/** Escritorio: los tableros viven como pestañas verticales en el borde derecho del lienzo. */
export function BoardRail({ boards, current, onSelect, onCreate }: Omit<BoardTabsProps, 'vertical' | 'scroll'>) {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <ScrollView testID="board-tabs" accessibilityLabel="Tableros" style={[styles.rail, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
      contentContainerStyle={styles.railContent}>
      {boards.map((board, index) => (
        <RailTab key={board.id} number={String(index + 1).padStart(2, '0')} label={board.title} count={board.cardIds.length}
          active={board.id === current} onPress={() => onSelect(board.id)} />
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel="Crear un tablero" onPress={onCreate}
        style={[styles.railAdd, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.railAddText, { color: colors.textPrimary }]}>+</Text>
      </Pressable>
    </ScrollView>
  );
}

function RailTab({ number, label, count, active, onPress }: { readonly number: string; readonly label: string; readonly count: number; readonly active: boolean; readonly onPress: () => void }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Tablero ${label}`} accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})} onPress={onPress}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.railTab, { backgroundColor: active ? colors.brand : colors.surface, borderColor: focused ? colors.selection : colors.border }]}>
      <View style={styles.railTurned}>
        <Text style={[styles.railNumber, { color: active ? colors.brandText : colors.textPrimary }]}>{number}</Text>
        <Text numberOfLines={1} style={[styles.railLabel, { color: active ? colors.brandText : colors.textPrimary }]}>{label.toUpperCase()}</Text>
        <Text style={[styles.count, { color: active ? colors.brandText : colors.textSecondary }]}>{count}</Text>
      </View>
    </Pressable>
  );
}

interface TabProps {
  readonly label: string;
  readonly count?: number;
  readonly active: boolean;
  readonly vertical: boolean;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

function Tab({ label, count, active, vertical, accessibilityLabel, disabled = false, onPress }: TabProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tab, vertical ? styles.tabVertical : null, {
        backgroundColor: active ? colors.brand : colors.surface,
        borderColor: focused ? colors.selection : colors.border,
        opacity: disabled ? 0.5 : 1,
      }]}
    >
      <Text numberOfLines={1} style={[styles.label, { color: active ? colors.brandText : colors.textPrimary }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.count, { color: active ? colors.brandText : colors.textSecondary }]}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  vertical: { flexDirection: 'column', flexWrap: 'nowrap' },
  // Sin encoger: con el teclado abierto la hoja del editor cede alto, las pestañas no.
  scroll: { flexGrow: 0, flexShrink: 0 },
  scrollRow: { flexDirection: 'row', gap: 6 },
  tab: { minHeight: 44, minWidth: 44, maxWidth: 240, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 2 },
  tabVertical: { maxWidth: undefined, justifyContent: 'space-between' },
  label: { flexShrink: 1, fontSize: 14, fontWeight: '800' },
  count: { fontSize: 12, fontWeight: '700' },
  rail: { width: RAIL_WIDTH + 8, flexGrow: 0, borderLeftWidth: 2 },
  railContent: { paddingVertical: 8, paddingLeft: 8, gap: 6 },
  railTab: { width: RAIL_WIDTH, height: RAIL_LENGTH, borderWidth: 2, overflow: 'hidden' },
  railTurned: {
    position: 'absolute', width: RAIL_LENGTH - 4, height: RAIL_WIDTH - 4,
    left: (RAIL_WIDTH - RAIL_LENGTH) / 2, top: (RAIL_LENGTH - RAIL_WIDTH) / 2,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10,
    transform: [{ rotate: '90deg' }],
  },
  railNumber: { fontSize: 11, fontWeight: '900' },
  railLabel: { flex: 1, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  railAdd: { width: RAIL_WIDTH, height: RAIL_WIDTH, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  railAddText: { fontSize: 24, lineHeight: 28, fontWeight: '900' },
});
