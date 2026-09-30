import type { Relation, RelationArrow } from '@noutynotes/domain';
import { useLocale } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton, TextField } from '../../components/controls';
import { Dialog } from '../../components/Dialog';
import { t } from '../../i18n';

interface RelationMenuProps {
  readonly relation: Relation;
  readonly fromTitle: string;
  readonly toTitle: string;
  readonly typeLabel: string;
  readonly compact: boolean;
  readonly onArrow: (arrow: RelationArrow) => void;
  readonly onSave: (typeLabel: string, label: string) => void;
  readonly onDisconnect: () => void;
  readonly onClose: () => void;
}

const arrowKeys: readonly { readonly value: RelationArrow; readonly labelKey: 'inspector.relation.arrow.none' | 'inspector.relation.arrow.forward' | 'inspector.relation.arrow.both' }[] = [
  { value: 'none', labelKey: 'inspector.relation.arrow.none' },
  { value: 'forward', labelKey: 'inspector.relation.arrow.forward' },
  { value: 'both', labelKey: 'inspector.relation.arrow.both' },
];

/**
 * Menú compacto de la línea seleccionada (auditoría de interacción, 2026-09-29): flechas, tipo, rótulo
 * y desconectar, sin abrir el inspector completo de ninguna de las dos tarjetas. Mismas acciones que ya
 * ofrecía `CardInspector`, reunidas aquí para llegar a ellas con un toque en la línea del lienzo.
 */
export function RelationMenu({ relation, fromTitle, toTitle, typeLabel, compact, onArrow, onSave, onDisconnect, onClose }: RelationMenuProps) {
  const { locale } = useLocale();
  const [typeLabelDraft, setTypeLabelDraft] = useState(typeLabel);
  const [labelDraft, setLabelDraft] = useState(relation.label ?? '');
  const arrow = relation.arrow ?? 'forward';
  return (
    <Dialog visible title={t('inspector.relation.menu.title', locale, { from: fromTitle, to: toTitle })} compact={compact} onClose={onClose} testID="relation-menu">
      <View style={styles.section}>
        <View style={styles.row}>
          {arrowKeys.map((option) => (
            <ActionButton
              key={option.value}
              label={t(option.labelKey, locale)}
              accessibilityLabel={t('inspector.relation.arrow.use.accessibilityLabel', locale, { label: t(option.labelKey, locale).toLowerCase() })}
              pressed={arrow === option.value}
              onPress={() => onArrow(option.value)}
            />
          ))}
        </View>
        <TextField label={t('inspector.relation.type.label', locale)} value={typeLabelDraft} onChangeText={setTypeLabelDraft} />
        <TextField label={t('inspector.relation.label.label', locale)} value={labelDraft} onChangeText={setLabelDraft} placeholder={t('inspector.relation.label.placeholder', locale)} />
        <View style={styles.row}>
          <ActionButton label={t('inspector.relation.save', locale)} tone="primary" accessibilityLabel={t('inspector.relation.save.accessibilityLabel', locale)} onPress={() => onSave(typeLabelDraft, labelDraft)} />
          <ActionButton
            label={t('inspector.relation.disconnect', locale)}
            accessibilityLabel={t('inspector.relation.menu.disconnect.accessibilityLabel', locale, { from: fromTitle, to: toTitle })}
            onPress={onDisconnect}
          />
        </View>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
