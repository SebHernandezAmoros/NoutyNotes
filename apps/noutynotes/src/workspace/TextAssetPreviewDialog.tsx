import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { BasicRichTextPreview } from './BasicRichTextPreview';
import { DocumentDiaryPanel } from './DocumentDiaryPanel';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';
import type { TextAssetPreviewState } from './useTextAssetPreview';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

/**
 * Vista compartida entre Assets y una tarjeta de documento del Canvas (B9-R3-06), reutilizando el
 * mismo analizador/visor seguro que ya usan las Notas (B9-R2-12): `.md` con formato real, cualquier
 * otra cosa (incluido `.txt`) como texto literal. Nunca ejecuta HTML ni carga nada por su cuenta.
 *
 * B9-R5: el Diario lateral contextual vive en `Dialog`'s `sidePanel` (hermano del `ScrollView`, nunca
 * dentro) — expandirlo no toca `preview`, así que nunca recarga el texto ni pierde el scroll propio del
 * documento. `requestClose` aplica la misma jerarquía de Escape/cierre que `PdfPreview`: panel abierto
 * → borrador sin guardar → cierre real, un único punto de entrada para todos los disparadores de
 * `Dialog` (Escape, fondo, X, atrás en Android).
 */
export function TextAssetPreviewDialog({ preview, problem, compact, workspace, run, onClose, onOpenDiary, testID }: {
  readonly preview: TextAssetPreviewState | null;
  readonly problem?: string | null;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  readonly onClose: () => void;
  readonly onOpenDiary: () => void;
  readonly testID: string;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = () => {
    if (confirmingClose) { setConfirmingClose(false); return; }
    if (panelExpanded) { setPanelExpanded(false); return; }
    if (panelDirty) { setConfirmingClose(true); return; }
    onClose();
  };

  return (
    <Dialog visible={preview !== null || !!problem} title={preview?.name ?? ''} compact={compact} presentation="centered" onClose={requestClose} testID={testID}
      sidePanel={preview ? (
        <>
          <DocumentDiaryPanel key={preview.ref} documentRef={preview.ref} documentName={preview.name}
            kind={preview.markdownDocument ? 'markdown' : 'txt'} compact={compact} workspace={workspace} run={run}
            expanded={panelExpanded} onExpandedChange={setPanelExpanded} onDirtyChange={setPanelDirty}
            // Mismo criterio que `PdfPreview`: navegar al Diario cierra primero este visor (su `Modal`
            // es un portal propio, fuera de la jerarquía de pantallas).
            onOpenDiary={() => { onClose(); onOpenDiary(); }} testID={`${testID}-diary`} />
          {confirmingClose ? (
            <View style={styles.confirmBackdrop}>
              <View testID={`${testID}-discard-confirmation`} style={[styles.confirmBox, { backgroundColor: colors.background, borderColor: colors.danger }]}>
                <Text accessibilityRole="alert" style={[styles.confirmText, { color: colors.textPrimary }]}>{t('diary.entry.discard.confirm', locale)}</Text>
                <View style={styles.row}>
                  <ActionButton label={t('diary.entry.keepEditing', locale)} tone="primary" onPress={() => setConfirmingClose(false)} />
                  <ActionButton testID={`${testID}-discard-confirm`} label={t('diary.entry.discard.confirmLabel', locale)} onPress={onClose} />
                </View>
              </View>
            </View>
          ) : null}
        </>
      ) : undefined}
    >
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

const styles = StyleSheet.create({
  confirmBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20, 22, 18, 0.45)', padding: 16, zIndex: 3 },
  confirmBox: { width: '100%', maxWidth: 420, borderWidth: 2, padding: 16, gap: 12 },
  confirmText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 6 },
});
