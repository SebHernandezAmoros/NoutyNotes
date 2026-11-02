import type { PrintEntry } from '@noutynotes/application';
import type { Relation, TextSize } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog, DialogCloseButton } from '../components/Dialog';
import { ConnectorPreview } from './ConnectorPreview';
import { floatingTextColor } from './floatingText';
import { PresentationBody } from './PresentationBody';
import { ShapePreview } from './ShapePreview';
import { bodyLineHeight } from './textSizes';
import { t } from '../i18n';
import { ReadingOrderDialog } from './ReadingOrderControl';
import { outgoingReadingTargets, readingPreviewText, reconcileReadingOrder } from './readingOrder';

/** Una ficha es un conector (P15) si guarda alguno de sus campos de estilo o anclaje propios. */
const isConnectorEntry = (entry: PrintEntry): boolean =>
  entry.connectorColor !== undefined || entry.connectorWidth !== undefined
  || entry.connectorDash !== undefined || entry.connectorArrows !== undefined || entry.connectorDirection !== undefined;

// Escala propia de la presentación (ADR 0050/P16): mismo criterio de pequeño/mediano/grande que el
// lienzo, Lista e impresión, pero con una base mayor porque una diapositiva a pantalla completa se
// lee de lejos; «mediano» coincide con el tamaño fijo que ya tenía esta vista antes de P16.
const PRESENT_BODY_PX: Readonly<Record<TextSize, number>> = { small: 15, medium: 18, large: 22 };
const presentBodyPx = (size: TextSize | undefined): number => PRESENT_BODY_PX[size ?? 'medium'];

interface PresentViewProps {
  readonly boardTitle: string;
  readonly entries: readonly PrintEntry[];
  readonly images: ReadonlyMap<string, string>;
  readonly relations?: readonly Pick<Relation, 'from' | 'to'>[];
  readonly childOpen?: boolean;
  readonly onClose: () => void;
}

/**
 * Presentación a pantalla completa (ADR 0031): una diapositiva por tarjeta, en el orden de lectura.
 * Funciona en cualquier plataforma porque es una vista más de la app, no una impresión. Quien la abre
 * la monta solo mientras está visible, así siempre empieza en la primera diapositiva.
 */
export function PresentView({ boardTitle, entries, images, relations = [], childOpen = false, onClose }: PresentViewProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);
  // B9-R3-03: el panel de conexiones ya no queda abierto de forma permanente (ocupaba espacio incluso
  // con una sola relación) — se abre a demanda desde un acceso compacto con la cantidad disponible.
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const orderedIds = reconcileReadingOrder(orderIds, entries.map((candidate) => candidate.id));
  const sequence = orderedIds.filter((id) => !excludedIds.has(id)).flatMap((id) => {
    const found = entries.find((candidate) => candidate.id === id);
    return found ? [found] : [];
  }).map((candidate, position) => ({ ...candidate, number: position + 1 }));
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const [mainId, setMainId] = useState<string | null>(entries[0]?.id ?? null);
  const [branchPath, setBranchPath] = useState<string[]>([]);
  const mainIndex = Math.max(0, sequence.findIndex((candidate) => candidate.id === mainId));
  const index = Math.max(0, sequence.findIndex((candidate) => candidate.id === selectedId));
  const entry = sequence[index];
  const go = (delta: 1 | -1) => {
    const next = sequence[Math.min(sequence.length - 1, Math.max(0, mainIndex + delta))];
    if (next) { setSelectedId(next.id); setMainId(next.id); setBranchPath([]); }
  };
  const connectedIds = entry ? outgoingReadingTargets(entry.id, sequence.map((candidate) => candidate.id), relations) : [];
  const returnFromBranch = () => {
    const previous = [...branchPath].reverse().find((id) => sequence.some((candidate) => candidate.id === id));
    if (previous) setSelectedId(previous);
    setBranchPath(branchPath.slice(0, -1));
  };
  const [jumpEdit, setJumpEdit] = useState<string | null>(null);
  const jump = jumpEdit ?? String(entry ? mainIndex + 1 : 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenProblem, setFullscreenProblem] = useState(false);
  const ownsFullscreen = useRef(false);
  const suppressEscapeClose = useRef(false);
  const selectNumber = () => {
    const number = Number(jump);
    if (Number.isInteger(number) && number >= 1 && number <= sequence.length) {
      setSelectedId(sequence[number - 1]!.id); setMainId(sequence[number - 1]!.id); setBranchPath([]);
    }
    setJumpEdit(null);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sync = () => { setFullscreen(ownsFullscreen.current && !!document.fullscreenElement); if (!document.fullscreenElement) ownsFullscreen.current = false; };
    document.addEventListener('fullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen(); };
  }, []);
  const toggleFullscreen = async () => {
    if (Platform.OS !== 'web') return;
    setFullscreenProblem(false);
    try {
      if (ownsFullscreen.current && document.fullscreenElement) { await document.exitFullscreen(); return; }
      if (!document.documentElement.requestFullscreen || document.fullscreenElement) { setFullscreenProblem(true); return; }
      await document.documentElement.requestFullscreen();
      ownsFullscreen.current = true;
      setFullscreen(true);
    } catch { ownsFullscreen.current = false; setFullscreenProblem(true); }
  };
  const close = () => { if (suppressEscapeClose.current) { suppressEscapeClose.current = false; return; } if (childOpen) return; if (Platform.OS === 'web' && ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen(); onClose(); };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const root = document.querySelector('[data-testid="present-view"]');
      const target = event.target instanceof HTMLElement ? event.target : null;
      const modal = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1);
      if (childOpen || document.querySelector('[data-testid="asset-pdf-preview"], [data-testid="image-viewer"]')) {
        if (event.key === 'Escape') suppressEscapeClose.current = true;
        return;
      }
      if (organizing || connectionsOpen || event.defaultPrevented || !root || (modal && !root.contains(modal) && !modal.contains(root))) return;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (ownsFullscreen.current && document.fullscreenElement) { suppressEscapeClose.current = true; void document.exitFullscreen(); } else close();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); go(event.key === 'ArrowRight' ? 1 : -1);
      }
    };
    const clearEscape = () => { suppressEscapeClose.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', clearEscape);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', clearEscape); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, entries, mainIndex, orderIds, excludedIds, childOpen, organizing, connectionsOpen]);

  // Deslizar (táctil): un gesto horizontal claro pasa de diapositiva; uno corto no hace nada.
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  return (
    <Modal visible animationType="none" onRequestClose={close}>
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
            {sequence.length === 0 ? t('present.emptyShort', locale) : `${mainIndex + 1} / ${sequence.length}${branchPath.length ? ' ↪' : ''}`}
          </Text>
          <DialogCloseButton label={t('present.close', locale)} onPress={close} />
        </View>
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityLabel={t('present.progress', locale, { index: String(entry ? mainIndex + 1 : 0), total: String(sequence.length) })} accessibilityValue={{ min: 0, max: sequence.length, now: entry ? mainIndex + 1 : 0 }}>
          <View style={[styles.progressFill, { width: `${sequence.length ? (mainIndex + 1) / sequence.length * 100 : 0}%`, backgroundColor: colors.accent }]} />
        </View>
        <View style={styles.main}>
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
              <View style={[styles.noteFrame, { backgroundColor: entry.noteBackground === 'transparent' ? 'transparent' : colors.cardSurface,
                borderColor: entry.frameOverride === 'hidden' ? 'transparent' : colors.border }]}>
                {entry.frameOverride !== 'hidden' ? <View style={[styles.noteHeader, { backgroundColor: colors.headerNote }]}>
                  <Text style={{ color: colors.headerText, fontWeight: '800' }}>{`${entry.number} // ${entry.title || entry.typeLabel}`}</Text>
                </View> : null}
                <View style={styles.noteContent}>
                  <PresentationBody entry={entry} images={images} color={colors.cardText}
                    fontSize={presentBodyPx(entry.bodySize)} lineHeight={bodyLineHeight(presentBodyPx(entry.bodySize))} testID="present-body" />
                  {entry.tags.length > 0 ? <Text style={[styles.tags, { color: colors.cardText }]}>{entry.tags.map((tag) => `#${tag}`).join('  ')}</Text> : null}
                  {entry.connections.length > 0 ? <View style={styles.connections}>
                    {entry.connections.map((connection, connectionIndex) => <Text key={connectionIndex} style={[styles.connection, { color: colors.cardText }]}>
                      {`${connection.direction === 'to' ? '→' : '←'} ${connection.label}: ${connection.otherTitle}`}
                    </Text>)}
                  </View> : null}
                </View>
              </View>
            </ScrollView>
          )
        ) : (
          <View style={styles.slide}>
            <Text style={[styles.content, { color: colors.textSecondary }]}>{t('present.empty', locale)}</Text>
          </View>
        )}
        </View>
        <View style={styles.nav}>
          <View style={styles.navRow}>
            <ActionButton label={t('present.previous', locale)} accessibilityLabel={t('present.previousLabel', locale)} disabled={mainIndex === 0 || sequence.length === 0} onPress={() => go(-1)} />
            {Platform.OS === 'web' ? <input type="number" min={1} max={sequence.length} value={jump} aria-label={t('present.jump', locale)} onChange={(event) => setJumpEdit(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { selectNumber(); event.currentTarget.blur(); } }} onBlur={selectNumber} style={{ width: 70, minHeight: 44, textAlign: 'center', border: `2px solid ${colors.border}`, background: colors.surface, color: colors.textPrimary }} />
              : <TextInput accessibilityLabel={t('present.jump', locale)} keyboardType="number-pad" value={jump} onChangeText={setJumpEdit} onSubmitEditing={selectNumber} style={{ minWidth: 70, minHeight: 44, color: colors.textPrimary, borderColor: colors.border, borderWidth: 2, textAlign: 'center' }} />}
            <ActionButton label={t('present.next', locale)} accessibilityLabel={t('present.nextLabel', locale)} disabled={mainIndex >= sequence.length - 1} onPress={() => go(1)} />
          </View>
          <View style={styles.navRow}>
            <ActionButton testID="present-organize" label={locale === 'es' ? 'Organizar' : 'Organize'} onPress={() => setOrganizing(true)} />
            {/* B9-R3-03: acceso compacto con la cantidad disponible, en vez de un panel lateral siempre
                abierto — nada que mostrar, ningún botón que ocupe sitio. */}
            {connectedIds.length > 0 ? <ActionButton testID="present-connections-open" label={locale === 'es' ? `Conexiones · ${connectedIds.length}` : `Connections · ${connectedIds.length}`}
              onPress={() => setConnectionsOpen(true)} /> : null}
            {branchPath.length > 0 ? <ActionButton testID="present-return-branch" label={locale === 'es' ? '↩ Volver del desvío' : '↩ Return from branch'} onPress={returnFromBranch} /> : null}
            {Platform.OS === 'web' ? <ActionButton testID="present-fullscreen" label={t(fullscreen ? 'present.exitFullscreen' : 'present.fullscreen', locale)} onPress={() => void toggleFullscreen()} /> : null}
          </View>
        </View>
        {fullscreenProblem ? <Text accessibilityRole="alert" style={{ color: colors.danger, paddingHorizontal: 16 }}>{t('present.fullscreenUnavailable', locale)}</Text> : null}
      </View>
      <ReadingOrderDialog testID="present-order-list" visible={organizing} compact={Platform.OS !== 'web'} onClose={() => setOrganizing(false)}
        items={entries.map((entry) => {
          const thumbRef = entry.imageRefs.find((ref) => images.has(ref));
          const thumbnailUri = thumbRef ? images.get(thumbRef) : undefined;
          return { id: entry.id, title: entry.title, typeLabel: entry.typeLabel, excerpt: readingPreviewText(entry), ...(thumbnailUri ? { thumbnailUri } : {}) };
        })}
        order={orderIds} onChange={setOrderIds} excluded={excludedIds} onExcludedChange={setExcludedIds} />
      {/* B9-R3-03: panel contextual desplegable (mismo `Dialog` reutilizado, no un sistema de
          navegación nuevo) — resumen de texto seguro (nunca HTML) para inspeccionar el destino antes
          de saltar. En móvil web se superpone en vez de desplazar la Nota (no reparte el ancho con ella). */}
      <Dialog visible={connectionsOpen} title={locale === 'es' ? 'Conexiones' : 'Connections'} compact={Platform.OS !== 'web'} presentation="centered"
        onClose={() => setConnectionsOpen(false)} testID="present-connections">
        <View style={{ gap: 10 }}>
          {connectedIds.map((id) => {
            const target = sequence.find((candidate) => candidate.id === id);
            if (!target) return null;
            const preview = readingPreviewText(target, 160);
            // B9-R4-08 (alternativa A): la misma miniatura que ya identifica cada fila del orden de
            // lectura (`entry.imageRefs` + `images`, sin resolución nueva) ayuda a reconocer el destino
            // antes de visitarlo, en vez de solo título y extracto de texto.
            const thumbRef = target.imageRefs.find((ref) => images.has(ref));
            const thumbnailUri = thumbRef ? images.get(thumbRef) : undefined;
            return <View key={id} style={[styles.connectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {thumbnailUri ? <Image accessibilityIgnoresInvertColors source={{ uri: thumbnailUri }} resizeMode="cover" style={[styles.connectionThumb, { borderColor: colors.border }]} /> : null}
                <Text numberOfLines={1} style={{ color: colors.textPrimary, fontWeight: '700', flex: 1 }}>{target.title || target.typeLabel}</Text>
              </View>
              {preview ? <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 13 }}>{preview}</Text> : null}
              <ActionButton label={locale === 'es' ? 'Visitar' : 'Visit'} accessibilityLabel={`${locale === 'es' ? 'Visitar' : 'Visit'} ${target.title || target.typeLabel}`}
                onPress={() => { if (entry) setBranchPath([...branchPath, entry.id]); setSelectedId(id); setConnectionsOpen(false); }} />
            </View>;
          })}
        </View>
      </Dialog>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  boardTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '800' },
  // Contenido principal (B9-R2-04): scroll propio. El panel de conexiones ya no reparte este ancho
  // de forma permanente (B9-R3-03) — vive en su propio `Dialog`, a demanda.
  main: { flex: 1, minHeight: 0 },
  connectionCard: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  connectionThumb: { width: 40, height: 40, borderWidth: 1 },
  slide: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 8, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  noteFrame: { borderWidth: 2, overflow: 'hidden', minHeight: 160 },
  noteHeader: { padding: 12 },
  noteContent: { padding: 16, gap: 12 },
  meta: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  content: { fontSize: 18, lineHeight: 27 },
  shapeSlide: { flex: 1, minHeight: 200, padding: 24 },
  connectorSlide: { flex: 1, minHeight: 80, justifyContent: 'center', padding: 24 },
  tags: { fontSize: 14, fontWeight: '700' },
  connections: { gap: 4 },
  connection: { fontSize: 14 },
  // B. navegación principal: dos filas (anterior/salto/siguiente, luego organizar/pantalla completa)
  // en vez de una franja única y extensa.
  nav: { gap: 8, padding: 16 },
  navRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  progressTrack: { height: 4, width: '100%', backgroundColor: '#777777' },
  progressFill: { height: 4 },
});
