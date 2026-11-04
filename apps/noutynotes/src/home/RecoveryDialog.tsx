import type { WorkspaceRecoveryPlan } from '@noutynotes/storage';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

/**
 * Bloque 16, Paquete 2 (ADR 0010): vista previa del plan de recuperación no destructivo antes de
 * confirmarlo, y resultado de la cuarentena una vez construida la copia. Nunca ofrece una vía de
 * «Reparar»/«Purgar»/«Recuperar automáticamente» — esas capacidades no existen todavía. El proyecto
 * original nunca se toca desde este diálogo: solo lee (vía `plan`, ya calculado) y, al confirmar, abre
 * una copia nueva e independiente.
 */
export function RecoveryDialog({ visible, compact, loading, plan, confirming, confirmError, onClose, onConfirm, onDownload }: {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly loading: boolean;
  readonly plan: WorkspaceRecoveryPlan | null;
  readonly confirming: boolean;
  readonly confirmError: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly onDownload: (path: string) => void;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <Dialog visible={visible} compact={compact} title={t('recovery.dialog.title', locale)} onClose={onClose} testID="recovery-dialog">
      {loading ? (
        <Text style={{ color: colors.textSecondary }}>{t('recovery.dialog.loading', locale)}</Text>
      ) : !plan ? null : !plan.ok ? (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontWeight: '700' }}>{t('recovery.dialog.notRecoverable', locale)}</Text>
          {plan.issues.map((issue, index) => (
            <Text key={`${issue.code}-${index}`} style={{ color: colors.textSecondary, fontSize: 13 }}>{issue.message}</Text>
          ))}
          <ActionButton label={t('trash.cancel', locale)} onPress={onClose} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text testID="recovery-summary" style={{ color: colors.textPrimary, fontWeight: '700' }}>
            {t('recovery.dialog.summary', locale, { boards: String(plan.value.workspace.boards.length), cards: String(plan.value.workspace.cards.length) })}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t('recovery.dialog.independent', locale)}</Text>
          {plan.value.quarantined.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>{t('recovery.dialog.nothingQuarantined', locale)}</Text>
          ) : (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: colors.textPrimary, fontWeight: '700' }}>
                {t('recovery.dialog.quarantine.heading', locale, { count: String(plan.value.quarantined.length) })}
              </Text>
              {plan.value.quarantined.map((entity) => (
                <View key={entity.path} testID={`recovery-quarantine-${entity.path}`} style={{ borderWidth: 1, borderColor: colors.border, padding: 8, gap: 4 }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{entity.path}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{entity.reason}</Text>
                  {entity.text !== null ? (
                    <ActionButton testID={`recovery-quarantine-download-${entity.path}`} label={t('recovery.dialog.quarantine.download', locale)} onPress={() => onDownload(entity.path)} />
                  ) : (
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{t('recovery.dialog.quarantine.nothingToDownload', locale)}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
          {confirmError ? <Text testID="recovery-confirm-error" accessibilityRole="alert" style={{ color: colors.danger }}>{confirmError}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <ActionButton testID="recovery-confirm" label={confirming ? t('recovery.dialog.opening', locale) : t('recovery.dialog.confirm', locale)} tone="primary" disabled={confirming} onPress={onConfirm} />
            <ActionButton label={t('trash.cancel', locale)} disabled={confirming} onPress={onClose} />
          </View>
        </View>
      )}
    </Dialog>
  );
}
