import type { RichTextRetiredImage } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Text, View } from 'react-native';
import { t } from '../i18n';

/** An inert editorial block. It has no URI, loader, viewer, replacement or removal action. */
export function RetiredImageBlock({ block, testID }: { readonly block: RichTextRetiredImage; readonly testID: string }) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  return <View testID={testID} accessibilityLabel={t('image.retired', locale)} style={{ padding: 8, gap: 4, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceRaised, maxWidth: '100%' }}>
    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{t('image.retired', locale)}</Text>
    {block.alt ? <Text style={{ color: theme.colors.textPrimary }}>{block.alt}</Text> : null}
    {block.caption !== undefined ? <Text style={{ color: theme.colors.textPrimary }}>{block.caption.map((inline, index) => inline.type === 'hard-break' ? '\n'
      : <Text key={index} style={{ fontWeight: inline.marks?.includes('bold') ? '700' : '400', fontStyle: inline.marks?.includes('italic') ? 'italic' : 'normal' }}>{inline.text}</Text>)}</Text> : null}
  </View>;
}
