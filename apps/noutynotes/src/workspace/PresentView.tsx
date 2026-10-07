import type { PrintEntry } from '@noutynotes/application';
import type { TextSize } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { ConnectorPreview } from './ConnectorPreview';
import { floatingTextColor } from './floatingText';
import { PresentationBody } from './PresentationBody';
import { ShapePreview } from './ShapePreview';
import { bodyLineHeight } from './textSizes';

/** Una ficha es un conector (P15) si guarda alguno de sus campos de estilo o anclaje propios. */
const isConnectorEntry = (entry: PrintEntry): boolean =>
  entry.connectorColor !== undefined || entry.connectorWidth !== undefined
  || entry.connectorDash !== undefined || entry.connectorArrows !== undefined || entry.connectorDirection !== undefined;

// Escala propia de la presentación (ADR 0050/P16): mismo criterio de pequeño/mediano/grande que el
// lienzo, Lista e impresión, pero con una base mayor porque una diapositiva a pantalla completa se
// lee de lejos; «mediano» coincide con el tamaño fijo que ya tenía esta vista antes de P16.
const PRESENT_TITLE_PX: Readonly<Record<TextSize, number>> = { small: 22, medium: 28, large: 34 };
const PRESENT_BODY_PX: Readonly<Record<TextSize, number>> = { small: 15, medium: 18, large: 22 };
const presentTitlePx = (size: TextSize | undefined): number => PRESENT_TITLE_PX[size ?? 'medium'];
const presentBodyPx = (size: TextSize | undefined): number => PRESENT_BODY_PX[size ?? 'medium'];

interface PresentViewProps {
  readonly boardTitle: string;
  readonly entries: readonly PrintEntry[];
  readonly images: ReadonlyMap<string, string>;
  readonly onClose: () => void;
}

/**
 * Presentación a pantalla completa (ADR 0031): una diapositiva por tarjeta, en el orden de lectura.
 * Funciona en cualquier plataforma porque es una vista más de la app, no una impresión. Quien la abre
 * la monta solo mientras está visible, así siempre empieza en la primera diapositiva.
 */
export function PresentView({ boardTitle, entries, images, onClose }: PresentViewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [index, setIndex] = useState(0);
  const entry = entries[index];
  const go = (delta: 1 | -1) => setIndex((current) => Math.min(entries.length - 1, Math.max(0, current + delta)));

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') go(1);
      else if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, entries.length]);

  // Deslizar (táctil): un gesto horizontal claro pasa de diapositiva; uno corto no hace nada.
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  return (
    <Modal visible animationType="none" onRequestClose={onClose}>
      <View
        testID="present-view"
        style={[styles.screen, { backgroundColor: colors.background }]}
        {...(Platform.OS === 'web' ? {} : {
          onStartShouldSetResponder: () => true,
          onResponderGrant: (event: { nativeEvent: { pageX: number } }) => setTouchStartX(event.nativeEvent.pageX),
          onResponderRelease: (event: { nativeEvent: { pageX: number } }) => {
            if (touchStartX === null) return;
            const dx = event.nativeEvent.pageX - touchStartX;
            if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
            setTouchStartX(null);
          },
        })}
      >
        <View style={styles.header}>
          <Text numberOfLines={1} style={[styles.boardTitle, { color: colors.textSecondary }]}>{boardTitle}</Text>
          <Text testID="present-count" style={[styles.count, { color: colors.textSecondary }]}>
            {entries.length === 0 ? 'SIN TARJETAS' : `${index + 1} / ${entries.length}`}
          </Text>
          <ActionButton label="Cerrar" accessibilityLabel="Cerrar la presentación" onPress={onClose} />
        </View>
        {entry ? (
          entry.floatingText ? (
            // Texto flotante (ADR 0057): sin título ni metadatos inventados, igual que la impresión.
            <ScrollView testID="present-floating-text" contentContainerStyle={styles.slide}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${entry.number}. ${entry.typeLabel.toUpperCase()}`}</Text>
              <Text style={[styles.content, {
                color: floatingTextColor(entry.textColor, colors.textPrimary),
                textAlign: entry.textAlign ?? 'left',
                fontSize: presentBodyPx(entry.bodySize),
                lineHeight: bodyLineHeight(presentBodyPx(entry.bodySize)),
              }]}>{entry.content}</Text>
            </ScrollView>
          ) : entry.shapeKind ? (
            // Forma (ADR 0058): la geometría del lienzo no aplica aquí; se ilustra solo su estilo.
            <View testID="present-shape" style={styles.slide}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${entry.number}. ${entry.typeLabel.toUpperCase()}`}</Text>
              <View style={styles.shapeSlide}>
                <ShapePreview card={entry} surface={colors.background} strokeFallback={colors.textSecondary} testID="present-shape-preview" />
              </View>
            </View>
          ) : isConnectorEntry(entry) ? (
            // Conector decorativo (ADR 0059): nunca es una Relation; solo se ilustra su apariencia.
            <View testID="present-connector" style={styles.slide}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${entry.number}. ${entry.typeLabel.toUpperCase()}`}</Text>
              <View style={styles.connectorSlide}>
                <ConnectorPreview card={entry} surface={colors.background} strokeFallback={colors.textSecondary} testID="present-connector-preview" />
              </View>
            </View>
          ) : (
            <ScrollView testID="present-note" contentContainerStyle={styles.slide}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${entry.number}. ${entry.typeLabel.toUpperCase()}`}</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: presentTitlePx(entry.titleSize) }]}>{entry.title}</Text>
              <PresentationBody entry={entry} images={images} color={colors.textPrimary}
                fontSize={presentBodyPx(entry.bodySize)} lineHeight={bodyLineHeight(presentBodyPx(entry.bodySize))} testID="present-body" />
              {entry.tags.length > 0 ? (
                <Text style={[styles.tags, { color: colors.textSecondary }]}>{entry.tags.map((tag) => `#${tag}`).join('  ')}</Text>
              ) : null}
              {entry.connections.length > 0 ? (
                <View style={styles.connections}>
                  {entry.connections.map((connection, connectionIndex) => (
                    <Text key={connectionIndex} style={[styles.connection, { color: colors.textSecondary }]}>
                      {`${connection.direction === 'to' ? '→' : '←'} ${connection.label}: ${connection.otherTitle}`}
                    </Text>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          )
        ) : (
          <View style={styles.slide}>
            <Text style={[styles.content, { color: colors.textSecondary }]}>Este tablero no tiene tarjetas para presentar.</Text>
          </View>
        )}
        <View style={styles.nav}>
          <ActionButton label="← Anterior" accessibilityLabel="Diapositiva anterior" onPress={() => go(-1)} />
          <ActionButton label="Siguiente →" accessibilityLabel="Diapositiva siguiente" onPress={() => go(1)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  boardTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '800' },
  slide: { flexGrow: 1, padding: 24, paddingTop: 8, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  meta: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: '900' },
  content: { fontSize: 18, lineHeight: 27 },
  shapeSlide: { flex: 1, minHeight: 200, padding: 24 },
  connectorSlide: { flex: 1, minHeight: 80, justifyContent: 'center', padding: 24 },
  tags: { fontSize: 14, fontWeight: '700' },
  connections: { gap: 4 },
  connection: { fontSize: 14 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
});
