import type { Card, NoteFontOverride } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Platform, Text, View } from 'react-native';
import { t } from '../i18n';
import { useContentResources } from './ContentResources';

export function NoteFontPicker({ card, onChange }: { readonly card: Card; readonly onChange: (font: NoteFontOverride | null) => void }) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const resources = useContentResources();
  if (Platform.OS !== 'web') return null;
  const choice = card.noteFont?.kind === 'asset' ? `asset:${card.noteFont.assetRef}` : card.noteFont?.family ?? 'inherit';
  const refs = [...new Set([...resources.fontRefs, ...(card.noteFont?.kind === 'asset' ? [card.noteFont.assetRef] : [])])];
  const status = card.noteFont?.kind === 'asset' ? resources.fontState(card.noteFont.assetRef) : 'active';
  return <View testID="note-font-picker" style={{ gap: 6 }}>
    <Text style={{ color: theme.colors.textPrimary }}>{t('content.noteFont', locale)}</Text>
    <select aria-label={t('content.noteFont', locale)} value={choice} style={{ minHeight: 44, maxWidth: '100%', background: theme.colors.surface, color: theme.colors.textPrimary }}
      onChange={(event) => {
        const value = event.target.value;
        if (value === 'inherit') onChange(null);
        else if (value === 'system' || value === 'serif' || value === 'mono') onChange({ kind: 'builtin', family: value });
        else { const ref = refs.find((candidate) => `asset:${candidate}` === value); if (ref) onChange({ kind: 'asset', assetRef: ref as Extract<NoteFontOverride, { kind: 'asset' }>['assetRef'] }); }
      }}>
      <option value="inherit">{t('content.inherit', locale)}</option>
      <option value="system">{t('settings.font.system', locale)}</option>
      <option value="serif">Serif</option><option value="mono">{t('settings.font.mono', locale)}</option>
      {refs.map((ref) => <option key={ref} value={`asset:${ref}`}>{ref.split('/').pop()}</option>)}
    </select>
    {status !== 'active' ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textSecondary }}>{t(status === 'loading' ? 'content.fontLoading' : 'content.fontFallback', locale)}</Text> : null}
  </View>;
}
