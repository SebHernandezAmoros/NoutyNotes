import { activeDays, dailyLog, editCardContent, isDay, localDay, openDiaryEntry, shiftDay } from '@noutynotes/application';
import type { TimedCard, WorkspaceStorageResult } from '@noutynotes/application';
import type { Card, CardId, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { markdownExcerpt } from './markdownLists';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface DailyLogPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  readonly onGo: (cardId: CardId) => void;
  readonly onClose: () => void;
}

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const offset = () => new Date().getTimezoneOffset();
const today = () => localDay(new Date().toISOString(), offset());
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
const longDay = (day: string) => `${Number(day.slice(8, 10))} de ${months[Number(day.slice(5, 7)) - 1]} de ${day.slice(0, 4)}`;

/**
 * Diario (ADR 0024): entradas del día y cronología con fechas reales (tarjetas creadas desde esta versión
 * y archivadas). Nada se simula: un día sin datos lo dice.
 */
export function DailyLogPanel({ visible, compact, workspace, run, onGo, onClose }: DailyLogPanelProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [day, setDay] = useState(today);
  const [dayDraft, setDayDraft] = useState(day);
  const [editing, setEditing] = useState<{ id: CardId; title: string; content: string } | null>(null);
  const log = dailyLog(workspace, day, offset());
  const typeLabel = (card: Card) => workspace.cardTypes.find((type) => type.id === card.typeId)?.label ?? 'Tarjeta';
  const onBoard = (cardId: CardId) => workspace.boards.some((board) => board.cardIds.includes(cardId));
  const isToday = day === today();
  const month = day.slice(0, 7);
  const active = activeDays(workspace, month, offset());
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
      {testID === 'log-created' && onBoard(card.id) ? <ActionButton label="Ir" accessibilityLabel={`Ir a ${card.title ?? 'Sin título'}`} onPress={() => { onClose(); onGo(card.id); }} /> : null}
    </View>
  ));

  return (
    <Dialog visible={visible} title="Diario" compact={compact} onClose={onClose} testID="daily-log-panel">
      <View style={styles.row}>
        <ActionButton label="←" accessibilityLabel="Día anterior" onPress={() => go(shiftDay(day, -1))} />
        <ActionButton label="Hoy" pressed={isToday} accessibilityLabel="Ir a hoy" onPress={() => go(today())} />
        <ActionButton label="→" accessibilityLabel="Día siguiente" onPress={() => go(shiftDay(day, 1))} />
      </View>
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

      <View style={styles.row}>
        <ActionButton label={isToday ? 'Escribir la nota de hoy' : 'Escribir en este día'} tone="primary"
          accessibilityLabel={isToday ? 'Escribir la nota de hoy' : `Escribir en el diario del ${longDay(day)}`} onPress={() => void write(true)} />
        {log.entries.length > 0 ? <ActionButton label="Nueva entrada" accessibilityLabel="Nueva entrada del diario" onPress={() => void write(false)} /> : null}
      </View>

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

      <Text style={[styles.section, { color: colors.textSecondary }]}>{`${months[Number(month.slice(5, 7)) - 1]?.toUpperCase()} ${month.slice(0, 4)}`}</Text>
      <View style={styles.calendar} accessibilityLabel="Calendario del mes">
        {weekdays.map((weekday) => <Text key={weekday} style={[styles.cell, styles.weekday, { color: colors.textSecondary }]}>{weekday}</Text>)}
        {Array.from({ length: firstWeekday }, (_, index) => <View key={`blank-${index}`} style={styles.cell} />)}
        {Array.from({ length: monthDays }, (_, index) => {
          const value = `${month}-${String(index + 1).padStart(2, '0')}`;
          const has = active.has(value);
          return (
            <View key={value} style={styles.cell}>
              <ActionButton label={`${index + 1}${has ? '•' : ''}`} pressed={value === day}
                accessibilityLabel={`${longDay(value)}${has ? ', con actividad' : ''}`} onPress={() => go(value)} style={styles.dayButton} />
            </View>
          );
        })}
      </View>
    </Dialog>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
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
