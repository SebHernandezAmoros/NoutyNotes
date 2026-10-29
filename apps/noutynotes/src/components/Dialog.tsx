import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from './AppIcon';
import { t } from '../i18n';
import { useKeyboardInset, useRevealFocusedInput } from './useKeyboardInset';

interface DialogProps {
  readonly visible: boolean;
  readonly title: string;
  /** Móvil: hoja inferior temporal que deja ver el lienzo; escritorio: modal centrado. */
  readonly compact: boolean;
  /** Variante web centrada para lectura; no cambia las hojas existentes. */
  readonly presentation?: 'adaptive' | 'centered';
  readonly onClose: () => void;
  readonly testID: string;
  readonly children: ReactNode;
}

/**
 * Diálogo accesible (ADR 0014): título, «Cerrar», cierre con Escape (web) o atrás (Android, vía
 * `onRequestClose`) y con toque en el fondo. En móvil ocupa como mucho el 62 % inferior; con el teclado
 * abierto (nativo) se apoya sobre él y puede ocupar todo el alto restante, para que se vea lo que se escribe.
 */
export function Dialog({ visible, title, compact, presentation = 'adaptive', onClose, testID, children }: DialogProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const keyboard = useKeyboardInset();
  const scroll = useRef<ScrollView>(null);
  const onScroll = useRevealFocusedInput(keyboard, scroll);
  const typing = compact && keyboard > 0;
  const centered = Platform.OS === 'web' && presentation === 'centered';
  const centeredOpener = useRef<{ element: HTMLElement; label: string | null; tag: string } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  // UX7.3-D/E (A11Y-01): ningún diálogo compartido movía el foco al abrir ni lo devolvía al disparador
  // al cerrar — confirmado leyendo este archivo, sin ningún efecto de foco. Mismo patrón ya probado en
  // `CardMenu` (`canvas/CardControls.tsx`): solo escritorio ancho (`compact` usa una hoja con su propia
  // semántica táctil/de teclado nativo, igual que decidió `CardMenu`), primer elemento enfocable del
  // propio diálogo, y restaura el foco a quien lo abrió al desmontar.
  useEffect(() => {
    if ((compact && !centered) || Platform.OS !== 'web' || !visible) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-testid="${testID}"] button, [data-testid="${testID}"] input, [data-testid="${testID}"] textarea, [data-testid="${testID}"] [href]`)?.focus();
    });
    return () => { cancelAnimationFrame(first); if (!centered) opener?.focus(); };
  }, [compact, centered, visible, testID]);

  useLayoutEffect(() => {
    if (!centered || !visible) return;
    // Antes del focus trap pasivo de Modal; después ya puede estar enfocado su botón Cerrar.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    centeredOpener.current = opener ? { element: opener, label: opener.getAttribute('aria-label'), tag: opener.tagName } : null;
  }, [centered, visible, testID]);

  const restoreCenteredFocus = () => {
    const opener = centeredOpener.current;
    centeredOpener.current = null;
    if (!opener) return;
    if (opener.element.isConnected && opener.element.getClientRects().length > 0) { opener.element.focus(); return; }
    // Resize puede reemplazar el botón. Solo restaurar a un equivalente inequívoco.
    if (opener.label) {
      const matches = [...document.querySelectorAll<HTMLElement>('[aria-label]')]
        .filter((element) => element.tagName === opener.tag && element.getAttribute('aria-label') === opener.label && element.getClientRects().length > 0);
      if (matches.length === 1) matches[0]?.focus();
    }
  };

  useEffect(() => {
    if (!centered || !visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = document.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!root.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onTab, true);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onTab, true); };
  }, [centered, visible, testID]);


  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} onDismiss={centered ? restoreCenteredFocus : undefined}>
      <View style={[styles.backdrop, centered ? styles.backdropCentered : compact ? styles.backdropCompact : styles.backdropWide, typing ? { paddingBottom: keyboard } : null]}>
        <Pressable accessibilityLabel={`${t('dialog.close', locale)} ${title}`} accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          testID={testID}
          accessibilityViewIsModal
          {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': title } : {})}
          style={[centered ? styles.centeredPanel : compact ? styles.sheet : styles.panel, typing ? styles.sheetTyping : null, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            <DialogCloseButton label={`${t('dialog.close', locale)} ${title.toLowerCase()}`} onPress={onClose} />
          </View>
          <ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={32} style={[styles.scroll, centered ? styles.centeredScroll : null]} contentContainerStyle={[styles.content, centered ? styles.centeredContent : null]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * UX7-CLEANUP: «Cerrar» pasa de botón de texto a X — misma posición (arriba a la derecha, dentro
 * de la cabecera del diálogo), mismo nombre accesible, mismo cierre por Escape/fondo (sin tocar).
 * Acento rojo discreto solo en el trazo del icono, no en un fondo lleno (cerrar no es destructivo:
 * no debe leerse como un botón de peligro).
 */
/** UX7-REFINEMENT-G/CORRECTION: exportado para que las superficies sin `Dialog` compartido
 * (PresentView, CardMenu de escritorio, FrameInspector, CardInspector, inspector-sheet) usen el mismo
 * botón. Diseño aprobado: cuadrado rojo sólido (`colors.danger`) con una X del color de contraste de
 * ese fondo (`colors.dangerText`, mismo criterio que `accentText`/`brandText`/`headerText`) — no un
 * icono rojo sobre fondo neutro. Cerrar no es una acción destructiva (no sustituye a Cancelar/
 * Descartar/Eliminar), pero el diseño aprobado por el usuario es este cuadrado rojo de todas formas. */
export function DialogCloseButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.closeButton, {
        borderColor: focused ? colors.selection : colors.danger,
        backgroundColor: colors.danger,
        opacity: pressed ? 0.8 : 1,
      }]}
    >
      <AppIcon name="close" size={18} color={colors.dangerText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 22, 18, 0.35)' },
  // 44×44 de área táctil mínima (ADR 0016) aunque el icono visible sea pequeño.
  closeButton: { width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // Arriba y a distancia fija, no centrado: centrar un panel de alto variable lo dejaba en medios píxeles
  // y Firefox medía 43,99 px un botón de 44 (auditoría de 7a).
  backdropWide: { alignItems: 'center', justifyContent: 'flex-start', padding: 24, paddingTop: 48 },
  backdropCompact: { justifyContent: 'flex-end' },
  backdropCentered: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  centeredPanel: { width: '100%', maxWidth: 800, maxHeight: '100%', borderWidth: 2, overflow: 'hidden' },
  centeredScroll: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
  centeredContent: { paddingBottom: 16 },
  // `overflow: hidden` es necesario (defecto real encontrado al añadir el Centro de recuperación,
  // UX7-SAVE: primer contenido de este diálogo compartido lo bastante alto como para exponerlo): sin
  // él, `maxHeight` acota la caja pero no recorta el contenido — este se derramaba en silencio más
  // allá del propio diálogo y, en móvil, incluso más allá de la ventana visible, porque el
  // `ScrollView` nunca llegaba a activar su desplazamiento (su altura dependía de que el padre
  // realmente recortara, no solo declarara un máximo).
  panel: { width: '100%', maxWidth: 560, maxHeight: '85%', borderWidth: 2, overflow: 'hidden' },
  sheet: { width: '100%', maxHeight: '62%', borderTopWidth: 3, overflow: 'hidden' },
  sheetTyping: { maxHeight: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '900' },
  scroll: { flex: 1, minHeight: 0 },
  // `paddingBottom` extra: el último control desplazado hasta el borde exacto del recorte (sin aire
  // debajo) quedaba en una zona límite donde un pulsador automatizado medía su posición de layout
  // correctamente pero el punto de clic cae justo en el borde del área realmente recortada/visible.
  content: { padding: 16, paddingTop: 8, paddingBottom: 64, gap: 16 },
});
