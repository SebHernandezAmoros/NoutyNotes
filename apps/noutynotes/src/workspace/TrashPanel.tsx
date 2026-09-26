import type { CardId, TrashedCard, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface TrashPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly onRestore: (cardId: CardId) => void;
  readonly onPurge: (cardId: CardId) => void;
  readonly onClose: () => void;
}

const titleOf = (entry: TrashedCard) => entry.card.title ?? 'Sin título';

/**
 * Papelera de tarjetas (ADR 0015). Restaurar no pide confirmación; eliminar definitivamente sí, con
 * el nombre de la tarjeta y lo que pasará con su imagen.
 */
export function TrashPanel({ visible, compact, workspace, busy, onRestore, onPurge, onClose }: TrashPanelProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const trash = [...(workspace.trash ?? [])].reverse();
  const typeLabel = (entry: TrashedCard) => workspace.cardTypes.find((type) => type.id === entry.card.typeId)?.label ?? 'Tarjeta';
  const close = () => { setConfirming(null); onClose(); };

  return (
    <Dialog visible={visible} title="Papelera" compact={compact} onClose={close} testID="trash-panel">
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Las tarjetas de la Papelera se guardan con el espacio (también en la carpeta y en el ZIP) y se pueden restaurar con su contenido,
        imagen, conexiones y posición.
      </Text>
      {trash.length === 0 ? (
        <Text testID="trash-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>La Papelera está vacía.</Text>
      ) : trash.map((entry) => {
        const title = titleOf(entry);
        const hasImage = (entry.card.assetRefs?.length ?? 0) > 0;
        return (
          <View key={entry.card.id} testID={`trash-item-${entry.card.id}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.kind, { color: colors.textSecondary }]}>{typeLabel(entry).toUpperCase()}{hasImage ? ' · CON IMAGEN' : ''}</Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {confirming === entry.card.id ? (
              <View testID="purge-confirmation" style={[styles.confirm, { borderColor: colors.danger }]}>
                <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                  {`¿Eliminar definitivamente «${title}»? No se puede deshacer.${hasImage ? ' Su imagen se borrará del espacio si ninguna otra tarjeta la usa.' : ''}`}
                </Text>
                <View style={styles.actions}>
                  <ActionButton
                    label="Eliminar definitivamente"
                    accessibilityLabel={`Confirmar eliminar definitivamente ${title}`}
                    onPress={() => { setConfirming(null); onPurge(entry.card.id); }}
                  />
                  <ActionButton label="Cancelar" accessibilityLabel="Cancelar la eliminación" onPress={() => setConfirming(null)} />
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <ActionButton label="Restaurar" accessibilityLabel={`Restaurar ${title}`} tone="primary" onPress={() => { if (!busy) onRestore(entry.card.id); }} />
                <ActionButton label="Eliminar definitivamente…" accessibilityLabel={`Eliminar definitivamente ${title}`} onPress={() => setConfirming(entry.card.id)} />
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
