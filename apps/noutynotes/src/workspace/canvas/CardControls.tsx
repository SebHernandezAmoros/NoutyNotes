import type { CardDisplayMode, CardId } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ActionButton } from '../../components/controls';
import { AppIcon } from '../../components/AppIcon';
import type { AppIconName } from '../../components/AppIcon';
import { Dialog } from '../../components/Dialog';
import { t } from '../../i18n';
import { CONTROL_SIZE, actionLabel, actionVerb, cardActions } from './cardChrome';
import type { CardAction, Chrome } from './cardChrome';

interface CardControlsProps {
  readonly cardId: CardId;
  readonly title: string;
  readonly display: CardDisplayMode;
  readonly chrome: Chrome;
  readonly onAction: (action: CardAction) => void;
  readonly onMenu: () => void;
  /** Foco del teclado en un control: el lienzo muestra su tarjeta. */
  readonly onFocus: () => void;
  readonly floating?: boolean;
}

/**
 * Controles de la cabecera de una tarjeta (ADR 0016): `−`, `▭`/`□` y `×`, a 44 px reales fuera de la
 * escala del zoom. Si no caben o la ficha está minimizada, un único `⋯` abre el menú.
 */
export function CardControls({ cardId, title, display, chrome, onAction, onMenu, onFocus, floating = false }: CardControlsProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  return (
    <View
      testID={`card-controls-${cardId}`}
      style={[styles.row, { left: chrome.left, top: chrome.top }, floating ? { backgroundColor: colors.surface, borderColor: colors.gridLine, borderWidth: 1 } : null]}
    >
      {chrome.kind === 'menu' ? (
        <Control testID={`card-actions-${cardId}`} icon="menu" label={t('cardControls.actionsOf', locale, { title })} floating={floating} contained onPress={onMenu} onFocus={onFocus} />
      ) : cardActions(display).map((action) => (
        <Control key={action.kind} icon={action.kind === 'trash' ? 'trash' : action.kind === 'minimized' ? 'minus' : action.kind === 'collapsed' ? 'collapse' : 'expand'} label={actionLabel(action, title, locale)} danger={action.kind === 'trash'} floating={floating} onPress={() => onAction(action)} onFocus={onFocus} />
      ))}
    </View>
  );
}

function Control({ testID, icon, label, danger = false, floating = false, contained = false, onPress, onFocus }: {
  readonly testID?: string;
  readonly icon: AppIconName;
  readonly label: string;
  readonly danger?: boolean;
  readonly floating?: boolean;
  readonly contained?: boolean;
  readonly onPress: () => void;
  readonly onFocus: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => { setFocused(true); onFocus(); }}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.control, {
        borderColor: focused ? colors.selection : contained ? colors.border : 'transparent',
        backgroundColor: pressed ? colors.surfaceRaised : contained ? colors.surface : 'transparent',
      }]}
    >
      <AppIcon name={icon} size={20} color={danger ? colors.danger : floating ? colors.textPrimary : colors.cardText} />
    </Pressable>
  );
}

/** Acciones cercanas a la tarjeta en escritorio; hoja temporal en móvil. */
export function CardMenu({ title, display, compact, anchor, onEdit, onQuickEdit, onTags, onConnect, onSelectMany, onArchive, onAction, onClose }: {
  readonly title: string;
  readonly display: CardDisplayMode;
  readonly compact: boolean;
  readonly anchor: { readonly left: number; readonly top: number } | null;
  readonly onEdit: () => void;
  readonly onQuickEdit: () => void;
  readonly onTags: () => void;
  readonly onConnect: () => void;
  readonly onSelectMany: () => void;
  readonly onArchive: () => void;
  readonly onAction: (action: CardAction) => void;
  readonly onClose: () => void;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const screen = useWindowDimensions();
  const actions = cardActions(display);
  const displayActions = actions.filter((action) => action.kind !== 'trash');
  const trash = actions.find((action) => action.kind === 'trash');
  // El destino real de «Editar» (ADR 0048): igual que decide `WorkspaceScreen`, para que la etiqueta no
  // prometa «dentro de la ficha» cuando en realidad abre el editor completo (contraída/minimizada o móvil).
  const quickEditInline = !compact && display === 'expanded';
  const quickEditLabel = t(quickEditInline ? 'cardMenu.edit.inline.accessibilityLabel' : 'cardMenu.edit.full.accessibilityLabel', locale, { title });
  useEffect(() => {
    if (compact || Platform.OS !== 'web') return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="card-menu"] button')?.focus());
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(first); window.removeEventListener('keydown', escape); opener?.focus(); };
  }, [compact, onClose]);
  const content = (
    <View style={styles.menu}>
      <Text style={[styles.menuSection, { color: colors.textSecondary }]}>{t('cardMenu.section.work', locale)}</Text>
      <View style={styles.menuGrid}>
        <MenuAction half icon="edit" label={t('cardMenu.edit', locale)} accessibilityLabel={quickEditLabel} onPress={() => { onClose(); onQuickEdit(); }} />
        <MenuAction half icon="expand" label={t('cardMenu.full', locale)} accessibilityLabel={t('cardMenu.full.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onEdit(); }} />
        <MenuAction half icon="star" label={t('cardMenu.tags', locale)} accessibilityLabel={t('cardMenu.tags.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onTags(); }} />
        <MenuAction half icon="connect" label={t('cardMenu.connect', locale)} accessibilityLabel={t('cardMenu.connect.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onConnect(); }} />
      </View>
      <View style={[styles.menuRule, { backgroundColor: colors.gridLine }]} />
      <Text style={[styles.menuSection, { color: colors.textSecondary }]}>{t('cardMenu.section.appearance', locale)}</Text>
      <View style={styles.menuDisplayRow}>
        {displayActions.map((action) => (
          <MenuAction key={action.kind} compact icon={action.kind === 'minimized' ? 'minus' : action.kind === 'collapsed' ? 'collapse' : 'expand'} label={actionVerb(action, locale)}
            accessibilityLabel={actionLabel(action, title, locale)} onPress={() => { onClose(); onAction(action); }} />
        ))}
      </View>
      <View style={[styles.menuRule, { backgroundColor: colors.gridLine }]} />
      <Text style={[styles.menuSection, { color: colors.textSecondary }]}>{t('cardMenu.section.organize', locale)}</Text>
      <View style={styles.menuGrid}>
        <MenuAction half icon="select" label={t('cardMenu.selectMany', locale)} accessibilityLabel={t('cardMenu.selectMany.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onSelectMany(); }} />
        <MenuAction half icon="archive" label={t('cardMenu.archive', locale)} accessibilityLabel={t('cardMenu.archive.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onArchive(); }} />
      </View>
      {trash ? <MenuAction icon="trash" danger label={actionVerb(trash, locale)} accessibilityLabel={actionLabel(trash, title, locale)} onPress={() => { onClose(); onAction(trash); }} /> : null}
    </View>
  );
  const menuTitle = t('cardControls.actionsOf', locale, { title });
  if (compact) return <Dialog visible title={menuTitle} compact onClose={onClose} testID="card-menu">{content}</Dialog>;
  const width = Math.min(248, screen.width - 16);
  const height = 330;
  const left = Math.max(8, Math.min(anchor?.left ?? 8, screen.width - width - 8));
  const below = (anchor?.top ?? 8) + CONTROL_SIZE + 4;
  const top = below + height <= screen.height - 8 ? below : Math.max(8, (anchor?.top ?? 8) - height - 4);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View testID="card-menu" accessibilityViewIsModal
          {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': menuTitle } : {})}
          style={[styles.popover, { left, top, width, maxHeight: Math.max(0, screen.height - 16), backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.menuHead}>
            <Text numberOfLines={1} style={[styles.menuTitle, { color: colors.textPrimary }]}>{title}</Text>
            <ActionButton label={t('cardMenu.close', locale)} accessibilityLabel={t('cardMenu.close.accessibilityLabel', locale, { title: title.toLowerCase() })} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MenuAction({ icon, label, accessibilityLabel, onPress, compact = false, half = false, danger = false }: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly compact?: boolean;
  readonly half?: boolean;
  readonly danger?: boolean;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.menuAction, compact ? styles.menuActionCompact : null, half ? styles.menuActionHalf : null, {
        borderColor: colors.gridLine,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
      }]}
    >
      <AppIcon name={icon} size={17} color={danger ? colors.danger : colors.textPrimary} />
      <Text numberOfLines={1} style={[styles.menuActionText, { color: danger ? colors.danger : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', zIndex: 30 },
  control: { width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  glyph: { fontSize: 22, lineHeight: 26, fontWeight: '900' },
  menu: { gap: 5 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  menuDisplayRow: { flexDirection: 'row', gap: 5 },
  menuAction: { minHeight: 38, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  menuActionCompact: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  menuActionHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 0, paddingHorizontal: 7 },
  menuActionText: { flexShrink: 1, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  menuRule: { height: 1, marginVertical: 4 },
  backdrop: { flex: 1 },
  popover: { position: 'absolute', borderWidth: 2, padding: 10, gap: 8 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuTitle: { flex: 1, fontWeight: '900', fontSize: 16 },
  menuSection: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1 },
});
