import { isAssetDetachmentPlanCurrent, planAssetDetachment } from '@noutynotes/application';
import type { AssetReferenceAnalysis, NoteImagePolicy } from '@noutynotes/application';
import type { AssetRef, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '../components/controls';
import { t } from '../i18n';

/** Local review decisions only. No storage, navigation, apply callback or execution button. */
export function AssetDetachmentPreview({ workspace, analysis, onClose }: {
  readonly workspace: Workspace; readonly analysis: AssetReferenceAnalysis; readonly onClose: () => void;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const [basis, setBasis] = useState(analysis);
  const [policy, setPolicy] = useState<NoteImagePolicy>('keep-marker');
  const [exceptions, setExceptions] = useState<readonly { readonly occurrenceId: string; readonly policy: NoteImagePolicy }[]>([]);
  const plan = useMemo(() => planAssetDetachment({ snapshot: workspace, assetRef: analysis.ref as AssetRef, analysis: basis,
    noteImagePolicy: policy, exceptions: { sourceSnapshot: basis.sourceSnapshot ?? '', values: exceptions } }), [workspace, analysis.ref, basis, policy, exceptions]);
  const current = isAssetDetachmentPlanCurrent(plan, workspace, analysis);
  const status = current ? plan.status : 'stale';
  const body = { color: theme.colors.textPrimary, fontSize: 14, lineHeight: 20 };
  const row = { gap: 8, paddingTop: 8, borderTopWidth: 1, borderColor: theme.colors.border };
  const choose = (id: string, next: NoteImagePolicy | null) => setExceptions((old) => [
    ...old.filter((entry) => entry.occurrenceId !== id), ...(next ? [{ occurrenceId: id, policy: next }] : []),
  ]);
  return <View testID="asset-detachment-preview" style={{ ...row, minWidth: 0 }}>
    <Text accessibilityRole="header" style={{ ...body, fontWeight: '800' }}>{t('assets.plan.title', locale)}</Text>
    <Text style={{ ...body, fontWeight: '700' }}>{t('assets.plan.notice', locale)}</Text>
    <Text testID="asset-plan-status" accessibilityLiveRegion="polite" style={body}>{t(`assets.plan.${status}`, locale)}</Text>
    <Text style={body}>{t('assets.plan.scope', locale)}</Text>
    <Text style={body}>{t('assets.plan.summary', locale, { markers: String(plan.summary.markers), blocks: String(plan.summary.removedBlocks), cards: String(plan.summary.retainedCards) })}</Text>
    <Text style={body}>{t('assets.plan.general', locale)}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <ActionButton label={t('assets.plan.keep', locale)} accessibilityLabel={t('assets.plan.generalKeep', locale)} pressed={policy === 'keep-marker'} disabled={!current} onPress={() => setPolicy('keep-marker')} />
      <ActionButton label={t('assets.plan.remove', locale)} accessibilityLabel={t('assets.plan.generalRemove', locale)} pressed={policy === 'remove-block'} disabled={!current} onPress={() => setPolicy('remove-block')} />
    </View>
    {plan.owners.map((owner) => <View key={owner.id} style={row}>
      <Text style={{ ...body, fontWeight: '700' }}>{owner.title || t('assets.references.untitled', locale)}</Text>
      <Text style={body}>{t(owner.collection === 'active' ? 'assets.references.active' : owner.collection === 'archive' ? 'assets.references.archive' : 'assets.references.trash', locale)}</Text>
      {plan.entries.filter((entry) => entry.ownerId === owner.id).map((entry, index) => {
        const override = exceptions.find((value) => value.occurrenceId === entry.id);
        const position = String(index + 1);
        return <View key={entry.id} testID="asset-plan-occurrence" style={{ gap: 6 }}>
          <Text style={body}>{t('assets.plan.appearance', locale, { position })}</Text>
          {entry.kind === 'rich-image' ? <Text style={body}>{t('assets.references.block', locale, { position: String(Number(entry.locator.split(':')[1]) + 1) })}</Text>
            : entry.kind === 'markdown-image' ? <Text style={body}>{t('assets.references.offset', locale, { position: entry.locator.split(':')[1] ?? '' })}</Text> : null}
          <Text testID="asset-plan-proposal" style={body}>{entry.proposal.kind === 'unsupported' ? entry.proposal.reason
            : t(entry.proposal.kind === 'retire-card' ? 'assets.plan.retainedCard' : entry.proposal.kind === 'keep-marker' ? 'assets.plan.markerProposal' : 'assets.plan.removeProposal', locale)}</Text>
          {entry.policy !== null ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ActionButton label={t('assets.plan.inherit', locale)} pressed={!override} disabled={!current} onPress={() => choose(entry.id, null)} />
            <ActionButton label={t('assets.plan.keep', locale)} pressed={override?.policy === 'keep-marker'} disabled={!current} onPress={() => choose(entry.id, 'keep-marker')} />
            <ActionButton label={t('assets.plan.remove', locale)} pressed={override?.policy === 'remove-block'} disabled={!current} onPress={() => choose(entry.id, 'remove-block')} />
          </View> : null}
        </View>;
      })}
    </View>)}
    <Text style={body}>{t('assets.references.carriers', locale, { count: String(plan.carriers.length) })}</Text>
    {plan.carriers.map((carrier, index) => <Text key={`${carrier.ownerId}-${carrier.locator}`} style={body}>{`${index + 1}. ${t(`assets.plan.carrier.${carrier.proposal}`, locale)}`}</Text>)}
    {plan.dependencies.map((dependency, index) => <Text key={index} style={body}>{dependency.label}</Text>)}
    {[...plan.coverage.limitations, ...plan.blockers].map((warning, index) => <Text key={index} style={body}>{`• ${warning}`}</Text>)}
    <ActionButton label={t('assets.plan.recalculate', locale)} onPress={() => { setBasis(analysis); setPolicy('keep-marker'); setExceptions([]); }} />
    <ActionButton label={t('assets.plan.close', locale)} onPress={onClose} />
  </View>;
}
