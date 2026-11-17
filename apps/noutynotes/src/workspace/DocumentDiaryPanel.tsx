import { annotateDocumentInDiary, diaryDocumentAnnotation, documentDiaryAnnotations, localDay, readDocumentQuote, documentQuoteVerified } from '@noutynotes/application';
import type { DocumentQuote, WorkspaceStorageResult } from '@noutynotes/application';
import { richTextDocumentText } from '@noutynotes/domain';
import { markdownRichTextCodec } from '@noutynotes/storage';
import type { Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '../components/AppIcon';
import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';
import { markdownExcerpt } from './markdownLists';
import { RichNoteReader } from './canvas/RichNoteReader';
import { useImagePreviews } from './useImagePreviews';
import { useWorkspaceStorage } from '../session/WorkspaceSession';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;
type Kind = 'pdf' | 'txt' | 'markdown';
type Mode = 'list' | 'compose' | 'detail';

export interface DocumentDiaryPanelProps {
  /** Referencia relativa del Asset abierto (p. ej. `assets/documents/manual.pdf`). */
  readonly documentRef: string;
  readonly documentName: string;
  readonly sourceFingerprint?: string | undefined;
  readonly selectionRequest?: { readonly quote: DocumentQuote; readonly sequence: number } | null;
  readonly kind: Kind;
  /** Mismo criterio que `resolveLayoutMode`: escritorio = franja superpuesta a la derecha; compacto =
   * hoja inferior dentro del propio visor, nunca una columna angosta inviable en móvil. */
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  /** Controlado por el visor contenedor (igual criterio que `order`/`onChange` de
   * `ReadingOrderControl`): así el visor puede colapsar el panel desde su propia jerarquía de Escape
   * sin que este componente necesite saber nada de modales ni de cierre. */
  readonly expanded: boolean;
  readonly onExpandedChange: (next: boolean) => void;
  /** Avisa al visor si hay una reflexión sin guardar, para que pueda confirmar antes de cerrarse —
   * el borrador en sí nunca sale de este componente ni se pierde al colapsar. */
  readonly onDirtyChange: (dirty: boolean) => void;
  /** Mismo patrón ya usado desde B9-R4-11: lleva a la sección Diario (hoy, por construcción). */
  readonly onOpenDiary: () => void;
  readonly testID: string;
}

function parseLocation(raw: string, kind: Kind): { readonly ok: true; readonly value: { readonly page?: number; readonly line?: number; readonly section?: string } } | { readonly ok: false; readonly key: 'diary.annotate.invalidPage' | 'diary.annotate.invalidLine' } {
  const trimmed = raw.trim();
  if (kind === 'markdown') return { ok: true, value: trimmed ? { section: trimmed } : {} };
  if (trimmed === '') return { ok: true, value: {} };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return { ok: false, key: kind === 'pdf' ? 'diary.annotate.invalidPage' : 'diary.annotate.invalidLine' };
  return { ok: true, value: kind === 'pdf' ? { page: parsed } : { line: parsed } };
}

/**
 * Diario lateral contextual (B9-R5): franja de 44×44 que se expande sobre el documento sin cerrar el
 * visor, cambiar su `src`/contenido ni perder la posición de lectura — compartido entre `PdfPreview` y
 * `TextAssetPreviewDialog` para no duplicar esta lógica. Reutiliza `documentDiaryAnnotations` (única
 * fuente: `workspace.cards`) y `annotateDocumentInDiary` (misma validación/persistencia que ya tenía
 * `AnnotateInDiaryDialog`, ahora inline). El visor que lo monta decide cuándo está `expanded` y qué
 * hacer con Escape/cierre según `onDirtyChange` — este componente nunca cierra nada por su cuenta.
 */
export function DocumentDiaryPanel({ documentRef, documentName, kind, compact, workspace, run, expanded, onExpandedChange, onDirtyChange, onOpenDiary, testID, sourceFingerprint, selectionRequest }: DocumentDiaryPanelProps) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  const [mode, setMode] = useState<Mode>('list');
  const [reflection, setReflection] = useState('');
  const [location, setLocation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const wasExpanded = useRef(expanded);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quote, setQuote] = useState<DocumentQuote | null>(null);
  const [seenRequest, setSeenRequest] = useState(selectionRequest);
  const [confirmDiary, setConfirmDiary] = useState(false);
  const listRef = useRef<ScrollView>(null);
  const listOffset = useRef(0);
  const storage = useWorkspaceStorage();
  const images = useImagePreviews(storage, workspace);
  if (selectionRequest && selectionRequest !== seenRequest) {
    setSeenRequest(selectionRequest); setQuote(selectionRequest.quote); setMode('compose');
  }

  const dirty = reflection.trim() !== '' || location.trim() !== '' || quote !== null;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // UX7.3-D/foco (mismo criterio ya probado en `Dialog.tsx`): al expandir, foco al control de
  // contraer; al volver a colapsar, foco de vuelta a la pestaña — sin trampa de Tab (no es un modal,
  // el documento sigue siendo interactivo mientras el panel está abierto en escritorio).
  useEffect(() => {
    if (Platform.OS !== 'web' || wasExpanded.current === expanded) { wasExpanded.current = expanded; return; }
    wasExpanded.current = expanded;
    const target = expanded ? `${testID}-collapse` : `${testID}-tab`;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${target}"]`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expanded, testID]);

  const backToList = () => {
    setMode('list');
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ y: listOffset.current, animated: false });
      if (Platform.OS === 'web' && selectedId) document.querySelector<HTMLElement>(`[data-testid="${testID}-read-${selectedId}"]`)?.focus();
    });
  };
  useEffect(() => {
    if (Platform.OS !== 'web' || !expanded || mode !== 'detail') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        // RN Web Modal closes on keyup; consume that same keystroke after changing view.
        window.addEventListener('keyup', up => { up.preventDefault(); up.stopImmediatePropagation(); }, { capture: true, once: true });
        backToList();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  });
  const startCompose = () => { setJustSaved(false); setProblem(null); setMode('compose'); };
  const cancelCompose = () => { setReflection(''); setLocation(''); setQuote(null); setProblem(null); setMode('list'); };
  const save = async () => {
    if (saving) return;
    const parsed = parseLocation(location, kind);
    if (!parsed.ok) { setProblem(t(parsed.key, locale)); return; }
    setSaving(true);
    setProblem(null);
    const day = localDay(new Date().toISOString(), new Date().getTimezoneOffset());
    const result = await run(
      (storage, workspaceId) => annotateDocumentInDiary(storage, workspaceId, {
        day, createdAt: new Date().toISOString(), documentRef, documentName, reflection, ...parsed.value, ...(quote ? { quote } : {}),
      }),
      { key: 'action.diaryAnnotationSaved' },
    );
    setSaving(false);
    if (!result.ok) { setProblem(t('diary.annotate.failed', locale)); return; }
    setReflection(''); setLocation(''); setQuote(null); setMode('list'); setJustSaved(true);
  };

  if (!expanded) {
    const count = documentDiaryAnnotations(workspace, documentRef).length;
    return (
      <Pressable testID={`${testID}-tab`} accessibilityRole="button"
        accessibilityLabel={count > 0 ? t('diary.panel.tab.accessibilityLabel', locale, { count: String(count) }) : t('diary.panel.tab', locale)}
        onPress={() => onExpandedChange(true)} style={[styles.tab, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <AppIcon name="diary" size={20} />
        {count > 0 ? (
          <View testID={`${testID}-count`} style={[styles.badge, { backgroundColor: colors.selection, borderColor: colors.border }]}>
            <Text style={[styles.badgeText, { color: colors.textPrimary }]}>{count > 9 ? '9+' : String(count)}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  const annotations = documentDiaryAnnotations(workspace, documentRef);
  const selected = annotations.find(card => card.id === selectedId);
  const selectedQuote = readDocumentQuote(selected?.fields['documento-cita']);
  const parsedBody = selected?.contentDocument ? { ok: true as const, value: selected.contentDocument } : markdownRichTextCodec.parse(selected?.content ?? '');
  const showQuote = (value: DocumentQuote | null) => value ? <ScrollView testID={`${testID}-quote`} style={{maxHeight: 160, flexShrink: 0}} contentContainerStyle={[styles.quote, { borderColor: colors.border }]}>
    <Text selectable style={{ color: colors.textPrimary }}>{value.text}</Text>
    <Text style={{ color: colors.textSecondary }}>{documentQuoteVerified(value, sourceFingerprint) ? `${t('diary.document.line', locale, { line: String(value.line) })} · ${t('diary.quote.verified', locale)}` : t('diary.quote.unverified', locale)}</Text>
  </ScrollView> : null;
  return (
    <View testID={testID} style={[compact ? styles.expandedCompact : styles.expandedWide, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{`${t('diary.panel.heading', locale)} · ${annotations.length}`}</Text>
        <Pressable testID={`${testID}-collapse`} accessibilityRole="button" accessibilityLabel={t('diary.panel.collapse', locale)}
          onPress={() => onExpandedChange(false)} style={styles.collapseButton}>
          <AppIcon name="collapse" size={18} />
        </Pressable>
      </View>
      {confirmDiary ? <View style={styles.composeBody}>
        <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{t('diary.entry.discard.confirm', locale)}</Text>
        <ActionButton label={t('diary.entry.keepEditing', locale)} onPress={() => setConfirmDiary(false)} />
        <ActionButton label={t('diary.entry.discard.confirmLabel', locale)} onPress={onOpenDiary} />
      </View> : null}
      {mode === 'detail' ? <View testID={`${testID}-detail`} style={{ flex: 1, minHeight: 0, padding: 8, gap: 8 }}>
        <ActionButton label={t('diary.panel.back', locale)} onPress={backToList} />
        {selected ? <>
          <Text accessibilityRole="header" style={{ color: colors.textPrimary }}>{selected.title}</Text>
          {showQuote(selectedQuote)}
          {parsedBody.ok ? <RichNoteReader key={selected.id} document={parsedBody.value} imageResources={images.refResources} imageFit="contain" color={colors.textPrimary} testID={`${testID}-body`} /> : <ScrollView><Text selectable style={{ color: colors.textPrimary }}>{selected.content}</Text></ScrollView>}
          <ActionButton label={t('diary.panel.openDiary', locale)} onPress={() => { if (dirty) setConfirmDiary(true); else onOpenDiary(); }} />
        </> : <Text style={{ color: colors.textSecondary }}>{t('diary.panel.unavailable', locale)}</Text>}
      </View> : null}
      {mode === 'compose' ? (
        <ScrollView contentContainerStyle={styles.composeBody}>
          <ActionButton label={t('diary.panel.back', locale)} onPress={backToList} />
          {showQuote(quote)}
          <TextField label={t('diary.annotate.reflection.label', locale)} value={reflection} onChangeText={setReflection}
            placeholder={t('diary.annotate.reflection.placeholder', locale)} multiline testID={`${testID}-reflection`} />
          {kind !== 'markdown' ? (
            <TextField label={t(kind === 'pdf' ? 'diary.annotate.page.label' : 'diary.annotate.line.label', locale)}
              value={location} onChangeText={(value) => { setLocation(value); setProblem(null); }}
              placeholder={t(kind === 'pdf' ? 'diary.annotate.page.placeholder' : 'diary.annotate.line.placeholder', locale)} testID={`${testID}-location`} />
          ) : (
            <TextField label={t('diary.annotate.section.label', locale)} value={location} onChangeText={setLocation}
              placeholder={t('diary.annotate.section.placeholder', locale)} testID={`${testID}-location`} />
          )}
          {problem ? <Text testID={`${testID}-problem`} accessibilityRole="alert" style={[styles.problem, { color: colors.danger }]}>{problem}</Text> : null}
          <View style={styles.row}>
            <ActionButton testID={`${testID}-save`} label={t('diary.annotate.save', locale)} tone="primary" disabled={saving} onPress={() => void save()} />
            <ActionButton label={t('trash.cancel', locale)} onPress={cancelCompose} />
          </View>
        </ScrollView>
      ) : null}
        <View style={{ flex: 1, display: mode === 'list' ? 'flex' : 'none' }}>
          <ActionButton testID={`${testID}-add`} label={t('diary.panel.add', locale)} tone="primary" onPress={startCompose} style={styles.addButton} />
          {justSaved ? <Text testID={`${testID}-saved`} style={[styles.saved, { color: colors.textPrimary }]}>{t('diary.annotate.saved', locale)}</Text> : null}
          <ScrollView ref={listRef} onScroll={event => { listOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={32} style={styles.list} nestedScrollEnabled>
            {annotations.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('diary.panel.empty', locale)}</Text>
            ) : annotations.map((card) => {
              const doc = diaryDocumentAnnotation(card);
              const excerpt = card.contentDocument ? richTextDocumentText(card.contentDocument) : markdownExcerpt(card.content ?? '');
              const day = typeof card.fields.fecha === 'string' ? card.fields.fecha : '';
              return (
                <View key={card.id} testID={`${testID}-row-${card.id}`} style={[styles.row2, { borderColor: colors.border }]}>
                  <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                    {[day, doc?.page !== undefined ? t('diary.document.page', locale, { page: String(doc.page) }) : null,
                      doc?.line !== undefined ? t('diary.document.line', locale, { line: String(doc.line) }) : null,
                      doc?.section !== undefined ? t('diary.document.section', locale, { section: doc.section }) : null].filter(Boolean).join(' · ')}
                  </Text>
                  {excerpt ? <Text numberOfLines={3} style={{ color: colors.textPrimary }}>{excerpt}</Text> : null}
                  <ActionButton testID={`${testID}-read-${card.id}`} label={t('diary.panel.read', locale)} onPress={() => {
                    setSelectedId(card.id); setMode('detail');
                    requestAnimationFrame(() => { if (Platform.OS === 'web') document.querySelector<HTMLElement>(`[data-testid="${testID}-detail"] [role="button"]`)?.focus(); });
                  }} />
                </View>
              );
            })}
          </ScrollView>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 3, padding: 8, gap: 6 },
  tab: { position: 'absolute', right: 0, top: '50%', marginTop: -22, width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  expandedWide: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 280, borderLeftWidth: 2, zIndex: 2 },
  expandedCompact: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', borderTopWidth: 2, zIndex: 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8, borderBottomWidth: 1, gap: 8 },
  heading: { fontSize: 14, fontWeight: '800', flex: 1 },
  collapseButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  composeBody: { padding: 8, gap: 10 },
  problem: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 6 },
  addButton: { margin: 8 },
  saved: { paddingHorizontal: 8, fontSize: 13 },
  list: { flex: 1, paddingHorizontal: 8 },
  empty: { fontSize: 13, paddingVertical: 8 },
  row2: { borderWidth: 1, padding: 8, gap: 4, marginBottom: 8 },
  rowMeta: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, fontWeight: '700' },
});
