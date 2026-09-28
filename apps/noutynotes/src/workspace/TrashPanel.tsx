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
  readonly onClose: () => void;
}

/**
 * Papelera de tarjetas (ADR 0015). Restaurar no pide confirmación; eliminar definitivamente sí, con
 * el nombre de la tarjeta y lo que pasará con su imagen.
 */
export function TrashPanel({ visible, compact, workspace, busy, onRestore, onPurge, onClose }: TrashPanelProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const trash = [...(workspace.trash ?? [])].reverse();
  const titleOf = (entry: TrashedCard) => entry.card.title ?? t('trash.item.untitled', locale);
  const typeLabel = (entry: TrashedCard) => workspace.cardTypes.find((type) => type.id === entry.card.typeId)?.label ?? t('trash.item.type.fallback', locale);
  const close = () => { setConfirming(null); onClose(); };

  return (
    <Dialog visible={visible} title={t('trash.title', locale)} compact={compact} onClose={close} testID="trash-panel">
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        {t('trash.intro', locale)}
      </Text>
      {trash.length === 0 ? (
        <Text testID="trash-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>{t('trash.empty', locale)}</Text>
      ) : trash.map((entry) => {
        const title = titleOf(entry);
        const hasImage = (entry.card.assetRefs?.length ?? 0) > 0;
        return (
          <View key={entry.card.id} testID={`trash-item-${entry.card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.kind, { color: colors.textSecondary }]}>{typeLabel(entry).toUpperCase()}{hasImage ? t('trash.item.image', locale) : ''}</Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
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
