import type { MarkerCopyResult } from '@noutynotes/storage';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Pressable, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

const reasonKey = {
  'read-failure': 'marker.copy.readFailure', 'marker-missing': 'marker.copy.markerMissing',
  'marker-valid': 'marker.copy.markerValid', 'incompatible-version': 'marker.copy.incompatible',
  'ambiguous-artifact': 'marker.copy.ambiguous', 'deleted-source': 'marker.copy.deletedSource', 'snapshot-changed': 'marker.copy.changed',
  'invalid-text': 'marker.copy.invalidText', 'invalid-workspace': 'marker.copy.invalidWorkspace',
  'missing-asset': 'marker.copy.missingAsset', 'archive-invalid': 'marker.copy.archiveInvalid',
  'evidence-unavailable': 'marker.copy.evidenceUnavailable',
} as const;
const markerReasonKey = {
  encoding: 'marker.copy.reason.encoding', json: 'marker.copy.reason.json', shape: 'marker.copy.reason.shape',
  version: 'marker.copy.reason.version', entries: 'marker.copy.reason.entries',
  'duplicate-keys': 'marker.copy.reason.duplicateKeys',
} as const;

/** Flujo distinto de la cuarentena de tarjetas: el marcador transaccional nunca se descarta. */
export function MarkerRecoveryDialog({ visible, compact, loading, result, evidenceDownloaded, evidenceVerified,
  acknowledged, confirming, error, onClose, onDownloadEvidence, onVerifyEvidence, onAcknowledge, onConfirm }: {
  readonly visible: boolean; readonly compact: boolean; readonly loading: boolean;
  readonly result: MarkerCopyResult | null;
  readonly evidenceDownloaded: boolean; readonly evidenceVerified: boolean; readonly acknowledged: boolean;
  readonly confirming: boolean; readonly error: string | null;
  readonly onClose: () => void; readonly onDownloadEvidence: () => void;
  readonly onVerifyEvidence: () => void; readonly onAcknowledge: () => void; readonly onConfirm: () => void;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <Dialog visible={visible} compact={compact} presentation="centered" title={t('marker.copy.title', locale)} onClose={onClose} testID="marker-recovery-dialog">
      <View style={{ gap: 12 }}>
        {loading ? <Text style={{ color: colors.textSecondary }}>{t('recovery.dialog.loading', locale)}</Text> : null}
        {result ? (
          <>
            <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{t('marker.copy.problem', locale)}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('marker.copy.uncertainty', locale)}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('marker.copy.sourceSafe', locale)}</Text>
            {result.status === 'candidate' ? (
              <Text testID="marker-copy-summary" style={{ color: colors.textPrimary }}>
                {t('recovery.dialog.summary', locale, { boards: String(result.workspace.boards.length), cards: String(result.workspace.cards.length) })}
              </Text>
            ) : (
              <Text testID="marker-copy-blocked" accessibilityRole="alert" style={{ color: colors.danger }}>
                {t(reasonKey[result.reason], locale)}
              </Text>
            )}
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {t('marker.copy.diagnostic', locale, { reason: result.markerReason && result.markerReason in markerReasonKey
                ? t(markerReasonKey[result.markerReason as keyof typeof markerReasonKey], locale)
                : result.status === 'blocked' ? t(reasonKey[result.reason], locale) : t('marker.copy.reason.unknown', locale) })}
            </Text>
            {result.evidence ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.textPrimary }}>{t('marker.copy.evidenceInfo', locale)}</Text>
                <ActionButton testID="marker-copy-export-evidence" label={t('marker.copy.exportEvidence', locale)} onPress={onDownloadEvidence} />
                <ActionButton testID="marker-copy-verify-evidence" label={t('marker.copy.verifyEvidence', locale)}
                  disabled={!evidenceDownloaded} onPress={onVerifyEvidence} />
                {evidenceVerified ? <Text testID="marker-copy-evidence-verified" accessibilityRole="alert" style={{ color: colors.textPrimary }}>
                  {t('marker.copy.evidenceVerified', locale)}
                </Text> : null}
              </View>
            ) : <Text style={{ color: colors.danger }}>{t('marker.copy.noEvidence', locale)}</Text>}
            {result.status === 'candidate' ? (
              <Pressable testID="marker-copy-acknowledge" accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }}
                onPress={onAcknowledge} style={{ minHeight: 44, justifyContent: 'center', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ color: colors.textPrimary }}>{acknowledged ? '☑' : '☐'}</Text>
                <Text style={{ color: colors.textPrimary, flex: 1 }}>{t('marker.copy.acknowledge', locale)}</Text>
              </Pressable>
            ) : null}
            {error ? <Text testID="marker-copy-error" accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {result.status === 'candidate' ? <ActionButton testID="marker-copy-open" tone="primary"
                label={confirming ? t('recovery.dialog.opening', locale) : t('recovery.dialog.confirm', locale)}
                disabled={!evidenceVerified || !acknowledged || confirming} onPress={onConfirm} /> : null}
              <ActionButton label={t('trash.cancel', locale)} disabled={confirming} onPress={onClose} />
            </View>
          </>
        ) : null}
      </View>
    </Dialog>
  );
}
