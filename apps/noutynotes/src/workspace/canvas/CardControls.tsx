import type { CardDisplayMode, CardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ActionButton } from '../../components/controls';
import { Dialog } from '../../components/Dialog';
import { CONTROL_SIZE, actionLabel, cardActions } from './cardChrome';
import type { CardAction, Chrome, EditChrome } from './cardChrome';

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
  const colors = theme.colors;
  return (
    <View
      testID={`card-controls-${cardId}`}
      style={[styles.row, { left: chrome.left, top: chrome.top }, floating ? { backgroundColor: colors.surface, borderColor: colors.gridLine, borderWidth: 1 } : null]}
    >
      {chrome.kind === 'menu' ? (
        <Control glyph="⋯" label={`Acciones de ${title}`} floating={floating} contained onPress={onMenu} onFocus={onFocus} />
      ) : cardActions(display).map((action) => (
        <Control key={action.kind} glyph={action.glyph} label={actionLabel(action, title)} danger={action.kind === 'trash'} floating={floating} onPress={() => onAction(action)} onFocus={onFocus} />
      ))}
    </View>
  );
}

function Control({ glyph, label, danger = false, floating = false, contained = false, onPress, onFocus }: {
  readonly glyph: string;
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
      <Text style={[styles.glyph, { color: danger ? colors.danger : floating ? colors.textPrimary : colors.cardText }]}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * Botón «Editar» de la tarjeta seleccionada (auditoría de interacción, 2026-09-29): seleccionar ya no
 * abre el editor por sí solo (ver `WorkspaceScreen.tsx`); este botón, con acento visual propio, es el
 * paso explícito para llegar a él. Doble clic o doble toque lo siguen abriendo directamente.
 */
export function EditButton({ cardId, title, chrome, onPress, onFocus }: {
  readonly cardId: CardId;
  readonly title: string;
  readonly chrome: EditChrome;
  readonly onPress: () => void;
  readonly onFocus: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={`card-edit-${cardId}`}
      accessibilityRole="button"
      accessibilityLabel={`Editar ${title}`}
      onPress={onPress}
      onFocus={() => { setFocused(true); onFocus(); }}
      onBlur={() => setFocused(false)}
      style={[styles.editButton, {
        backgroundColor: colors.accent,
        borderColor: focused ? colors.selection : colors.border,
        left: chrome.left, top: chrome.top,
      }]}
    >
      <Text style={[styles.glyph, { color: colors.accentText }]}>✎</Text>
    </Pressable>
  );
}

/** Acciones cercanas a la tarjeta en escritorio; hoja temporal en móvil. */
export function CardMenu({ title, display, compact, anchor, onEdit, onConnect, onAction, onClose }: {
  readonly title: string;
  readonly display: CardDisplayMode;
  readonly compact: boolean;
  readonly anchor: { readonly left: number; readonly top: number } | null;
  readonly onEdit: () => void;
  readonly onConnect: () => void;
  readonly onAction: (action: CardAction) => void;
  readonly onClose: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const screen = useWindowDimensions();
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
      <ActionButton label="Editar" accessibilityLabel={`Editar ${title}`} onPress={() => { onClose(); onEdit(); }} />
      <ActionButton label="Conectar" accessibilityLabel={`Conectar desde ${title}`} onPress={() => { onClose(); onConnect(); }} />
      <View style={[styles.menuRule, { backgroundColor: colors.gridLine }]} />
        {cardActions(display).map((action) => (
          <ActionButton key={action.kind} label={`${action.glyph}  ${action.kind === 'trash' ? 'Enviar a la Papelera' : action.verb}`}
            accessibilityLabel={actionLabel(action, title)} onPress={() => { onClose(); onAction(action); }} />
        ))}
    </View>
  );
  if (compact) return <Dialog visible title={`Acciones de ${title}`} compact onClose={onClose} testID="card-menu">{content}</Dialog>;
  const width = Math.min(248, screen.width - 16);
  const height = (cardActions(display).length + 2) * 52 + 86;
  const left = Math.max(8, Math.min(anchor?.left ?? 8, screen.width - width - 8));
  const below = (anchor?.top ?? 8) + CONTROL_SIZE + 4;
  const top = below + height <= screen.height - 8 ? below : Math.max(8, (anchor?.top ?? 8) - height - 4);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View testID="card-menu" accessibilityViewIsModal
          {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': `Acciones de ${title}` } : {})}
          style={[styles.popover, { left, top, width, maxHeight: Math.max(0, screen.height - 16), backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.menuHead}>
            <Text numberOfLines={1} style={[styles.menuTitle, { color: colors.textPrimary }]}>{title}</Text>
            <ActionButton label="Cerrar" accessibilityLabel={`Cerrar acciones de ${title.toLowerCase()}`} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', zIndex: 30 },
  control: { width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  editButton: { position: 'absolute', width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2, zIndex: 30 },
  glyph: { fontSize: 22, lineHeight: 26, fontWeight: '900' },
  menu: { gap: 8 },
  menuRule: { height: 1, marginVertical: 4 },
  backdrop: { flex: 1 },
  popover: { position: 'absolute', borderWidth: 2, padding: 10, gap: 8 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuTitle: { flex: 1, fontWeight: '900', fontSize: 16 },
});
