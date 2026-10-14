import type { Board, BoardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { createElement, useRef, useState } from 'react';
import type { DragEvent } from 'react';
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
export const BOARD_RAIL_HORIZONTAL_MIN = 176;

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
export function BoardRail({ boards, current, width, onSelect, onCreate, onActions, onOrganize, onReorder, onReturn }: Omit<BoardTabsProps, 'vertical' | 'scroll'> & {
  readonly width: number;
  readonly onActions: (boardId: BoardId) => void;
  readonly onOrganize: () => void;
  readonly onReorder: (boardId: BoardId, targetIndex: number) => void;
  readonly onReturn: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [dragging, setDragging] = useState<BoardId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const expanded = width >= BOARD_RAIL_HORIZONTAL_MIN;
  const tabWidth = expanded ? Math.max(RAIL_WIDTH, width - 24) : RAIL_WIDTH;
  return (
    <ScrollView testID="board-tabs" accessibilityLabel="Tableros" showsVerticalScrollIndicator
      style={[styles.rail, { width, borderColor: colors.border, backgroundColor: colors.surfaceRaised }, Platform.OS === 'web' ? { scrollbarGutter: 'stable' } as object : null]}
      contentContainerStyle={[styles.railContent, expanded ? styles.railContentWide : null]}>
      <View style={[styles.railHeader, expanded ? styles.railHeaderWide : null]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a Proyectos" onPress={onReturn}
          style={[styles.railReturn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.railReturnText, { color: colors.textPrimary }]}>←</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Organizar tableros" onPress={onOrganize}
          style={[styles.railOrganize, expanded ? styles.railOrganizeWide : null, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.railOrganizeGlyph, { color: colors.textPrimary }]}>☷</Text>
          {expanded ? <Text numberOfLines={1} style={[styles.railOrganizeLabel, { color: colors.textPrimary }]}>Organizar</Text> : null}
        </Pressable>
      </View>
      {boards.map((board, index) => (
        <RailTab key={board.id} number={String(index + 1).padStart(2, '0')} label={board.title} count={board.cardIds.length}
          active={board.id === current} dragging={dragging === board.id} dropTarget={dropIndex === index && dragging !== board.id}
          expanded={expanded} width={tabWidth}
          onPress={() => onSelect(board.id)} onActions={() => onActions(board.id)}
          onDragStart={() => { setDragging(board.id); setDropIndex(index); }}
          onDragOver={() => setDropIndex(index)}
          onDrop={() => {
            if (dragging !== null && dragging !== board.id) onReorder(dragging, index);
            setDragging(null);
            setDropIndex(null);
          }}
          onDragEnd={() => { setDragging(null); setDropIndex(null); }} />
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel="Crear un tablero" onPress={onCreate}
        style={[styles.railAdd, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.railAddText, { color: colors.textPrimary }]}>+</Text>
      </Pressable>
    </ScrollView>
  );
}

function RailTab({ number, label, count, active, dragging, dropTarget, expanded, width, onPress, onActions, onDragStart, onDragOver, onDrop, onDragEnd }: {
  readonly number: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly dragging: boolean;
  readonly dropTarget: boolean;
  readonly expanded: boolean;
  readonly width: number;
  readonly onPress: () => void;
  readonly onActions: () => void;
  readonly onDragStart: () => void;
  readonly onDragOver: () => void;
  readonly onDrop: () => void;
  readonly onDragEnd: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const suppressPress = useRef(false);
  const webMenu = Platform.OS === 'web' ? {
    onContextMenu: (event: { preventDefault: () => void; stopPropagation: () => void }) => { event.preventDefault(); event.stopPropagation(); onActions(); },
    onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation(); onActions();
    },
  } : {};
  const tabButton = (
    <Pressable accessibilityRole="button" accessibilityLabel={`Tablero ${label}`} accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})} {...webMenu}
      onPress={() => { if (!suppressPress.current) onPress(); }} onLongPress={onActions}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.railTab, expanded ? styles.railTabWide : null, { width, 
        backgroundColor: active ? colors.brand : colors.surface,
        borderColor: focused || dropTarget ? colors.selection : colors.border,
        opacity: dragging ? 0.55 : 1,
      }]}>
      <View style={expanded ? styles.railWideContent : styles.railTurned}>
        <Text style={[styles.railNumber, { color: active ? colors.brandText : colors.textPrimary }]}>{number}</Text>
        <Text numberOfLines={1} style={[styles.railLabel, expanded ? styles.railLabelWide : null, { color: active ? colors.brandText : colors.textPrimary }]}>{label.toUpperCase()}</Text>
        <Text style={[styles.count, { color: active ? colors.brandText : colors.textSecondary }]}>{count}</Text>
      </View>
    </Pressable>
  );
  const draggableTab = Platform.OS === 'web' ? createElement('div', {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      suppressPress.current = true;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', label);
      onDragStart();
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onDragOver();
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onDrop();
    },
    onDragEnd: () => {
      onDragEnd();
      setTimeout(() => { suppressPress.current = false; }, 0);
    },
    style: { width, height: expanded ? 56 : RAIL_LENGTH },
  }, tabButton) : tabButton;
  return (
    <View style={[styles.railTabWrap, expanded ? styles.railTabWrapWide : null, { width }]}>
    {draggableTab}
    <Pressable accessibilityRole="button" accessibilityLabel={`Opciones del tablero ${label}`} onPress={onActions}
      style={[styles.railMore, { backgroundColor: active ? colors.brand : colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.moreGlyph, { color: active ? colors.brandText : colors.textPrimary }]}>⋯</Text>
    </Pressable>
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
  // Sin encoger: con el teclado abierto la hoja del editor cede alto, las pestañas no.
  scroll: { flexGrow: 0, flexShrink: 0 },
  scrollRow: { flexDirection: 'row', gap: 6 },
  tab: { minHeight: 44, minWidth: 44, maxWidth: 240, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 2 },
  tabVertical: { maxWidth: undefined, justifyContent: 'space-between' },
  label: { flexShrink: 1, fontSize: 14, fontWeight: '800' },
  count: { fontSize: 12, fontWeight: '700' },
  // El canal adicional pertenece al scrollbar: no invade los 48 px táctiles ni el nombre rotado.
  rail: { flexGrow: 0, borderLeftWidth: 2 },
  railContent: { paddingVertical: 8, paddingHorizontal: 6, gap: 6, alignItems: 'center' },
  railContentWide: { alignItems: 'stretch' },
  railHeader: { gap: 6, alignItems: 'center' },
  railHeaderWide: { flexDirection: 'row', alignItems: 'stretch' },
  railReturn: { width: RAIL_WIDTH, height: RAIL_WIDTH, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  railReturnText: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  railOrganize: { width: RAIL_WIDTH, height: RAIL_WIDTH, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  railOrganizeWide: { flex: 1, width: undefined, flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  railOrganizeGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  railOrganizeLabel: { flexShrink: 1, fontSize: 11, fontWeight: '900' },
  railTabWrap: { width: RAIL_WIDTH, height: RAIL_LENGTH, position: 'relative' },
  railTabWrapWide: { height: 56 },
  railTab: { width: RAIL_WIDTH, height: RAIL_LENGTH, borderWidth: 2, overflow: 'hidden' },
  railTabWide: { height: 56 },
  railTurned: {
    position: 'absolute', width: RAIL_LENGTH - 4, height: RAIL_WIDTH - 4,
    left: (RAIL_WIDTH - RAIL_LENGTH) / 2, top: (RAIL_LENGTH - RAIL_WIDTH) / 2,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingRight: 52,
    transform: [{ rotate: '90deg' }],
  },
  railWideContent: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 46 },
  railNumber: { fontSize: 11, fontWeight: '900' },
  railLabel: { flex: 1, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  railLabelWide: { fontSize: 11, letterSpacing: 0 },
  railMore: { position: 'absolute', right: 2, bottom: 2, width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  moreGlyph: { fontSize: 22, lineHeight: 24, fontWeight: '900' },
  railAdd: { width: RAIL_WIDTH, height: RAIL_WIDTH, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  railAddText: { fontSize: 24, lineHeight: 28, fontWeight: '900' },
});
