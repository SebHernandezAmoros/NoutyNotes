import { activeDays, dailyLog, dailyLogRange, diaryExportText, editCardContent, fold, isDay, localDay, openDiaryEntry, shiftDay } from '@noutynotes/application';
import type { RangeLogItem, TimedCard, WorkspaceStorageResult } from '@noutynotes/application';
import type { BoardId, Card, CardId, CardTypeId, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { downloadTextFile, supportsTextDownload } from '../session/textDownload';
import { markdownExcerpt } from './markdownLists';
import { useEscapeBack } from './useEscapeBack';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface DiaryViewProps {
  readonly active: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  readonly onGo: (cardId: CardId) => void;
  readonly onBack: () => void;
}

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const offset = () => new Date().getTimezoneOffset();
const today = () => localDay(new Date().toISOString(), offset());
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
const longDay = (day: string) => `${Number(day.slice(8, 10))} de ${months[Number(day.slice(5, 7)) - 1]} de ${day.slice(0, 4)}`;

/**
 * Diario (ADR 0024, ADR 0036): vista de trabajo real a pantalla completa, no un diálogo estrecho.
 * Entradas del día y cronología con fechas reales (tarjetas creadas desde esta versión y archivadas).
 * Nada se simula: un día sin datos lo dice.
 */
export function DiaryView({ active, compact, workspace, run, onGo, onBack }: DiaryViewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  useEscapeBack(active, onBack);
  const [day, setDay] = useState(today);
  const [dayDraft, setDayDraft] = useState(day);
  const [editing, setEditing] = useState<{ id: CardId; title: string; content: string } | null>(null);
  const [mode, setMode] = useState<'day' | 'search'>('day');
  const [rangeFrom, setRangeFrom] = useState(today);
  const [rangeTo, setRangeTo] = useState(today);
  const [searchTypeId, setSearchTypeId] = useState<CardTypeId | null>(null);
  const [searchTag, setSearchTag] = useState<string | null>(null);
  const [searchBoardId, setSearchBoardId] = useState<BoardId | null>(null);
  const [searchText, setSearchText] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const log = dailyLog(workspace, day, offset());
  const typeLabel = (card: Card) => workspace.cardTypes.find((type) => type.id === card.typeId)?.label ?? 'Tarjeta';
  const onBoard = (cardId: CardId) => workspace.boards.some((board) => board.cardIds.includes(cardId));

  // Modo «Buscar» (ADR 0037): filtro y búsqueda del rango, en la vista, como ya hacen Assets/Archivo.
  const rangeValid = isDay(rangeFrom) && isDay(rangeTo) && rangeFrom <= rangeTo;
  const range = rangeValid ? dailyLogRange(workspace, rangeFrom, rangeTo, offset()) : null;
  const rangeItems = range?.ok ? range.items : [];
  const rangeError = range && !range.ok ? range.reason : !rangeValid ? 'Escribe dos fechas reales, con la inicial antes o igual que la final.' : null;
  const availableTypes = [...new Map(rangeItems.map((item) => [item.card.typeId, typeLabel(item.card)])).entries()];
  const availableTags = [...new Set(rangeItems.flatMap((item) => item.card.tags ?? []))].sort();
  const searchFold = fold(searchText.trim());
  const filteredItems = rangeItems.filter((item) => (searchTypeId === null || item.card.typeId === searchTypeId)
    && (searchTag === null || (item.card.tags ?? []).includes(searchTag))
    && (searchBoardId === null || item.boardIds.includes(searchBoardId))
    && (searchFold === '' || fold([item.card.title ?? '', item.card.content ?? '', (item.card.tags ?? []).join(' ')].join('\n')).includes(searchFold)));
  const rangeVerb: Readonly<Record<RangeLogItem['kind'], string>> = { entry: 'ENTRADA', created: 'CREADA', archived: 'ARCHIVADA' };
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

  const go = (next: string) => {
    setDay(next);
    setDayDraft(next);
    setEditing(null);
  };
  const write = async (reuse: boolean) => {
    const result = await run((storage, id) => openDiaryEntry(storage, id, { day, createdAt: new Date().toISOString(), reuse }),
      reuse ? 'Entrada del diario lista. Guardado en memoria.' : 'Nueva entrada del diario. Guardado en memoria.');
    if (!result.ok) return;
    const existing = workspace.cards.find((card) => card.id === result.value);
    setEditing({ id: result.value, title: existing?.title ?? `Diario ${day}`, content: existing?.content ?? '' });
  };
  const save = () => {
    if (!editing) return;
    const { id, title, content } = editing;
    void run((storage, workspaceId) => editCardContent(storage, workspaceId, id, { title, content }), 'Entrada del diario guardada. Guardado en memoria.')
      .then((result) => { if (result.ok) setEditing(null); });
  };
  const timeline = (items: readonly TimedCard[], verb: string, testID: string) => items.map(({ card, time }) => (
    <View key={`${testID}-${card.id}`} testID={`${testID}-${card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${time} · ${verb} · ${typeLabel(card).toUpperCase()}`}</Text>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{card.title ?? 'Sin título'}</Text>
      {(card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
      {card.content ? <Text numberOfLines={2} style={[styles.body, { color: colors.textPrimary }]}>{markdownExcerpt(card.content).replace(/\s+/g, ' ').trim()}</Text> : null}
      {testID === 'log-created' && onBoard(card.id) ? <ActionButton label="Ir" accessibilityLabel={`Ir a ${card.title ?? 'Sin título'}`} onPress={() => { onBack(); onGo(card.id); }} /> : null}
    </View>
  ));

  return (
    <View testID="diary-view" style={styles.screen}>
      <View style={[styles.header, { borderColor: colors.gridLine }]}>
        <ActionButton label="←" accessibilityLabel="Volver al tablero" onPress={onBack} />
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Diario</Text>
      </View>
      {/* Barra contextual: navegación de fecha y escritura, propias de esta vista (ADR 0036). */}
      <View style={[styles.toolbar, { borderColor: colors.gridLine }]}>
        <ActionButton label="Día" pressed={mode === 'day'} accessibilityLabel="Ver un día" onPress={() => setMode('day')} />
        <ActionButton label="Buscar" pressed={mode === 'search'} accessibilityLabel="Buscar por fecha, tipo, etiqueta o tablero (ADR 0037)" onPress={() => setMode('search')} />
        {mode === 'day' ? (
          <>
            <ActionButton label="←" accessibilityLabel="Día anterior" onPress={() => go(shiftDay(day, -1))} />
            <ActionButton label="Hoy" pressed={isToday} accessibilityLabel="Ir a hoy" onPress={() => go(today())} />
            <ActionButton label="→" accessibilityLabel="Día siguiente" onPress={() => go(shiftDay(day, 1))} />
            <ActionButton label={isToday ? 'Escribir la nota de hoy' : 'Escribir en este día'} tone="primary"
              accessibilityLabel={isToday ? 'Escribir la nota de hoy' : `Escribir en el diario del ${longDay(day)}`} onPress={() => void write(true)} />
            {log.entries.length > 0 ? <ActionButton label="Nueva entrada" accessibilityLabel="Nueva entrada del diario" onPress={() => void write(false)} /> : null}
          </>
        ) : (
          supportsTextDownload() ? <ActionButton label="Exportar" accessibilityLabel="Exportar este rango como Markdown" onPress={exportRange} /> : null
        )}
      </View>
      {mode === 'search' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.row}>
            <TextField label="Desde (AAAA-MM-DD)" value={rangeFrom} onChangeText={setRangeFrom} testID="diary-search-from" placeholder="2026-09-01" />
            <TextField label="Hasta (AAAA-MM-DD)" value={rangeTo} onChangeText={setRangeTo} testID="diary-search-to" placeholder="2026-09-28" />
          </View>
          {rangeError ? <Text style={[styles.hint, { color: colors.danger }]}>{rangeError}</Text> : null}
          <TextField label="Buscar texto" value={searchText} onChangeText={setSearchText} placeholder="palabras del título o del texto" testID="diary-search-text" />
          {exportError ? <Text testID="diary-export-error" style={[styles.hint, { color: colors.danger }]}>{exportError}</Text> : null}
          {availableTypes.length > 0 ? (
            <View style={styles.row} accessibilityLabel="Filtrar por tipo">
              <ActionButton label="Todos los tipos" pressed={searchTypeId === null} accessibilityLabel="Todos los tipos" onPress={() => setSearchTypeId(null)} />
              {availableTypes.map(([id, label]) => (
                <ActionButton key={id} label={label} pressed={searchTypeId === id} accessibilityLabel={`Solo ${label}`} onPress={() => setSearchTypeId(id)} />
              ))}
            </View>
          ) : null}
          {availableTags.length > 0 ? (
            <View style={styles.row} accessibilityLabel="Filtrar por etiqueta">
              <ActionButton label="Todas las etiquetas" pressed={searchTag === null} accessibilityLabel="Todas las etiquetas" onPress={() => setSearchTag(null)} />
              {availableTags.map((tag) => (
                <ActionButton key={tag} label={`#${tag}`} pressed={searchTag === tag} accessibilityLabel={`Solo #${tag}`} onPress={() => setSearchTag(tag)} />
              ))}
            </View>
          ) : null}
          {workspace.boards.length > 1 ? (
            <View style={styles.row} accessibilityLabel="Filtrar por tablero">
              <ActionButton label="Todos los tableros" pressed={searchBoardId === null} accessibilityLabel="Todos los tableros" onPress={() => setSearchBoardId(null)} />
              {workspace.boards.map((board) => (
                <ActionButton key={board.id} label={board.title} pressed={searchBoardId === board.id} accessibilityLabel={`Solo el tablero ${board.title}`} onPress={() => setSearchBoardId(board.id)} />
              ))}
            </View>
          ) : null}
          <Text testID="diary-search-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {rangeError ? 'SIN RESULTADOS' : plural(filteredItems.length, 'RESULTADO', 'RESULTADOS')}
          </Text>
          {!rangeError && filteredItems.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Nada en este rango con esos filtros.</Text> : null}
          {filteredItems.map((item) => (
            <View key={`${item.kind}-${item.card.id}`} testID={`diary-search-result-${item.card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${item.day} ${item.time} · ${rangeVerb[item.kind]} · ${typeLabel(item.card).toUpperCase()}`}</Text>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.card.title ?? 'Sin título'}</Text>
              {(item.card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(item.card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
              {item.card.content ? <Text numberOfLines={2} style={[styles.body, { color: colors.textPrimary }]}>{markdownExcerpt(item.card.content).replace(/\s+/g, ' ').trim()}</Text> : null}
              {item.kind === 'created' && onBoard(item.card.id) ? <ActionButton label="Ir" accessibilityLabel={`Ir a ${item.card.title ?? 'Sin título'}`} onPress={() => { onBack(); onGo(item.card.id); }} /> : null}
            </View>
          ))}
        </ScrollView>
      ) : (
      <ScrollView contentContainerStyle={[styles.content, compact ? null : styles.contentWide]}>
        <View style={compact ? styles.column : styles.mainColumn}>
          <Text accessibilityRole="header" testID="log-day" style={[styles.day, { color: colors.textPrimary }]}>{`${longDay(day)}${isToday ? ' · hoy' : ''}`}</Text>
          <TextField label="Ir a la fecha (AAAA-MM-DD)" value={dayDraft} onChangeText={setDayDraft} testID="log-date-input"
            onSubmitEditing={() => { if (isDay(dayDraft.trim())) go(dayDraft.trim()); }} placeholder="2026-09-26" />
          {dayDraft.trim() !== day && !isDay(dayDraft.trim()) && dayDraft.trim().length >= 10 ? (
            <Text style={[styles.hint, { color: colors.danger }]}>Escribe una fecha real con la forma AAAA-MM-DD.</Text>
          ) : null}

          <Text testID="log-summary" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {log.summary.entries + log.summary.created + log.summary.archived === 0
              ? 'SIN ACTIVIDAD REGISTRADA'
              : [plural(log.summary.entries, 'ENTRADA', 'ENTRADAS'), plural(log.summary.created, 'TARJETA CREADA', 'TARJETAS CREADAS'), plural(log.summary.archived, 'ARCHIVADA', 'ARCHIVADAS')].join(' · ')}
          </Text>
          {log.summary.tags.length > 0 ? (
            <Text testID="log-tags" style={[styles.meta, { color: colors.selection }]}>{log.summary.tags.slice(0, 5).map(({ tag, count }) => `#${tag} ${count}`).join('   ')}</Text>
          ) : null}

          <Text style={[styles.section, { color: colors.textSecondary }]}>ENTRADAS</Text>
          {log.entries.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>No hay entradas este día.</Text> : log.entries.map((entry) => (
            <View key={entry.id} testID={`log-entry-${entry.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {editing?.id === entry.id ? (
                <>
                  <TextField label="Título de la entrada" value={editing.title} onChangeText={(title) => setEditing({ ...editing, title })} />
                  <TextField label="Texto de la entrada" value={editing.content} multiline onChangeText={(content) => setEditing({ ...editing, content })} placeholder="¿Qué pasó hoy?" />
                  <View style={styles.row}>
                    <ActionButton label="Guardar entrada" tone="primary" onPress={save} />
                    <ActionButton label="Cancelar" accessibilityLabel="Cancelar la edición de la entrada" onPress={() => setEditing(null)} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.title ?? 'Sin título'}</Text>
                  {entry.content ? <Text numberOfLines={4} style={[styles.body, { color: colors.textPrimary }]}>{markdownExcerpt(entry.content)}</Text> : <Text style={[styles.hint, { color: colors.textSecondary }]}>Vacía.</Text>}
                  <ActionButton label="Editar" accessibilityLabel={`Editar ${entry.title ?? 'la entrada'}`} onPress={() => setEditing({ id: entry.id, title: entry.title ?? '', content: entry.content ?? '' })} />
                </>
              )}
            </View>
          ))}

          <Text style={[styles.section, { color: colors.textSecondary }]}>CRONOLOGÍA</Text>
          {log.created.length + log.archived.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Nada creado ni archivado este día.</Text>
          ) : (
            <>
              {timeline(log.created, 'CREADA', 'log-created')}
              {timeline(log.archived, 'ARCHIVADA', 'log-archived')}
            </>
          )}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Solo se registran fechas reales: entradas del diario, tarjetas creadas desde esta versión y archivadas. Las tarjetas anteriores no tienen fecha y no aparecen; las casillas marcadas y las ediciones no se registran.
          </Text>
        </View>

        <View style={compact ? styles.column : styles.sideColumn}>
          <Text style={[styles.section, { color: colors.textSecondary }]}>{`${months[Number(month.slice(5, 7)) - 1]?.toUpperCase()} ${month.slice(0, 4)}`}</Text>
          <View style={styles.calendar} accessibilityLabel="Calendario del mes">
            {weekdays.map((weekday) => <Text key={weekday} style={[styles.cell, styles.weekday, { color: colors.textSecondary }]}>{weekday}</Text>)}
            {Array.from({ length: firstWeekday }, (_, index) => <View key={`blank-${index}`} style={styles.cell} />)}
            {Array.from({ length: monthDays }, (_, index) => {
              const value = `${month}-${String(index + 1).padStart(2, '0')}`;
              const has = activeDaySet.has(value);
              return (
                <View key={value} style={styles.cell}>
                  <ActionButton label={`${index + 1}${has ? '•' : ''}`} pressed={value === day}
                    accessibilityLabel={`${longDay(value)}${has ? ', con actividad' : ''}`} onPress={() => go(value)} style={styles.dayButton} />
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
