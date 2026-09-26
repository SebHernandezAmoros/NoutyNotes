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
  scroll: { flexGrow: 0 },
  scrollRow: { flexDirection: 'row', gap: 6 },
  tab: { minHeight: 44, minWidth: 44, maxWidth: 240, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 2 },
  tabVertical: { maxWidth: undefined, justifyContent: 'space-between' },
  label: { flexShrink: 1, fontSize: 14, fontWeight: '800' },
  count: { fontSize: 12, fontWeight: '700' },
});
