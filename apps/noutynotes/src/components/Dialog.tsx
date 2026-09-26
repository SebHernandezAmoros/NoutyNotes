import { useTheme } from '@noutynotes/ui';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from './controls';

interface DialogProps {
  readonly visible: boolean;
  readonly title: string;
  /** Móvil: hoja inferior temporal que deja ver el lienzo; escritorio: modal centrado. */
  readonly compact: boolean;
  readonly onClose: () => void;
  readonly testID: string;
  readonly children: ReactNode;
}

/**
 * Diálogo accesible (ADR 0014): título, «Cerrar», cierre con Escape (web) o atrás (Android, vía
 * `onRequestClose`) y con toque en el fondo. En móvil ocupa como mucho el 62 % inferior.
 */
export function Dialog({ visible, title, compact, onClose, testID, children }: DialogProps) {
  const { theme } = useTheme();
  const colors = theme.colors;

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={[styles.backdrop, compact ? styles.backdropCompact : styles.backdropWide]}>
        <Pressable accessibilityLabel={`Cerrar ${title}`} accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          testID={testID}
          accessibilityViewIsModal
          {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': title } : {})}
          style={[compact ? styles.sheet : styles.panel, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            <ActionButton label="Cerrar" accessibilityLabel={`Cerrar ${title.toLowerCase()}`} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 22, 18, 0.35)' },
  backdropWide: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdropCompact: { justifyContent: 'flex-end' },
  panel: { width: '100%', maxWidth: 560, maxHeight: '85%', borderWidth: 2 },
  sheet: { width: '100%', maxHeight: '62%', borderTopWidth: 3 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '900' },
  content: { padding: 16, paddingTop: 8, gap: 16 },
});
