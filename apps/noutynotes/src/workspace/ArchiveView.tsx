import { fold } from '@noutynotes/application';
import type { ArchivedBoard, ArchivedCard, BoardId, CardId, CardTypeId, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';
import { markdownExcerpt } from './markdownLists';
import { useEscapeBack } from './useEscapeBack';

interface ArchiveViewProps {
  readonly active: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly onRestore: (cardId: CardId) => void;
  readonly onSendToTrash: (cardId: CardId) => void;
  /** Selección múltiple (ADR 0039): una sola escritura; `true` si se guardó, para limpiar la selección. */
  readonly onRestoreSelection: (cardIds: readonly CardId[]) => Promise<boolean>;
  readonly onSendSelectionToTrash: (cardIds: readonly CardId[]) => Promise<boolean>;
  /** ZIP nuevo con solo la selección y sus assets, no el del workspace (ADR 0039). */
  readonly onExportSelection: (cardIds: readonly CardId[]) => void;
  readonly onRestoreBoard: (boardId: BoardId, title: string) => void;
  readonly onBack: () => void;
}

type Order = 'recent' | 'title';
const pad = (value: number) => String(value).padStart(2, '0');
/** Fecha local legible sin depender de Intl (igual en web y en Android). */
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Archivo (ADR 0023, ADR 0036): vista de trabajo real a pantalla completa, no un diálogo estrecho.
 * Tarjetas apartadas sin destruir. Restaurar las devuelve a su sitio; «Enviar a la Papelera» (con
 * confirmación) es la única forma de eliminarlas, y solo la Papelera borra.
 */
export function ArchiveView({
  active, compact, workspace, busy, onRestore, onSendToTrash, onRestoreSelection, onSendSelectionToTrash, onExportSelection, onRestoreBoard, onBack,
}: ArchiveViewProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  useEscapeBack(active, onBack);
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<CardTypeId | null>(null);
  const [order, setOrder] = useState<Order>('recent');
  const [selected, setSelected] = useState<ReadonlySet<CardId>>(new Set());
  const [confirmingSelection, setConfirmingSelection] = useState(false);
  const archivedBoards = workspace.archivedBoards ?? [];
  const archive = workspace.archive ?? [];
  const titleOf = (entry: ArchivedCard) => entry.card.title ?? t('trash.item.untitled', locale);
  const cardsUnit = (count: number) => t(count === 1 ? 'unit.card.one' : 'unit.card.many', locale, { count: String(count) });
  const countUnit = (base: 'archive.count' | 'archive.selected', count: number) => t(count === 1 ? `${base}.one` : `${base}.many`, locale, { count: String(count) });
  const toggleSelected = (cardId: CardId) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
    return next;
  });
  const restoreSelection = async () => {
    if (await onRestoreSelection([...selected])) setSelected(new Set());
  };
  const trashSelection = async () => {
    setConfirmingSelection(false);
    if (await onSendSelectionToTrash([...selected])) setSelected(new Set());
  };
  const typeLabel = (id: CardTypeId) => workspace.cardTypes.find((type) => type.id === id)?.label ?? t('trash.item.type.fallback', locale);
  const types = [...new Set(archive.map((entry) => entry.card.typeId))].map((id) => ({ id, count: archive.filter((entry) => entry.card.typeId === id).length }));
  const text = fold(query.trim());
  const shown = archive
    .filter((entry) => typeId === null || entry.card.typeId === typeId)
    .filter((entry) => text === '' || fold([titleOf(entry), entry.card.content ?? '', (entry.card.tags ?? []).join(' ')].join('\n')).includes(text))
    .sort((a, b) => (order === 'recent' ? (a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : 0)
      : fold(titleOf(a)) < fold(titleOf(b)) ? -1 : fold(titleOf(a)) > fold(titleOf(b)) ? 1 : 0));
  const boardTitles = (entry: ArchivedCard) => entry.boards
    .map((membership) => workspace.boards.find((board) => board.id === membership.boardId)?.title ?? t('archive.board.deleted', locale));

  return (
    <View testID="archive-view" style={styles.screen}>
      <View style={[styles.header, { borderColor: colors.gridLine }]}>
        <ActionButton label="←" accessibilityLabel={t('workview.back', locale)} onPress={onBack} />
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t('nav.archive', locale)}</Text>
      </View>
      {archive.length === 0 && archivedBoards.length === 0 ? (
        <View style={styles.pad}>
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            {t('archive.intro', locale)}
          </Text>
          <Text testID="archive-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('archive.empty', locale)}</Text>
        </View>
      ) : (
        <>
          {/* Barra contextual: propia de esta vista, no la del lienzo (ADR 0036). */}
          <View style={[styles.toolbar, { borderColor: colors.gridLine }]}>
            <ActionButton label={t('archive.filter.all', locale, { count: String(archive.length) })} pressed={typeId === null} accessibilityLabel={t('archive.filter.all.accessibilityLabel', locale, { count: String(archive.length) })} onPress={() => setTypeId(null)} />
            {types.map(({ id, count }) => (
              <ActionButton key={id} label={`${typeLabel(id)} · ${count}`} pressed={typeId === id} accessibilityLabel={t('archive.filter.type.accessibilityLabel', locale, { label: typeLabel(id), count: String(count) })} onPress={() => setTypeId(id)} />
            ))}
            <ActionButton label={t('archive.order.recent', locale)} pressed={order === 'recent'} accessibilityLabel={t('archive.order.recent.accessibilityLabel', locale)} onPress={() => setOrder('recent')} />
            <ActionButton label={t('archive.order.title', locale)} pressed={order === 'title'} accessibilityLabel={t('archive.order.title.accessibilityLabel', locale)} onPress={() => setOrder('title')} />
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {archivedBoards.length > 0 ? (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>{t('archive.section.boards', locale)}</Text>
                <View style={compact ? styles.list : styles.grid}>
                  {archivedBoards.map((entry: ArchivedBoard) => (
                    <View key={entry.board.id} testID={`archive-board-${entry.board.id}`} style={[styles.item, compact ? null : styles.itemCol, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <Text style={[styles.kind, { color: colors.textSecondary }]}>{t('archive.board.kind', locale, { when: when(entry.archivedAt) })}</Text>
                      <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.board.title}</Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>{cardsUnit(entry.cardIds.length)}</Text>
                      <View style={styles.actions}>
                        <ActionButton label={t('archive.board.restore', locale)} tone="primary" accessibilityLabel={t('archive.board.restore.accessibilityLabel', locale, { title: entry.board.title })}
                          onPress={() => { if (!busy) onRestoreBoard(entry.board.id, entry.board.title); }} />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {archive.length > 0 ? <Text style={[styles.section, { color: colors.textSecondary }]}>{t('archive.section.cards', locale)}</Text> : null}
            <TextField label={t('archive.search.label', locale)} value={query} onChangeText={setQuery} placeholder={t('archive.search.placeholder', locale)} testID="archive-search" />
            <Text testID="archive-count" accessibilityLiveRegion="polite" style={[styles.count, { color: colors.textSecondary }]}>
              {countUnit('archive.count', shown.length)}
            </Text>
            {shown.length === 0 ? <Text style={[styles.intro, { color: colors.textSecondary }]}>{t('search.empty.query', locale, { query: query.trim() })}</Text> : null}
            {selected.size > 0 ? (
              <View testID="archive-selection-bar" style={[styles.item, { borderColor: colors.selection, backgroundColor: colors.surface }]}>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{countUnit('archive.selected', selected.size)}</Text>
                {confirmingSelection ? (
                  <View testID="archive-selection-confirm" style={[styles.confirm, { borderColor: colors.danger }]}>
                    <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                      {t(selected.size === 1 ? 'archive.trashSelection.confirm.one' : 'archive.trashSelection.confirm.many', locale, { count: String(selected.size) })}
                    </Text>
                    <View style={styles.actions}>
                      <ActionButton label={t('archive.trash.label', locale)} tone="primary" accessibilityLabel={t('archive.trash.selection.accessibilityLabel', locale)} onPress={() => void trashSelection()} />
                      <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('archive.trash.selection.cancel.accessibilityLabel', locale)} onPress={() => setConfirmingSelection(false)} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <ActionButton label={t('archive.selection.restore', locale)} tone="primary" accessibilityLabel={t('archive.selection.restore.accessibilityLabel', locale)} onPress={() => void restoreSelection()} />
                    <ActionButton label={t('archive.selection.trash', locale)} accessibilityLabel={t('archive.selection.trash.accessibilityLabel', locale)} onPress={() => setConfirmingSelection(true)} />
                    <ActionButton label={t('archive.selection.export', locale)} accessibilityLabel={t('archive.selection.export.accessibilityLabel', locale)} onPress={() => onExportSelection([...selected])} />
                    <ActionButton label={t('archive.selection.cancel', locale)} accessibilityLabel={t('archive.selection.cancel.accessibilityLabel', locale)} onPress={() => setSelected(new Set())} />
                  </View>
                )}
              </View>
            ) : null}
            {/* Desde 800 px, tarjetas en columnas en vez de una sola fila muy ancha (ADR 0036). */}
            <View style={compact ? styles.list : styles.grid}>
              {shown.map((entry) => {
                const title = titleOf(entry);
                const excerpt = markdownExcerpt(entry.card.content ?? '').replace(/\s+/g, ' ').trim();
                const origin = boardTitles(entry);
                return (
                  <View key={entry.card.id} testID={`archive-item-${entry.card.id}`} style={[styles.item, compact ? null : styles.itemCol, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text style={[styles.kind, { color: colors.textSecondary }]}>{t('archive.item.kind', locale, { type: typeLabel(entry.card.typeId).toUpperCase(), when: when(entry.archivedAt) })}</Text>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{origin.length > 0 ? t('archive.item.origin.some', locale, { boards: origin.join(', ') }) : t('archive.item.origin.none', locale)}</Text>
                    {(entry.card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(entry.card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
                    {excerpt !== '' ? <Text numberOfLines={2} style={[styles.excerpt, { color: colors.textPrimary }]}>{excerpt}</Text> : null}
                    {confirming === entry.card.id ? (
                      <View testID="archive-trash-confirmation" style={[styles.confirm, { borderColor: colors.danger }]}>
                        <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                          {t('archive.item.trashConfirm.body', locale, { title })}
                        </Text>
                        <View style={styles.actions}>
                          <ActionButton label={t('archive.trash.label', locale)} tone="primary" accessibilityLabel={t('archive.item.trashConfirm.accessibilityLabel', locale, { title })}
                            onPress={() => { setConfirming(null); onSendToTrash(entry.card.id); }} />
                          <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('archive.item.trashCancel.accessibilityLabel', locale)} onPress={() => setConfirming(null)} />
                        </View>
                      </View>
                    ) : (
                      <View style={styles.actions}>
                        <ActionButton label={t('trash.restore', locale)} tone="primary" accessibilityLabel={t('archive.item.restore.accessibilityLabel', locale, { title })} onPress={() => { if (!busy) onRestore(entry.card.id); }} />
                        <ActionButton label={t('archive.item.trash', locale)} accessibilityLabel={t('archive.item.trash.accessibilityLabel', locale, { title })} onPress={() => setConfirming(entry.card.id)} />
                        <ActionButton label={selected.has(entry.card.id) ? t('archive.item.selected', locale) : t('archive.item.select', locale)} pressed={selected.has(entry.card.id)}
                          accessibilityLabel={t(selected.has(entry.card.id) ? 'archive.item.select.remove.accessibilityLabel' : 'archive.item.select.add.accessibilityLabel', locale, { title })} onPress={() => toggleSelected(entry.card.id)} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </>
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
  content: { padding: 16, gap: 12 },
  pad: { padding: 16, gap: 12 },
  intro: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 15, borderWidth: 2, borderStyle: 'dashed', padding: 16 },
  count: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
  list: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { borderWidth: 2, padding: 12, gap: 6 },
  itemCol: { width: 320, flexGrow: 1 },
  kind: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  title: { fontSize: 17, fontWeight: '800' },
  meta: { fontSize: 13, lineHeight: 18 },
  excerpt: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  warning: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
