import { useLocale, useTheme } from '@noutynotes/ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { AssetImageCatalogEntry } from './useAssetImageCatalog';

interface AssetImagePickerDialogProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly entries: readonly AssetImageCatalogEntry[];
  readonly loading: boolean;
  readonly onSelect: (ref: string) => void;
  readonly onCancel: () => void;
}

/**
 * Selector «Insertar desde Assets» (ASSET-04): una imagen ya catalogada se elige una vez y el mismo
 * `AssetRef` se reutiliza tal cual — nunca copia bytes. Las imágenes ausentes o en un formato que la
 * inserción enriquecida no admite (SVG/AVIF/BMP, ASSET-05) se muestran igual, sin ocultar el resto del
 * catálogo, pero no se pueden elegir.
 */
export function AssetImagePickerDialog({ visible, compact, entries, loading, onSelect, onCancel }: AssetImagePickerDialogProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  return (
    <Dialog visible={visible} title={t('assetImagePicker.title', locale)} compact={compact} onClose={onCancel} testID="asset-image-picker">
      {loading ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assetImagePicker.loading', locale)}</Text>
      ) : entries.length === 0 ? (
        <Text testID="asset-image-picker-empty" style={[styles.hint, { color: colors.textSecondary }]}>{t('assetImagePicker.empty', locale)}</Text>
      ) : (
        <View style={styles.grid}>
          {entries.map((entry) => {
            const disabled = entry.missing || !entry.compatible;
            return (
              <Pressable
                key={entry.ref}
                testID={`asset-image-picker-item-${entry.name}`}
                accessibilityRole="button"
                accessibilityLabel={t('assetImagePicker.select', locale, { name: entry.name })}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onSelect(entry.ref)}
                style={({ pressed }) => [styles.tile, { borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
              >
                {entry.previewUri ? (
                  <Image accessibilityIgnoresInvertColors source={{ uri: entry.previewUri }} resizeMode="cover" style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.placeholder, { backgroundColor: colors.background }]}>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {entry.missing ? t('assetImagePicker.missing', locale) : t('assetImagePicker.incompatible', locale)}
                    </Text>
                  </View>
                )}
                <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{entry.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 140, borderWidth: 2, padding: 8, gap: 6 },
  thumb: { width: '100%', height: 90 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  name: { fontSize: 12, fontWeight: '700' },
});
