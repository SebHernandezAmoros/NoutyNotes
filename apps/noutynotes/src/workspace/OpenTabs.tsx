import type { Board, BoardId } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

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
  readonly onActions: (boardId: BoardId) => void;
  readonly onOrganize: () => void;
  readonly compact: boolean;
  /** Móvil: una sola fila desplazable en horizontal, para no robar alto al lienzo. */
  readonly scroll?: boolean;
}

/**
 * Pestañas de tableros abiertos en la sesión (ADR 0035), distintas de la lista completa de
 * `BoardTabs`: un subconjunto que se puede cerrar sin borrar nada y reabrir desde el selector `+`.
 */
export function OpenTabs({ boards, current, onSelect, onClose, closed, onOpen, onCreate, onInsertShortcut, onActions, onOrganize, compact, scroll = false }: OpenTabsProps) {
  const { locale } = useLocale();
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
          onActions={() => onActions(board.id)}
        />
      ))}
      <ActionButton label="+" accessibilityLabel={t('boards.open', locale)} testID="open-tabs-add" onPress={() => setPickerOpen(true)} />
      <ActionButton label={t('boards.organize', locale)} accessibilityLabel={t('boards.organize', locale)} onPress={onOrganize} />
    </>
  );
  return (
    <>
      {scroll ? (
        <ScrollView testID="open-tabs" accessibilityLabel={t('boards.openTabs', locale)} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollRow}>
          {tabs}
        </ScrollView>
      ) : (
        <View testID="open-tabs" accessibilityLabel={t('boards.openTabs', locale)} style={styles.row}>
          {tabs}
        </View>
      )}
      <Dialog visible={pickerOpen} title={t('boards.open', locale)} compact={compact} onClose={() => setPickerOpen(false)} testID="open-tabs-picker">
        <View style={styles.picker}>
          {closed.map((board) => (
            <ActionButton
              key={board.id}
              label={board.title}
              accessibilityLabel={t('boards.openNamed', locale, { board: board.title })}
              onPress={() => { setPickerOpen(false); onOpen(board.id); }}
            />
          ))}
          <ActionButton label={t('boards.new', locale)} accessibilityLabel={t('boards.create', locale)} onPress={() => { setPickerOpen(false); onCreate(); }} />
          <ActionButton label={t('boards.shortcut', locale)} accessibilityLabel={t('boards.createShortcut', locale)} onPress={() => { setPickerOpen(false); onInsertShortcut(); }} />
        </View>
      </Dialog>
    </>
  );
}

function Tab({ board, active, closable, onSelect, onClose, onActions }: {
  readonly board: Board;
  readonly active: boolean;
  readonly closable: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly onActions: () => void;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const webMenu = Platform.OS === 'web' ? {
    onContextMenu: (event: { preventDefault: () => void; stopPropagation: () => void }) => { event.preventDefault(); event.stopPropagation(); onActions(); },
    onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation(); onActions();
    },
  } : {};
  return (
    // Sin borde propio: el borde va en el botón (abajo), no aquí, para que este envoltorio no le
    // sume alto a los 44 px del botón y desplace la geometría exacta del lienzo debajo.
    <View style={styles.tab}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('boards.tab', locale, { board: board.title })}
        accessibilityState={{ selected: active }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
        {...webMenu}
        onPress={onSelect}
        onLongPress={onActions}
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
      <Pressable accessibilityRole="button" accessibilityLabel={t('boards.tabOptions', locale, { board: board.title })} onPress={onActions}
        style={[styles.closeButton, { borderColor: colors.border }]}>
        <Text style={[styles.moreGlyph, { color: colors.textSecondary }]}>⋯</Text>
      </Pressable>
      {closable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('boards.closeTab', locale, { board: board.title })}
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
  moreGlyph: { fontSize: 22, lineHeight: 24, fontWeight: '900' },
  picker: { gap: 8 },
});
