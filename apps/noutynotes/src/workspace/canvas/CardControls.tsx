import type { CardDisplayMode, CardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
 * escala del zoom. Si no caben, un único `⋯` abre el menú; en una ficha minimizada seleccionada, una tira.
 */
export function CardControls({ cardId, title, display, chrome, onAction, onMenu, onFocus, floating = false }: CardControlsProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const strip = chrome.kind === 'strip';
  return (
    <View
      testID={`card-controls-${cardId}`}
      style={[styles.row, { left: chrome.left, top: chrome.top }, strip ? { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 2 }
        : floating ? { backgroundColor: colors.surface, borderColor: colors.gridLine, borderWidth: 1 } : null]}
    >
      {chrome.kind === 'menu' ? (
        <Control glyph="⋯" label={`Acciones de ${title}`} floating={floating} onPress={onMenu} onFocus={onFocus} />
      ) : cardActions(display).map((action) => (
        <Control key={action.kind} glyph={action.glyph} label={actionLabel(action, title)} danger={action.kind === 'trash'} floating={floating} onPress={() => onAction(action)} onFocus={onFocus} />
      ))}
    </View>
  );
}

function Control({ glyph, label, danger = false, floating = false, onPress, onFocus }: {
  readonly glyph: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly floating?: boolean;
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
        borderColor: focused ? colors.selection : 'transparent',
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
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

/** Menú «⋯» de una tarjeta estrecha: las mismas acciones con su nombre completo. */
export function CardMenu({ title, display, compact, onAction, onClose }: {
  readonly title: string;
  readonly display: CardDisplayMode;
  readonly compact: boolean;
  readonly onAction: (action: CardAction) => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog visible title={`Acciones de ${title}`} compact={compact} onClose={onClose} testID="card-menu">
      <View style={styles.menu}>
        {cardActions(display).map((action) => (
          <ActionButton key={action.kind} label={`${action.glyph}  ${action.kind === 'trash' ? 'Enviar a la Papelera' : action.verb}`}
            accessibilityLabel={actionLabel(action, title)} onPress={() => { onClose(); onAction(action); }} />
        ))}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', zIndex: 30 },
  control: { width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  editButton: { position: 'absolute', width: CONTROL_SIZE, height: CONTROL_SIZE, alignItems: 'center', justifyContent: 'center', borderWidth: 2, zIndex: 30 },
  glyph: { fontSize: 22, lineHeight: 26, fontWeight: '900' },
  menu: { gap: 8 },
});
