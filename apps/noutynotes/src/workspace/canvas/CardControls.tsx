import type { CardDisplayMode, CardId } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AppIcon } from '../../components/AppIcon';
import { ActionButton } from '../../components/controls';
import type { AppIconName } from '../../components/AppIcon';
import { Dialog, DialogCloseButton } from '../../components/Dialog';
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
      <AppIcon name={icon} size={20} color={danger ? colors.danger : floating || contained ? colors.textPrimary : colors.cardText} />
    </Pressable>
  );
}

/** Acciones cercanas a la tarjeta en escritorio; hoja temporal en móvil. */
export function CardMenu({ title, display, compact, canQuickEdit, canPaste, frameHidden, backgroundTransparent, anchor, onEdit, onQuickEdit, onTags, onConnect, onCopy, onDuplicate, onPaste, onSelectMany, onArchive, onAction, onToggleFrame, onToggleBackground, onResizeBy, onClose }: {
  readonly title: string;
  readonly display: CardDisplayMode;
  readonly compact: boolean;
  /** UX7-CONSOLIDATION: misma condición exacta que decide `WorkspaceScreen.openCard` — antes este
   * componente recalculaba una versión local incompleta (sin mirar `card.contentDocument`), así que
   * «Editar» podía etiquetarse como «dentro de la ficha» y en realidad abrir el mismo editor completo
   * que «Completo», un duplicado real para cualquier nota autoría HTML. Con el valor real, «Editar»
   * deja de mostrarse cuando llevaría exactamente al mismo sitio que «Completo». */
  readonly canQuickEdit: boolean;
  readonly canPaste: boolean;
  /** UX7.3-B: estado EFECTIVO del marco (ya resuelta la preferencia global, no solo `frameOverride`
   * crudo) — decide si este botón ofrece «Mostrar marco» u «Ocultar marco». */
  readonly frameHidden: boolean;
  readonly backgroundTransparent: boolean | null;
  readonly anchor: { readonly left: number; readonly top: number } | null;
  readonly onEdit: () => void;
  readonly onQuickEdit: () => void;
  readonly onTags: () => void;
  readonly onConnect: () => void;
  readonly onCopy: () => void;
  readonly onDuplicate: () => void;
  readonly onPaste: () => void;
  readonly onSelectMany: () => void;
  readonly onArchive: () => void;
  readonly onAction: (action: CardAction) => void;
  readonly onToggleFrame: () => void;
  readonly onToggleBackground: () => void;
  readonly onResizeBy: (dw: number, dh: number) => void;
  readonly onClose: () => void;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [sizeOpen, setSizeOpen] = useState(false);
  const screen = useWindowDimensions();
  const actions = cardActions(display);
  const displayActions = actions.filter((action) => action.kind !== 'trash');
  const trash = actions.find((action) => action.kind === 'trash');
  const quickEditLabel = t('cardMenu.edit.inline.accessibilityLabel', locale, { title });
  useEffect(() => {
    if (compact || Platform.OS !== 'web') return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="card-menu"] button')?.focus());
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(first); window.removeEventListener('keydown', escape); opener?.focus(); };
  }, [compact, onClose]);
  // UX7.3-MENU: lista vertical de una sola columna — sin recuadro propio por acción ni encabezados de
  // sección repetidos (TRABAJAR/APARIENCIA/ORGANIZAR). El orden conserva las mismas 12-13 acciones de
  // siempre, agrupadas solo por su posición; un único divisor separa la acción destructiva del resto.
  const content = (
    <View style={styles.menu}>
      {canQuickEdit ? (
        <MenuRow icon="edit" label={t('cardMenu.edit', locale)} accessibilityLabel={quickEditLabel} onPress={() => { onClose(); onQuickEdit(); }} />
      ) : null}
      <MenuRow icon="expand" label={t('cardMenu.full', locale)} accessibilityLabel={t('cardMenu.full.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onEdit(); }} />
      <MenuRow icon="star" label={t('cardMenu.tags', locale)} accessibilityLabel={t('cardMenu.tags.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onTags(); }} />
      <MenuRow icon="connect" label={t('cardMenu.connect', locale)} accessibilityLabel={t('cardMenu.connect.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onConnect(); }} />
      {displayActions.map((action) => (
        <MenuRow key={action.kind} icon={action.kind === 'minimized' ? 'minus' : action.kind === 'collapsed' ? 'collapse' : 'expand'} label={actionVerb(action, locale)}
          accessibilityLabel={actionLabel(action, title, locale)} onPress={() => { onClose(); onAction(action); }} />
      ))}
      <MenuRow icon="frame" label={t(frameHidden ? 'cardMenu.frame.show' : 'cardMenu.frame.hide', locale)}
        accessibilityLabel={t(frameHidden ? 'cardMenu.frame.show.accessibilityLabel' : 'cardMenu.frame.hide.accessibilityLabel', locale, { title })}
        onPress={() => { onClose(); onToggleFrame(); }} />
      {backgroundTransparent !== null ? <MenuRow icon="frame" label={t(backgroundTransparent ? 'cardMenu.background.paper' : 'cardMenu.background.transparent', locale)}
        accessibilityLabel={t(backgroundTransparent ? 'cardMenu.background.paper.label' : 'cardMenu.background.transparent.label', locale, { title })}
        onPress={() => { onClose(); onToggleBackground(); }} /> : null}
      <MenuRow icon="expand" label={locale === 'es' ? 'Ajustar tamaño' : 'Adjust size'} accessibilityLabel={locale === 'es' ? 'Ajustar tamaño' : 'Adjust size'} onPress={() => setSizeOpen((open) => !open)} />
      {sizeOpen ? <View testID="card-size-options" style={{ gap: 4 }}>
        <Text style={{ color: colors.textSecondary }}>{locale === 'es' ? 'Flechas: mover. Mayús + flechas: tamaño. El Inspector permite leer todo el contenido.' : 'Arrows: move. Shift + arrows: resize. The Inspector shows all content.'}</Text>
        {display === 'minimized' ? <Text style={{ color: colors.textPrimary }}>{locale === 'es' ? 'Expande la tarjeta para ajustar su tamaño.' : 'Expand the Card to resize it.'}</Text> : <>
          <ActionButton label={locale === 'es' ? 'Más ancha' : 'Wider'} onPress={() => onResizeBy(1, 0)} />
          <ActionButton label={locale === 'es' ? 'Más estrecha' : 'Narrower'} onPress={() => onResizeBy(-1, 0)} />
          {display === 'expanded' ? <>
            <ActionButton label={locale === 'es' ? 'Más alta' : 'Taller'} onPress={() => onResizeBy(0, 1)} />
            <ActionButton label={locale === 'es' ? 'Más baja' : 'Shorter'} onPress={() => onResizeBy(0, -1)} />
          </> : null}
        </>}
      </View> : null}
      <MenuRow icon="copy" label={t('cardMenu.copy', locale)} accessibilityLabel={t('cardMenu.copy.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onCopy(); }} />
      <MenuRow icon="duplicate" label={t('cardMenu.duplicate', locale)} accessibilityLabel={t('cardMenu.duplicate.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onDuplicate(); }} />
      {canPaste ? <MenuRow icon="paste" label={t('cardMenu.paste', locale)} accessibilityLabel={t('cardMenu.paste.accessibilityLabel', locale)} onPress={() => { onClose(); onPaste(); }} /> : null}
      <MenuRow icon="select" label={t('cardMenu.selectMany', locale)} accessibilityLabel={t('cardMenu.selectMany.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onSelectMany(); }} />
      <MenuRow icon="archive" label={t('cardMenu.archive', locale)} accessibilityLabel={t('cardMenu.archive.accessibilityLabel', locale, { title })} onPress={() => { onClose(); onArchive(); }} />
      {trash ? (
        <>
          <View style={[styles.menuRule, { backgroundColor: colors.gridLine }]} />
          <MenuRow icon="trash" danger label={actionVerb(trash, locale)} accessibilityLabel={actionLabel(trash, title, locale)} onPress={() => { onClose(); onAction(trash); }} />
        </>
      ) : null}
    </View>
  );
  const menuTitle = t('cardControls.actionsOf', locale, { title });
  if (compact) return <Dialog visible title={menuTitle} compact onClose={onClose} testID="card-menu">{content}</Dialog>;
  const width = Math.min(220, screen.width - 16);
  // Altura real estimada a partir del número de filas visibles (antes, un valor fijo de 470 pensado
  // para la cuadrícula anterior) — decide si el menú se abre encima o debajo del ancla.
  const rowCount = (canQuickEdit ? 1 : 0) + 3 + displayActions.length + 2 + 2 + (canPaste ? 1 : 0) + 2 + (trash ? 1 : 0) + (sizeOpen ? 7 : 0) + (backgroundTransparent !== null ? 1 : 0);
  const height = Math.min(screen.height - 16, 52 + rowCount * 46 + (trash ? 9 : 0));
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
            <DialogCloseButton label={t('cardMenu.close.accessibilityLabel', locale, { title: title.toLowerCase() })} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** UX7.3-MENU: fila de ancho completo, sin recuadro propio — el resaltado de foco/presión basta para
 * distinguirla, igual que un menú contextual nativo del sistema. */
function MenuRow({ icon, label, accessibilityLabel, onPress, danger = false }: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly danger?: boolean;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.menuRow, {
        borderColor: focused ? colors.selection : 'transparent',
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
      }]}
    >
      <AppIcon name={icon} size={17} color={danger ? colors.danger : colors.textPrimary} />
      <Text numberOfLines={1} style={[styles.menuRowText, { color: danger ? colors.danger : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', zIndex: 30 },
  control: { width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  glyph: { fontSize: 22, lineHeight: 26, fontWeight: '900' },
  menu: { gap: 2 },
  menuRow: { minHeight: 44, borderWidth: 2, borderRadius: 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 11 },
  menuRowText: { flexShrink: 1, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  menuRule: { height: 1, marginVertical: 5 },
  backdrop: { flex: 1 },
  popover: { position: 'absolute', borderWidth: 2, padding: 8, gap: 8 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuTitle: { flex: 1, fontWeight: '900', fontSize: 16 },
});
