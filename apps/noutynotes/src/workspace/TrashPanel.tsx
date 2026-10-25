import { cardTitleText } from '@noutynotes/domain';
import type { CardId, TrashedCard, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

interface TrashPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly onRestore: (cardId: CardId) => void;
  readonly onPurge: (cardId: CardId) => void;
  /** Selección múltiple (P6, bloque 6): una sola escritura; `true` si se guardó, para limpiar la selección. */
  readonly onRestoreSelection: (cardIds: readonly CardId[]) => Promise<boolean>;
  readonly onClose: () => void;
}

/**
 * Papelera de tarjetas (ADR 0015). Restaurar no pide confirmación (ni sola ni en grupo); eliminar
 * definitivamente sí, con el nombre de la tarjeta y lo que pasará con su imagen. Vaciar la Papelera o
 * eliminar definitivamente en grupo no existen todavía (OBS-N2-01, bloqueado: ver progress.md).
 */
export function TrashPanel({ visible, compact, workspace, busy, onRestore, onPurge, onRestoreSelection, onClose }: TrashPanelProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<CardId>>(new Set());
  const trash = [...(workspace.trash ?? [])].reverse();
  // Protege contra selección obsoleta si el Workspace cambió por otra vía mientras el diálogo seguía abierto.
  const activeSelected = [...selected].filter((cardId) => trash.some((entry) => entry.card.id === cardId));
  const countUnit = (count: number) => t(count === 1 ? 'trash.selected.one' : 'trash.selected.many', locale, { count: String(count) });
  const titleOf = (entry: TrashedCard) => cardTitleText(entry.card) || t('trash.item.untitled', locale);
  const typeLabel = (entry: TrashedCard) => workspace.cardTypes.find((type) => type.id === entry.card.typeId)?.label ?? t('trash.item.type.fallback', locale);
  const toggleSelected = (cardId: CardId) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
    return next;
  });
  const selectAll = () => setSelected(new Set(trash.map((entry) => entry.card.id)));
  const restoreSelection = async () => {
    if (await onRestoreSelection(activeSelected)) setSelected(new Set());
  };
  const close = () => { setConfirming(null); setSelected(new Set()); onClose(); };

  return (
    <Dialog visible={visible} title={t('trash.title', locale)} compact={compact} onClose={close} testID="trash-panel">
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        {t('trash.intro', locale)}
      </Text>
      {trash.length === 0 ? (
        <Text testID="trash-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('trash.empty', locale)}</Text>
      ) : (
        <>
          <View style={styles.actions}>
            <ActionButton label={t('trash.selectAll', locale)} accessibilityLabel={t('trash.selectAll.accessibilityLabel', locale)} onPress={selectAll} />
          </View>
          {activeSelected.length > 0 ? (
            <View testID="trash-selection-bar" style={[styles.item, { borderColor: colors.selection, backgroundColor: colors.surface }]}>
              <Text style={[styles.kind, { color: colors.textSecondary }]}>{countUnit(activeSelected.length)}</Text>
              <View style={styles.actions}>
                <ActionButton label={t('trash.selection.restore', locale)} tone="primary" accessibilityLabel={t('trash.selection.restore.accessibilityLabel', locale)}
                  onPress={() => { if (!busy) void restoreSelection(); }} />
                <ActionButton label={t('trash.selection.cancel', locale)} accessibilityLabel={t('trash.selection.cancel.accessibilityLabel', locale)} onPress={() => setSelected(new Set())} />
              </View>
            </View>
          ) : null}
        </>
      )}
      {trash.map((entry) => {
        const title = titleOf(entry);
        const hasImage = (entry.card.assetRefs?.length ?? 0) > 0;
        const isSelected = selected.has(entry.card.id);
        return (
          <View key={entry.card.id} testID={`trash-item-${entry.card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.kind, { color: colors.textSecondary }]}>{typeLabel(entry).toUpperCase()}{hasImage ? t('trash.item.image', locale) : ''}</Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {entry.card.primaryResourceState ? <Text style={[styles.kind, { color: colors.textPrimary }]}>{t('card.resourceRetired', locale)}</Text> : null}
            {confirming === entry.card.id ? (
              <View testID="purge-confirmation" style={[styles.confirm, { borderColor: colors.danger }]}>
                <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                  {t('trash.purge.confirm', locale, { title, imageNote: hasImage ? t('trash.purge.confirm.imageNote', locale) : '' })}
                </Text>
                <View style={styles.actions}>
                  <ActionButton
                    label={t('trash.purge.confirm.label', locale)}
                    accessibilityLabel={t('trash.purge.confirm.accessibilityLabel', locale, { title })}
                    onPress={() => { setConfirming(null); onPurge(entry.card.id); }}
                  />
                  <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('trash.cancel.accessibilityLabel', locale)} onPress={() => setConfirming(null)} />
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <ActionButton label={t('trash.restore', locale)} accessibilityLabel={t('trash.restore.accessibilityLabel', locale, { title })} tone="primary" onPress={() => { if (!busy) onRestore(entry.card.id); }} />
                <ActionButton label={t('trash.purge', locale)} accessibilityLabel={t('trash.purge.accessibilityLabel', locale, { title })} onPress={() => setConfirming(entry.card.id)} />
                <ActionButton label={isSelected ? t('trash.item.selected', locale) : t('trash.item.select', locale)} pressed={isSelected}
                  accessibilityLabel={t(isSelected ? 'trash.item.select.remove.accessibilityLabel' : 'trash.item.select.add.accessibilityLabel', locale, { title })}
                  onPress={() => toggleSelected(entry.card.id)} />
              </View>
            )}
          </View>
        );
      })}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 15, borderWidth: 2, borderStyle: 'dashed', padding: 16 },
  item: { borderWidth: 2, padding: 12, gap: 6 },
  kind: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  title: { fontSize: 17, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  warning: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
