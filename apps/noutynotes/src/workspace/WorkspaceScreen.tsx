import { addCardToBoard } from '@noutynotes/application';
import type { PrototypeCardKind } from '@noutynotes/application';
import type { CardId } from '@noutynotes/domain';
import { resolveLayoutMode, useTheme, useWindowWidth } from '@noutynotes/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '../components/controls';
import { Board } from './Board';
import { CardInspector } from './CardInspector';
import { useWorkspaceEditor } from './useWorkspaceEditor';

/** A partir de este ancho el editor de la tarjeta se coloca junto al tablero. */
const SIDE_INSPECTOR_MIN_WIDTH = 1100;

const additions: readonly { kind: PrototypeCardKind; label: string; success: string }[] = [
  { kind: 'note', label: 'Añadir nota', success: 'Nota añadida. Guardado en memoria.' },
  { kind: 'image', label: 'Añadir imagen', success: 'Imagen de ejemplo añadida. Guardado en memoria.' },
];

export function WorkspaceScreen() {
  const { theme } = useTheme();
  const colors = theme.colors;
  const width = useWindowWidth();
  const mode = resolveLayoutMode(width);
  const compact = mode === 'compact';
  const sideInspector = width !== null && width >= SIDE_INSPECTOR_MIN_WIDTH;
  const params = useLocalSearchParams<{ id?: string }>();
  const { view, feedback, run } = useWorkspaceEditor(typeof params.id === 'string' ? params.id : undefined);
  const [selectedId, setSelectedId] = useState<CardId | null>(null);
  const scroll = useRef<ScrollView>(null);

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const select = (cardId: CardId) => {
    setSelectedId(cardId);
    // En pantallas apiladas el editor está encima del tablero; sin animación, el resultado es inmediato.
    if (!sideInspector) scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const workspace = view.kind === 'ready' ? view.workspace : null;
  const board = workspace?.boards[0];
  const layout = board ? workspace?.layouts.find((candidate) => candidate.boardId === board.id) : undefined;
  const selected = workspace?.cards.find((card) => card.id === selectedId);

  const inspector = workspace && board && selected ? (
    <CardInspector
      key={selected.id}
      workspace={workspace}
      boardId={board.id}
      card={selected}
      placement={layout?.placements.find((placement) => placement.cardId === selected.id)}
      run={run}
      onClose={() => setSelectedId(null)}
    />
  ) : null;

  return (
    <SafeAreaView testID="workspace-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView ref={scroll} contentContainerStyle={[styles.page, { padding: compact ? 16 : 32 }]}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <ActionButton label="← Mis espacios" accessibilityLabel="Volver a mis espacios" onPress={goHome} />
          <View testID="workspace-memory" style={[styles.memoryChip, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.memoryText, { color: colors.textPrimary }]}>SOLO EN MEMORIA · SE PIERDE AL RECARGAR</Text>
          </View>
        </View>

        {view.kind === 'loading' ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Abriendo el espacio…</Text>
        ) : null}

        {view.kind === 'missing' ? (
          <View testID="workspace-missing" style={[styles.missing, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 28 : 40 }]}>
              Espacio no disponible
            </Text>
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.textPrimary }]}>{view.message}</Text>
          </View>
        ) : null}

        {workspace ? (
          <>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 28 : 40 }]}>
                {workspace.metadata.name}
              </Text>
              <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
                {(board?.title ?? 'SIN TABLERO').toUpperCase()} · {workspace.cards.length === 1 ? '1 TARJETA' : `${workspace.cards.length} TARJETAS`}
              </Text>
            </View>

            <View style={styles.toolbar}>
              {additions.map((addition) => (
                <ActionButton
                  key={addition.kind}
                  label={`+ ${addition.label.replace('Añadir ', '')}`}
                  accessibilityLabel={addition.label}
                  tone="primary"
                  onPress={() => void run((storage, id) => addCardToBoard(storage, id, { kind: addition.kind }), addition.success)
                    .then((result) => { if (result.ok) select(result.value); })}
                />
              ))}
            </View>

            <Text
              testID="workspace-feedback"
              accessibilityLiveRegion="polite"
              {...(feedback?.tone === 'error' ? { accessibilityRole: 'alert' as const } : {})}
              style={[styles.feedback, {
                color: colors.textPrimary,
                backgroundColor: feedback?.tone === 'error' ? colors.note : colors.surfaceRaised,
                borderColor: feedback?.tone === 'error' ? colors.border : 'transparent',
              }]}
            >
              {feedback ? feedback.text : 'Selecciona una tarjeta para editarla, moverla o conectarla.'}
            </Text>

            <View style={[styles.content, sideInspector ? styles.contentRow : styles.contentColumn]}>
              {!sideInspector ? inspector : null}
              <View style={sideInspector ? styles.boardBeside : styles.boardStacked}>
                <Board workspace={workspace} layout={layout} mode={mode} selectedId={selectedId} onSelect={select} />
              </View>
              {sideInspector ? (
                <View style={styles.sidePanel}>
                  {inspector ?? (
                    <View style={[styles.placeholderPanel, { borderColor: colors.gridLine }]}>
                      <Text style={[styles.body, { color: colors.textSecondary }]}>
                        Selecciona una tarjeta del tablero para editar su texto, moverla, cambiar su tamaño o conectarla.
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center', gap: 20 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 16, borderBottomWidth: 2 },
  memoryChip: { paddingHorizontal: 10, paddingVertical: 8 },
  memoryText: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  titleRow: { gap: 6 },
  title: { fontWeight: '900', letterSpacing: -1 },
  eyebrow: { fontFamily: mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  body: { fontSize: 15, lineHeight: 22 },
  missing: { borderWidth: 2, padding: 20, gap: 12 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feedback: { fontSize: 14, lineHeight: 20, padding: 12, borderWidth: 1 },
  content: { gap: 20 },
  contentRow: { flexDirection: 'row', alignItems: 'flex-start' },
  contentColumn: { flexDirection: 'column', alignItems: 'stretch' },
  boardBeside: { flex: 1, minWidth: 0 },
  boardStacked: { width: '100%' },
  sidePanel: { width: 360 },
  placeholderPanel: { borderWidth: 2, borderStyle: 'dashed', padding: 16 },
});
