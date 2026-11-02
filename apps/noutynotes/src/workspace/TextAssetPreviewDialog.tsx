import { useLocale, useTheme } from '@noutynotes/ui';
import { Text } from 'react-native';

import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { BasicRichTextPreview } from './BasicRichTextPreview';
import type { TextAssetPreviewState } from './useTextAssetPreview';

/**
 * Vista compartida entre Assets y una tarjeta de documento del Canvas (B9-R3-06), reutilizando el
 * mismo analizador/visor seguro que ya usan las Notas (B9-R2-12): `.md` con formato real, cualquier
 * otra cosa (incluido `.txt`) como texto literal. Nunca ejecuta HTML ni carga nada por su cuenta.
 */
export function TextAssetPreviewDialog({ preview, problem, compact, onClose, testID }: {
  readonly preview: TextAssetPreviewState | null;
  readonly problem?: string | null;
  readonly compact: boolean;
  readonly onClose: () => void;
  readonly testID: string;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <Dialog visible={preview !== null || !!problem} title={preview?.name ?? ''} compact={compact} presentation="centered" onClose={onClose} testID={testID}>
      {problem ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{problem}</Text> : null}
      {/* B9-R4-04: aviso, no bloqueo — el texto parcial ya se muestra debajo, siempre cortado en una
          frontera UTF-8 válida; el original completo sigue disponible por descarga, fuera de esta vista. */}
      {preview?.truncated ? <Text testID={`${testID}-truncated`} style={{ color: colors.textSecondary, fontSize: 13 }}>{t('textPreview.truncated', locale)}</Text> : null}
      {preview?.markdownDocument ? (
        <BasicRichTextPreview testID={`${testID}-markdown`} document={preview.markdownDocument} numberOfLines={0} unclamped
          color={colors.textPrimary} fontSize={15} lineHeight={22} />
      ) : preview ? (
        <Text selectable style={{ fontFamily: 'monospace', color: colors.textPrimary, fontSize: 14, lineHeight: 21 }}>{preview.text}</Text>
      ) : null}
    </Dialog>
  );
}
