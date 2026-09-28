import { fold } from '@noutynotes/application';
import type { ArchivedCard, CardId, CardTypeId, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { markdownExcerpt } from './markdownLists';
import { useEscapeBack } from './useEscapeBack';

interface ArchiveViewProps {
  readonly active: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly onRestore: (cardId: CardId) => void;
  readonly onSendToTrash: (cardId: CardId) => void;
  readonly onBack: () => void;
}

type Order = 'recent' | 'title';
const titleOf = (entry: ArchivedCard) => entry.card.title ?? 'Sin título';
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
export function ArchiveView({ active, compact, workspace, busy, onRestore, onSendToTrash, onBack }: ArchiveViewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  useEscapeBack(active, onBack);
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<CardTypeId | null>(null);
  const [order, setOrder] = useState<Order>('recent');
  const archive = workspace.archive ?? [];
  const typeLabel = (id: CardTypeId) => workspace.cardTypes.find((type) => type.id === id)?.label ?? 'Tarjeta';
  const types = [...new Set(archive.map((entry) => entry.card.typeId))].map((id) => ({ id, count: archive.filter((entry) => entry.card.typeId === id).length }));
  const text = fold(query.trim());
  const shown = archive
    .filter((entry) => typeId === null || entry.card.typeId === typeId)
    .filter((entry) => text === '' || fold([titleOf(entry), entry.card.content ?? '', (entry.card.tags ?? []).join(' ')].join('\n')).includes(text))
    .sort((a, b) => (order === 'recent' ? (a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : 0)
      : fold(titleOf(a)) < fold(titleOf(b)) ? -1 : fold(titleOf(a)) > fold(titleOf(b)) ? 1 : 0));
  const boardTitles = (entry: ArchivedCard) => entry.boards
    .map((membership) => workspace.boards.find((board) => board.id === membership.boardId)?.title ?? 'un tablero que ya no existe');

  return (
    <View testID="archive-view" style={styles.screen}>
      <View style={[styles.header, { borderColor: colors.gridLine }]}>
        <ActionButton label="←" accessibilityLabel="Volver al tablero" onPress={onBack} />
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Archivo</Text>
      </View>
      {archive.length === 0 ? (
        <View style={styles.pad}>
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            Lo archivado sale de los tableros y de las búsquedas sin destruirse, y se guarda con el espacio (también en la carpeta y en el ZIP).
            Restaurar lo devuelve a su sitio. Para eliminarlo, envíalo a la Papelera.
          </Text>
          <Text testID="archive-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>No hay nada archivado.</Text>
        </View>
      ) : (
        <>
          {/* Barra contextual: propia de esta vista, no la del lienzo (ADR 0036). */}
          <View style={[styles.toolbar, { borderColor: colors.gridLine }]}>
            <ActionButton label={`Todos · ${archive.length}`} pressed={typeId === null} accessibilityLabel={`Todos los tipos (${archive.length})`} onPress={() => setTypeId(null)} />
            {types.map(({ id, count }) => (
              <ActionButton key={id} label={`${typeLabel(id)} · ${count}`} pressed={typeId === id} accessibilityLabel={`Solo ${typeLabel(id)} (${count})`} onPress={() => setTypeId(id)} />
            ))}
            <ActionButton label="Más recientes" pressed={order === 'recent'} accessibilityLabel="Ordenar por fecha de archivo" onPress={() => setOrder('recent')} />
            <ActionButton label="Por título" pressed={order === 'title'} accessibilityLabel="Ordenar por título" onPress={() => setOrder('title')} />
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <TextField label="Buscar en el Archivo" value={query} onChangeText={setQuery} placeholder="título, texto o etiqueta" testID="archive-search" />
            <Text testID="archive-count" accessibilityLiveRegion="polite" style={[styles.count, { color: colors.textSecondary }]}>
              {shown.length === 1 ? '1 TARJETA' : `${shown.length} TARJETAS`}
            </Text>
            {shown.length === 0 ? <Text style={[styles.intro, { color: colors.textSecondary }]}>{`Sin resultados para «${query.trim()}».`}</Text> : null}
            {/* Desde 800 px, tarjetas en columnas en vez de una sola fila muy ancha (ADR 0036). */}
            <View style={compact ? styles.list : styles.grid}>
              {shown.map((entry) => {
                const title = titleOf(entry);
                const excerpt = markdownExcerpt(entry.card.content ?? '').replace(/\s+/g, ' ').trim();
                const origin = boardTitles(entry);
                return (
                  <View key={entry.card.id} testID={`archive-item-${entry.card.id}`} style={[styles.item, compact ? null : styles.itemCol, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text style={[styles.kind, { color: colors.textSecondary }]}>{`${typeLabel(entry.card.typeId).toUpperCase()} · ARCHIVADA ${when(entry.archivedAt)}`}</Text>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{origin.length > 0 ? `Estaba en ${origin.join(', ')}` : 'No estaba en ningún tablero'}</Text>
                    {(entry.card.tags ?? []).length > 0 ? <Text style={[styles.meta, { color: colors.selection }]}>{(entry.card.tags ?? []).map((tag) => `#${tag}`).join('  ')}</Text> : null}
                    {excerpt !== '' ? <Text numberOfLines={2} style={[styles.excerpt, { color: colors.textPrimary }]}>{excerpt}</Text> : null}
                    {confirming === entry.card.id ? (
                      <View testID="archive-trash-confirmation" style={[styles.confirm, { borderColor: colors.danger }]}>
                        <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                          {`¿Enviar «${title}» a la Papelera? Desde allí aún podrás restaurarla o eliminarla definitivamente.`}
                        </Text>
                        <View style={styles.actions}>
                          <ActionButton label="Enviar a la Papelera" tone="primary" accessibilityLabel={`Confirmar enviar ${title} a la Papelera`}
                            onPress={() => { setConfirming(null); onSendToTrash(entry.card.id); }} />
                          <ActionButton label="Cancelar" accessibilityLabel="Cancelar el envío a la Papelera" onPress={() => setConfirming(null)} />
                        </View>
                      </View>
                    ) : (
                      <View style={styles.actions}>
                        <ActionButton label="Restaurar" tone="primary" accessibilityLabel={`Restaurar ${title} del Archivo`} onPress={() => { if (!busy) onRestore(entry.card.id); }} />
                        <ActionButton label="Enviar a la Papelera…" accessibilityLabel={`Enviar ${title} a la Papelera desde el Archivo`} onPress={() => setConfirming(entry.card.id)} />
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
