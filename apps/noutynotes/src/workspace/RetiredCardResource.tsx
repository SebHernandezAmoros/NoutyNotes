import { cardTitleText, richTextDocumentText } from '@noutynotes/domain';
import type { Card } from '@noutynotes/domain';
import { useLocale } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { BasicRichTextPreview } from './BasicRichTextPreview';

/** Inert presentation of a validated Card state. It never resolves or replaces an Asset. */
export function RetiredCardResource({ card, color, compact = false, showTitle = true, showBody = true, fullBody = false, testID }: {
  readonly card: Card; readonly color: string; readonly compact?: boolean; readonly showTitle?: boolean; readonly showBody?: boolean; readonly fullBody?: boolean; readonly testID: string;
}) {
  const { locale } = useLocale();
  if (!card.primaryResourceState) return null;
  return <View testID={testID} style={[styles.notice, compact ? styles.compact : null]}>
    {showTitle && (card.title || card.titleRichText) ? <Text numberOfLines={compact ? 1 : 3} style={[styles.title, { color, fontSize: compact ? 11 : 16 }]}>
      {cardTitleText(card)}
    </Text> : null}
    <Text style={[styles.status, { color, fontSize: compact ? 10 : 14 }]}>{t('card.resourceRetired', locale)}</Text>
    <Text style={[styles.body, { color, fontSize: compact ? 10 : 13 }]}>{t(card.primaryResourceState.resourceKind === 'image' ? 'card.retiredImage' : 'card.retiredPdf', locale)}</Text>
    {!compact && showBody && (card.content || (fullBody && card.contentDocument)) ? <Text selectable={fullBody} numberOfLines={fullBody ? undefined : 3} style={[styles.body, { color }]}>{card.content ?? (card.contentDocument ? richTextDocumentText(card.contentDocument) : '')}</Text> : null}
    {!compact && showBody && !fullBody && card.contentDocument ? <BasicRichTextPreview document={card.contentDocument} numberOfLines={3} color={color} fontSize={13} lineHeight={18} testID={`${testID}-body`} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  notice: { alignItems: 'center', justifyContent: 'center', padding: 8, gap: 6, maxWidth: '100%' },
  compact: { padding: 4, gap: 2 },
  title: { fontWeight: '800', textAlign: 'center', maxWidth: '100%' },
  status: { fontWeight: '700', textAlign: 'center', maxWidth: '100%' },
  body: { fontSize: 13, textAlign: 'center', maxWidth: '100%' },
});
