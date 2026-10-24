import { analyzeAssetReferences } from '@noutynotes/application';
import type { AssetReferenceKind, AssetReferenceStatus } from '@noutynotes/application';
import type { CardId, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { ViewPreferences } from './canvas/preferences';

const statusKeys: Record<AssetReferenceStatus, TranslationKey> = {
  'complete-used': 'assets.references.completeUsed', 'complete-unused': 'assets.references.completeUnused',
  partial: 'assets.references.partial', error: 'assets.references.error', unsupported: 'assets.references.unsupported',
};
const kindKeys: Record<AssetReferenceKind, TranslationKey> = {
  'rich-image': 'assets.references.richImage', 'markdown-image': 'assets.references.markdownImage',
  'image-card': 'assets.references.imageCard', 'document-card': 'assets.references.documentCard',
  'asset-field': 'assets.references.field', 'asset-ref': 'assets.references.attachment', 'unknown-field': 'assets.references.unknownField',
};

/** Only the visible snapshot is queried. No storage calls, flush, recovery or deletion here. */
export function AssetReferenceDetails({ workspace, assetRef, preferences, onGo, onClose }: {
  readonly workspace: Workspace; readonly assetRef: string; readonly preferences: ViewPreferences;
  readonly onGo: (id: CardId) => void; readonly onClose: () => void;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  const analysis = useMemo(() => analyzeAssetReferences({ workspace, ref: assetRef,
    unverified: [t('assets.references.unverifiedSessions', locale), t('assets.references.unverifiedRoot', locale)],
    dependencies: preferences.noteFont === 'custom' && preferences.customFontRef
      ? [{ kind: 'custom-font', ref: preferences.customFontRef, label: t('assets.references.fontDependency', locale) }] : [],
  }), [workspace, assetRef, preferences.noteFont, preferences.customFontRef, locale]);
  const body = [styles.body, { color: colors.textPrimary }];
  const hint = [styles.hint, { color: colors.textSecondary }];
  return (
    <View testID="asset-reference-analysis" style={[styles.panel, { borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t('assets.references.title', locale)}</Text>
      <Text accessibilityLiveRegion="polite" style={body}>{t(statusKeys[analysis.status], locale)}</Text>
      <Text style={hint}>{t('assets.references.scope', locale, { name: workspace.metadata.name })}</Text>
      <Text style={body}>{t('assets.references.owners', locale, { count: String(analysis.ownerCount) })}</Text>
      <Text style={body}>{t('assets.references.occurrences', locale, { count: String(analysis.occurrenceCount) })}</Text>
      <Text style={hint}>{t('assets.references.snapshot', locale)}</Text>
      {analysis.issues.length > 0 ? (
        <View style={styles.group}>
          <Text style={body}>{t('assets.references.notFree', locale)}</Text>
          {analysis.issues.map((issue, index) => <Text key={index} style={hint}>{`• ${issue.detail}`}</Text>)}
        </View>
      ) : null}
      {analysis.owners.map((owner) => (
        <View key={owner.id} style={[styles.group, styles.owner, { borderColor: colors.border }]}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>{owner.title || t('assets.references.untitled', locale)}</Text>
          <Text style={body}>{t(owner.collection === 'active' ? 'assets.references.active' : owner.collection === 'archive' ? 'assets.references.archive' : 'assets.references.trash', locale)}</Text>
          <Text style={hint}>{owner.boards.length > 0 ? owner.boards.map((board) => board.title || t('assets.references.unavailableBoard', locale)).join(', ') : t('search.noBoard', locale)}</Text>
          {owner.restorable ? <Text style={hint}>{t('assets.references.restorable', locale)}</Text> : null}
          {analysis.occurrences.filter((use) => use.ownerId === owner.id).map((use) => {
            const position = use.locator.split(':').slice(1).join(':');
            const location = use.kind === 'rich-image' ? t('assets.references.block', locale, { position: String(Number(position) + 1) })
              : use.kind === 'markdown-image' ? t('assets.references.offset', locale, { position })
                : use.kind === 'asset-field' || use.kind === 'unknown-field' ? position : '';
            return <Text key={use.id} style={body}>{`${t(kindKeys[use.kind], locale)}${location ? ` · ${location}` : ''}`}</Text>;
          })}
          {owner.collection === 'active' ? <ActionButton label={t('search.go', locale)} accessibilityLabel={t('search.go.accessibilityLabel', locale, { title: owner.title })} onPress={() => onGo(owner.cardId)} /> : null}
        </View>
      ))}
      {analysis.dependencies.map((dependency) => <Text key={dependency.kind} style={body}>{dependency.label}</Text>)}
      <Text style={hint}>{t('assets.references.carriers', locale, { count: String(analysis.carriers.length) })}</Text>
      <ActionButton label={t('assets.references.close', locale)} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopWidth: 1, paddingTop: 10, gap: 8, minWidth: 0 },
  body: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  hint: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  heading: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  group: { gap: 4 }, owner: { borderTopWidth: 1, paddingTop: 8 },
});
