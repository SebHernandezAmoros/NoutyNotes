import { activeDays, dailyLog, dailyLogRange, diaryExportText, editCardContent, fold, isDay, localDay, moveCardToTrash, openDiaryEntry, shiftDay } from '@noutynotes/application';
import type { RangeLogItem, TimedCard, WorkspaceStorageResult } from '@noutynotes/application';
import { cardTitleText, createEmptyRichTextDocument, richTextDocumentText } from '@noutynotes/domain';
import type { BoardId, Card, CardId, CardTypeId, RichTextDocument, Workspace } from '@noutynotes/domain';
import { markdownRichTextCodec } from '@noutynotes/storage';
import type { Locale } from '@noutynotes/ui';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';
import { downloadTextFile, supportsTextDownload } from '../session/textDownload';
import { diaryEditingDirty, persistLatestDiaryRevision } from './diaryEditing';
import type { DiaryEditing } from './diaryEditing';
import { markdownExcerpt } from './markdownLists';
import { RichTextEditor } from './RichTextEditor';
import { useEscapeBack } from './useEscapeBack';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface DiaryViewProps {
  readonly active: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  readonly onGo: (cardId: CardId) => void;
  readonly onBack: () => void;
}

const monthsByLocale: Readonly<Record<Locale, readonly string[]>> = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const weekdaysByLocale: Readonly<Record<Locale, readonly string[]>> = {
  es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};
const offset = () => new Date().getTimezoneOffset();
const today = () => localDay(new Date().toISOString(), offset());
const longDay = (day: string, locale: Locale) => {
  const dayNumber = Number(day.slice(8, 10));
  const month = monthsByLocale[locale][Number(day.slice(5, 7)) - 1];
  const year = day.slice(0, 4);
  return locale === 'es' ? `${dayNumber} de ${month} de ${year}` : `${month} ${dayNumber}, ${year}`;
};
type SummaryUnit = 'entries' | 'created' | 'archived';
const summaryUnit = (base: SummaryUnit, count: number, locale: Locale) =>
  t(count === 1 ? `diary.summary.${base}.one` : `diary.summary.${base}.many`, locale, { count: String(count) });
const resultUnit = (count: number, locale: Locale) => t(count === 1 ? 'unit.resultUpper.one' : 'unit.resultUpper.many', locale, { count: String(count) });
const documentFor = (card: Card | undefined): RichTextDocument => {
  if (card?.contentDocument) return card.contentDocument;
  const parsed = markdownRichTextCodec.parse(card?.content ?? '');
  return parsed.ok ? parsed.value : createEmptyRichTextDocument();
};
const bodyText = (card: Card) => card.contentDocument
  ? richTextDocumentText(card.contentDocument)
  : markdownExcerpt(card.content ?? '');
/**
 * Diario (ADR 0024, ADR 0036): vista de trabajo real a pantalla completa, no un diálogo estrecho.
 * Entradas del día y cronología con fechas reales (tarjetas creadas desde esta versión y archivadas).
 * Nada se simula: un día sin datos lo dice.
 */
export function DiaryView({ active, compact, workspace, run, onGo, onBack }: DiaryViewProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [day, setDay] = useState(today);
  const [dayDraft, setDayDraft] = useState(day);
  const [editing, setEditing] = useState<DiaryEditing | null>(null);
  const editingRef = useRef<DiaryEditing | null>(null);
  const persistQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [discarding, setDiscarding] = useState(false);
  const [trashing, setTrashing] = useState<CardId | null>(null);
  const [mode, setMode] = useState<'day' | 'search'>('day');
  const [rangeFrom, setRangeFrom] = useState(today);
  const [rangeTo, setRangeTo] = useState(today);
  const [searchTypeId, setSearchTypeId] = useState<CardTypeId | null>(null);
  const [searchTag, setSearchTag] = useState<string | null>(null);
  const [searchBoardId, setSearchBoardId] = useState<BoardId | null>(null);
  const [searchText, setSearchText] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const log = dailyLog(workspace, day, offset());
  const typeLabel = (card: Card) => workspace.cardTypes.find((type) => type.id === card.typeId)?.label ?? t('trash.item.type.fallback', locale);
  const onBoard = (cardId: CardId) => workspace.boards.some((board) => board.cardIds.includes(cardId));

  // Modo «Buscar» (ADR 0037): filtro y búsqueda del rango, en la vista, como ya hacen Assets/Archivo.
  const rangeValid = isDay(rangeFrom) && isDay(rangeTo) && rangeFrom <= rangeTo;
  const range = rangeValid ? dailyLogRange(workspace, rangeFrom, rangeTo, offset()) : null;
  const rangeItems = range?.ok ? range.items : [];
  const rangeError = range && !range.ok ? range.reason : !rangeValid ? t('diary.search.range.invalid', locale) : null;
  const availableTypes = [...new Map(rangeItems.map((item) => [item.card.typeId, typeLabel(item.card)])).entries()];
  const availableTags = [...new Set(rangeItems.flatMap((item) => item.card.tags ?? []))].sort();
  const searchFold = fold(searchText.trim());
  const filteredItems = rangeItems.filter((item) => (searchTypeId === null || item.card.typeId === searchTypeId)
    && (searchTag === null || (item.card.tags ?? []).includes(searchTag))
    && (searchBoardId === null || item.boardIds.includes(searchBoardId))
    && (searchFold === '' || fold([cardTitleText(item.card), bodyText(item.card), (item.card.tags ?? []).join(' ')].join('\n')).includes(searchFold)));
  const rangeVerb: Readonly<Record<RangeLogItem['kind'], string>> = {
    entry: t('diary.verb.entry', locale), created: t('diary.verb.created', locale), archived: t('diary.verb.archived', locale),
  };
  const exportRange = () => {
    setExportError(null);
    const result = diaryExportText(workspace, rangeFrom, rangeTo, offset());
    if (!result.ok) {
      setExportError(result.reason);
      return;
    }
    downloadTextFile(rangeFrom === rangeTo ? `diario-${rangeFrom}.md` : `diario-${rangeFrom}_${rangeTo}.md`, result.text);
  };
  const isToday = day === today();
  const month = day.slice(0, 7);
  const activeDaySet = activeDays(workspace, month, offset());
  const firstWeekday = (new Date(`${month}-01T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const monthDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

  const setEdit = (next: DiaryEditing | null) => {
    editingRef.current = next;
    setEditing(next);
    if (next === null) setDiscarding(false);
  };
  const beginEditing = (card: Card | undefined, cardId: CardId, fallbackTitle: string) => {
    const title = card?.title ?? fallbackTitle;
    const document = documentFor(card);
    setEdit({ id: cardId, title, document, initialTitle: title, initialDocument: document });
  };
  const persistEditing = (close: boolean): Promise<boolean> => {
    const task = persistQueueRef.current.then(async () => {
      const current = editingRef.current;
      if (!current) return true;
      if (!diaryEditingDirty(current)) {
        if (close) setEdit(null);
        return true;
      }
      const saved = await persistLatestDiaryRevision(current, () => editingRef.current, async (revision) => {
        const result = await run(
          (storage, workspaceId) => editCardContent(storage, workspaceId, revision.id, { title: revision.title, contentDocument: revision.document }),
          'action.diaryEntrySaved', { reactive: true },
        );
        return result.ok;
      });
      if (!saved) return false;
      const latest = editingRef.current;
      if (close) setEdit(null);
      else if (latest) setEdit({ ...latest, initialTitle: latest.title, initialDocument: latest.document });
      return true;
    });
    persistQueueRef.current = task;
    return task;
  };
  const go = async (next: string) => {
    if (!await persistEditing(true)) return;
    setDay(next);
    setDayDraft(next);
  };
  const write = async (reuse: boolean) => {
    if (!await persistEditing(true)) return;
    const result = await run((storage, id) => openDiaryEntry(storage, id, { day, createdAt: new Date().toISOString(), reuse }),
      reuse ? 'action.diaryEntryReady' : 'action.diaryEntryNew');
    if (!result.ok) return;
    const existing = workspace.cards.find((card) => card.id === result.value);
    beginEditing(existing, result.value, `Diario ${day}`);
  };
  const back = async () => {
    if (await persistEditing(true)) onBack();
  };
  const changeMode = async (next: 'day' | 'search') => {
    if (next === mode || await persistEditing(true)) setMode(next);
  };
  const trashEntry = async (cardId: CardId) => {
    if (editingRef.current?.id === cardId && !await persistEditing(false)) return;
    const result = await run((storage, workspaceId) => moveCardToTrash(storage, workspaceId, cardId), 'action.cardTrashed');
    if (!result.ok) return;
    if (editingRef.current?.id === cardId) setEdit(null);
    setTrashing(null);
  };
  const goToCard = async (cardId: CardId) => {
    if (!await persistEditing(true)) return;
    onBack();
    onGo(cardId);
  };
  useEscapeBack(active, () => { void back(); });
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !diaryEditingDirty(editing)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);
  const timeline = (items: readonly TimedCard[], verb: string, testID: string) => items.map(({ card, time }) => (
    <View key={`${testID}-${card.id}`} testID={`${testID}-${card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${time} · ${verb} · ${typeLabel(card).toUpperCase()}`}</Text>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{cardTitleText(card) || t('trash.item.untitled', locale)}</Text>
      {(card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
      {bodyText(card) ? <Text numberOfLines={2} style={[styles.body, { color: colors.textPrimary }]}>{bodyText(card).replace(/\s+/g, ' ').trim()}</Text> : null}
      {testID === 'log-created' && onBoard(card.id) ? <ActionButton label={t('search.go', locale)} accessibilityLabel={t('search.go.accessibilityLabel', locale, { title: cardTitleText(card) || t('trash.item.untitled', locale) })} onPress={() => { void goToCard(card.id); }} /> : null}
    </View>
  ));

  return (
    <View testID="diary-view" style={styles.screen}>
      <View style={[styles.header, { borderColor: colors.gridLine }]}>
        <ActionButton label="←" accessibilityLabel={t('workview.back', locale)} onPress={() => { void back(); }} />
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t('nav.diary', locale)}</Text>
      </View>
      {/* Barra contextual: navegación de fecha y escritura, propias de esta vista (ADR 0036). */}
      <View style={[styles.toolbar, { borderColor: colors.gridLine }]}>
        <ActionButton label={t('diary.mode.day', locale)} pressed={mode === 'day'} accessibilityLabel={t('diary.mode.day.accessibilityLabel', locale)} onPress={() => { void changeMode('day'); }} />
        <ActionButton label={t('tool.search', locale)} pressed={mode === 'search'} accessibilityLabel={t('diary.mode.search.accessibilityLabel', locale)} onPress={() => { void changeMode('search'); }} />
        {mode === 'day' ? (
          <>
            <ActionButton label="←" accessibilityLabel={t('diary.day.prev.accessibilityLabel', locale)} onPress={() => { void go(shiftDay(day, -1)); }} />
            <ActionButton label={t('diary.day.today', locale)} pressed={isToday} accessibilityLabel={t('diary.day.today.accessibilityLabel', locale)} onPress={() => { void go(today()); }} />
            <ActionButton label="→" accessibilityLabel={t('diary.day.next.accessibilityLabel', locale)} onPress={() => { void go(shiftDay(day, 1)); }} />
            <ActionButton label={isToday ? t('diary.write.today', locale) : t('diary.write.day', locale)} tone="primary"
              accessibilityLabel={isToday ? t('diary.write.today', locale) : t('diary.write.day.accessibilityLabel', locale, { day: longDay(day, locale) })} onPress={() => void write(true)} />
            {log.entries.length > 0 ? <ActionButton label={t('diary.write.new', locale)} accessibilityLabel={t('diary.write.new.accessibilityLabel', locale)} onPress={() => void write(false)} /> : null}
          </>
        ) : (
          supportsTextDownload() ? <ActionButton label={t('diary.export', locale)} accessibilityLabel={t('diary.export.accessibilityLabel', locale)} onPress={exportRange} /> : null
        )}
      </View>
      {mode === 'search' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.row}>
            <TextField label={t('diary.search.from.label', locale)} value={rangeFrom} onChangeText={setRangeFrom} testID="diary-search-from" placeholder="2026-09-01" />
            <TextField label={t('diary.search.to.label', locale)} value={rangeTo} onChangeText={setRangeTo} testID="diary-search-to" placeholder="2026-09-28" />
          </View>
          {rangeError ? <Text style={[styles.hint, { color: colors.danger }]}>{rangeError}</Text> : null}
          <TextField label={t('diary.search.text.label', locale)} value={searchText} onChangeText={setSearchText} placeholder={t('diary.search.text.placeholder', locale)} testID="diary-search-text" />
          {exportError ? <Text testID="diary-export-error" style={[styles.hint, { color: colors.danger }]}>{exportError}</Text> : null}
          {availableTypes.length > 0 ? (
            <View style={styles.row} accessibilityLabel={t('diary.filter.type.label', locale)}>
              <ActionButton label={t('diary.filter.type.all', locale)} pressed={searchTypeId === null} accessibilityLabel={t('diary.filter.type.all', locale)} onPress={() => setSearchTypeId(null)} />
              {availableTypes.map(([id, label]) => (
                <ActionButton key={id} label={label} pressed={searchTypeId === id} accessibilityLabel={t('diary.filter.type.only', locale, { label })} onPress={() => setSearchTypeId(id)} />
              ))}
            </View>
          ) : null}
          {availableTags.length > 0 ? (
            <View style={styles.row} accessibilityLabel={t('diary.filter.tag.label', locale)}>
              <ActionButton label={t('diary.filter.tag.all', locale)} pressed={searchTag === null} accessibilityLabel={t('diary.filter.tag.all', locale)} onPress={() => setSearchTag(null)} />
              {availableTags.map((tag) => (
                <ActionButton key={tag} label={`#${tag}`} pressed={searchTag === tag} accessibilityLabel={t('diary.filter.tag.only', locale, { tag })} onPress={() => setSearchTag(tag)} />
              ))}
            </View>
          ) : null}
          {workspace.boards.length > 1 ? (
            <View style={styles.row} accessibilityLabel={t('diary.filter.board.label', locale)}>
              <ActionButton label={t('diary.filter.board.all', locale)} pressed={searchBoardId === null} accessibilityLabel={t('diary.filter.board.all', locale)} onPress={() => setSearchBoardId(null)} />
              {workspace.boards.map((board) => (
                <ActionButton key={board.id} label={board.title} pressed={searchBoardId === board.id} accessibilityLabel={t('diary.filter.board.only', locale, { title: board.title })} onPress={() => setSearchBoardId(board.id)} />
              ))}
            </View>
          ) : null}
          <Text testID="diary-search-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {rangeError ? t('diary.search.count.none', locale) : resultUnit(filteredItems.length, locale)}
          </Text>
          {!rangeError && filteredItems.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('diary.search.empty', locale)}</Text> : null}
          {filteredItems.map((item) => (
            <View key={`${item.kind}-${item.card.id}`} testID={`diary-search-result-${item.card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${item.day} ${item.time} · ${rangeVerb[item.kind]} · ${typeLabel(item.card).toUpperCase()}`}</Text>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{cardTitleText(item.card) || t('trash.item.untitled', locale)}</Text>
              {(item.card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(item.card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
              {bodyText(item.card) ? <Text numberOfLines={2} style={[styles.body, { color: colors.textPrimary }]}>{bodyText(item.card).replace(/\s+/g, ' ').trim()}</Text> : null}
              {item.kind === 'created' && onBoard(item.card.id) ? <ActionButton label={t('search.go', locale)} accessibilityLabel={t('search.go.accessibilityLabel', locale, { title: cardTitleText(item.card) || t('trash.item.untitled', locale) })} onPress={() => { void goToCard(item.card.id); }} /> : null}
            </View>
          ))}
        </ScrollView>
      ) : (
      <ScrollView contentContainerStyle={[styles.content, compact ? null : styles.contentWide]}>
        <View style={compact ? styles.column : styles.mainColumn}>
          <Text accessibilityRole="header" testID="log-day" style={[styles.day, { color: colors.textPrimary }]}>{`${longDay(day, locale)}${isToday ? t('diary.day.todaySuffix', locale) : ''}`}</Text>
          <TextField label={t('diary.day.goto.label', locale)} value={dayDraft} onChangeText={setDayDraft} testID="log-date-input"
            onSubmitEditing={() => { if (isDay(dayDraft.trim())) void go(dayDraft.trim()); }} placeholder="2026-09-26" />
          {dayDraft.trim() !== day && !isDay(dayDraft.trim()) && dayDraft.trim().length >= 10 ? (
            <Text style={[styles.hint, { color: colors.danger }]}>{t('diary.day.invalid', locale)}</Text>
          ) : null}

          <Text testID="log-summary" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {log.summary.entries + log.summary.created + log.summary.archived === 0
              ? t('diary.summary.none', locale)
              : [summaryUnit('entries', log.summary.entries, locale), summaryUnit('created', log.summary.created, locale), summaryUnit('archived', log.summary.archived, locale)].join(' · ')}
          </Text>
          {log.summary.tags.length > 0 ? (
            <Text testID="log-tags" style={[styles.meta, { color: colors.selection }]}>{log.summary.tags.slice(0, 5).map(({ tag, count }) => `#${tag} ${count}`).join('   ')}</Text>
          ) : null}

          <Text style={[styles.section, { color: colors.textSecondary }]}>{t('diary.section.entries', locale)}</Text>
          {log.entries.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('diary.entries.empty', locale)}</Text> : log.entries.map((entry) => (
            <View key={entry.id} testID={`log-entry-${entry.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {editing?.id === entry.id ? (
                <>
                  <TextField label={t('diary.entry.title.label', locale)} value={editing.title} onChangeText={(title) => setEdit({ ...editing, title })} />
                  <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>{t('diary.entry.content.label', locale)}</Text>
                  <RichTextEditor
                    key={editing.id}
                    cardId={editing.id}
                    document={editing.document}
                    codec={markdownRichTextCodec}
                    onChange={(document) => {
                      const current = editingRef.current;
                      if (current) setEdit({ ...current, document });
                    }}
                  />
                  <View style={styles.row}>
                    <ActionButton label={t('diary.entry.save', locale)} tone="primary" onPress={() => { void persistEditing(true); }} />
                    <ActionButton label={diaryEditingDirty(editing) ? t('diary.entry.discard', locale) : t('trash.cancel', locale)} accessibilityLabel={t('diary.entry.cancel.accessibilityLabel', locale)}
                      onPress={() => { if (diaryEditingDirty(editing)) setDiscarding(true); else setEdit(null); }} />
                    <ActionButton label={t('diary.entry.trash', locale)} accessibilityLabel={t('diary.entry.trash.accessibilityLabel', locale, { title: editing.title || t('trash.item.untitled', locale) })}
                      onPress={() => setTrashing(entry.id)} />
                  </View>
                  {discarding ? (
                    <View testID="diary-discard-confirmation" style={[styles.confirm, { borderColor: colors.danger }]}>
                      <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>{t('diary.entry.discard.confirm', locale)}</Text>
                      <View style={styles.row}>
                        <ActionButton label={t('diary.entry.keepEditing', locale)} tone="primary" onPress={() => setDiscarding(false)} />
                        <ActionButton label={t('diary.entry.discard.confirmLabel', locale)} onPress={() => setEdit(null)} />
                      </View>
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.title ?? t('trash.item.untitled', locale)}</Text>
                  {bodyText(entry) ? <Text numberOfLines={4} style={[styles.body, { color: colors.textPrimary }]}>{bodyText(entry)}</Text> : <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('diary.entry.empty', locale)}</Text>}
                  <View style={styles.row}>
                    <ActionButton label={t('diary.entry.edit', locale)} accessibilityLabel={t('diary.entry.edit.accessibilityLabel', locale, { title: entry.title ?? t('diary.entry.fallback', locale) })} onPress={() => beginEditing(entry, entry.id, '')} />
                    <ActionButton label={t('diary.entry.trash', locale)} accessibilityLabel={t('diary.entry.trash.accessibilityLabel', locale, { title: entry.title ?? t('trash.item.untitled', locale) })} onPress={() => setTrashing(entry.id)} />
                  </View>
                </>
              )}
              {trashing === entry.id ? (
                <View testID={`diary-trash-confirmation-${entry.id}`} style={[styles.confirm, { borderColor: colors.danger }]}>
                  <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>{t('diary.entry.trash.confirm', locale, { title: entry.title ?? t('trash.item.untitled', locale) })}</Text>
                  <View style={styles.row}>
                    <ActionButton label={t('diary.entry.trash.confirmLabel', locale)} onPress={() => { void trashEntry(entry.id); }} />
                    <ActionButton label={t('trash.cancel', locale)} onPress={() => setTrashing(null)} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}

          <Text style={[styles.section, { color: colors.textSecondary }]}>{t('diary.section.timeline', locale)}</Text>
          {log.created.length + log.archived.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('diary.timeline.empty', locale)}</Text>
          ) : (
            <>
              {timeline(log.created, t('diary.verb.created', locale), 'log-created')}
              {timeline(log.archived, t('diary.verb.archived', locale), 'log-archived')}
            </>
          )}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('diary.footnote', locale)}
          </Text>
        </View>

        <View style={compact ? styles.column : styles.sideColumn}>
          <Text style={[styles.section, { color: colors.textSecondary }]}>{`${monthsByLocale[locale][Number(month.slice(5, 7)) - 1]?.toUpperCase()} ${month.slice(0, 4)}`}</Text>
          <View style={styles.calendar} accessibilityLabel={t('diary.calendar.label', locale)}>
            {weekdaysByLocale[locale].map((weekday, index) => <Text key={`${weekday}-${index}`} style={[styles.cell, styles.weekday, { color: colors.textSecondary }]}>{weekday}</Text>)}
            {Array.from({ length: firstWeekday }, (_, index) => <View key={`blank-${index}`} style={styles.cell} />)}
            {Array.from({ length: monthDays }, (_, index) => {
              const value = `${month}-${String(index + 1).padStart(2, '0')}`;
              const has = activeDaySet.has(value);
              return (
                <View key={value} style={styles.cell}>
                  <ActionButton label={`${index + 1}${has ? '•' : ''}`} pressed={value === day}
                    accessibilityLabel={`${longDay(value, locale)}${has ? t('diary.calendar.day.activity', locale) : ''}`} onPress={() => { void go(value); }} style={styles.dayButton} />
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      )}
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: 2 },
  heading: { fontSize: 22, fontWeight: '900' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12, borderBottomWidth: 1 },
  content: { padding: 16, gap: 16 },
  contentWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: 8 },
  mainColumn: { flex: 1, gap: 8, minWidth: 0 },
  sideColumn: { width: 300, flexShrink: 0, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  editorLabel: { fontSize: 13, fontWeight: '700' },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  warning: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  day: { fontSize: 20, fontWeight: '900' },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  hint: { fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  item: { borderWidth: 2, padding: 10, gap: 6 },
  title: { fontSize: 16, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 2 },
  weekday: { textAlign: 'center', fontFamily: mono, fontSize: 11, fontWeight: '800' },
  dayButton: { minWidth: 0, paddingHorizontal: 0 },
});
