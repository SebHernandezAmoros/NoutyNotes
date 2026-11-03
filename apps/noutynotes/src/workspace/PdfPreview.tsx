import type { WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace } from '@noutynotes/domain';
import type { Locale } from '@noutynotes/ui';
import { useTheme } from '@noutynotes/ui';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { DialogCloseButton } from '../components/Dialog';
import { AppIcon } from '../components/AppIcon';
import { t } from '../i18n';
import { DocumentDiaryPanel } from './DocumentDiaryPanel';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

export type PdfPreviewState =
  | { readonly status: 'loading'; readonly name: string }
  | { readonly status: 'ready'; readonly name: string; readonly url: string; readonly ref: string }
  | { readonly status: 'error'; readonly name: string; readonly message: string };

interface PdfPreviewProps {
  readonly state: PdfPreviewState | null;
  readonly locale: Locale;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  readonly onClose: () => void;
  readonly onOpenDiary: () => void;
}

/**
 * UX7-F: visor de PDF embebido dentro de Assets, sin salir del Workspace — reutiliza el visor nativo
 * del navegador vía `<iframe src={blobUrl}>`, sin PDF.js ni dependencia nueva (el guion pide preferir
 * capacidades existentes; Chrome/Edge/Firefox/Safari ya saben mostrar un PDF dentro de un iframe).
 *
 * Deliberadamente NO reutiliza el `Dialog` compartido (560px, pensado para formularios cortos): un
 * documento necesita un área de lectura mucho mayor (sección 9 del encargo). Sí reutiliza su mismo
 * lenguaje visual — `DialogCloseButton`, fondo que cierra al tocarlo, Escape en web.
 *
 * El ciclo de vida del Blob URL (crear/revocar, evitar carreras entre documentos, cerrar al cambiar
 * de proyecto) vive en `AssetsView.tsx`, que es quien conoce cuándo cambia el workspace o el asset
 * seleccionado — este componente solo presenta el estado que recibe.
 *
 * B9-R5: el Diario lateral contextual (`DocumentDiaryPanel`) vive dentro de este mismo `panel`/`body`,
 * hermano del `<iframe>` — nunca cambia `state.url` ni lo desmonta, así que expandir/contraer el Diario
 * jamás recarga el PDF ni pierde su posición/zoom. `requestClose` respeta la jerarquía de controles
 * activos (sección A6 del encargo): primero el panel expandido, luego un borrador sin guardar, y solo
 * al final el cierre real del visor — un solo punto de entrada para Escape, fondo, X y atrás (Android).
 */
export function PdfPreview({ state, locale, compact, workspace, run, onClose, onOpenDiary }: PdfPreviewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const visible = state !== null;
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = useCallback(() => {
    if (confirmingClose) { setConfirmingClose(false); return; }
    if (panelExpanded) { setPanelExpanded(false); return; }
    if (panelDirty) { setConfirmingClose(true); return; }
    onClose();
  }, [confirmingClose, panelExpanded, panelDirty, onClose]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, requestClose]);

  if (!state) return null;
  const title = t('assets.pdf.preview.title', locale, { name: state.name });

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={`${t('dialog.close', locale)} ${title}`} accessible={false} style={StyleSheet.absoluteFill} onPress={requestClose} />
        <View
          testID="asset-pdf-preview"
          accessibilityViewIsModal
          {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': title } : {})}
          style={[styles.panel, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View testID="asset-pdf-header" style={styles.header}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{state.name}</Text>
            <View style={styles.headerActions}>
            {state.status === 'ready' && Platform.OS === 'web' ? <>
              <a aria-label={t('content.pdfNewTab', locale)} title={t('content.pdfNewTab', locale)} href={state.url} target="_blank" rel="noopener noreferrer"
                style={{ width: 44, height: 44, boxSizing: 'border-box', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${colors.border}`, background: colors.surface, color: colors.textPrimary }}>
                <AppIcon name="external-link" size={20} />
              </a>
              <a aria-label={t('content.pdfDownload', locale)} title={t('content.pdfDownload', locale)} href={state.url} download={`${state.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.pdf$/i, '') || 'document'}.pdf`}
                style={{ width: 44, height: 44, boxSizing: 'border-box', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${colors.border}`, background: colors.surface, color: colors.textPrimary }}>
                <AppIcon name="download" size={20} />
              </a>
            </> : null}
            {Platform.OS === 'web' ? <span title={t('dialog.close', locale)} style={{ display: 'flex', flexShrink: 0 }}><DialogCloseButton label={`${t('dialog.close', locale)} ${title.toLowerCase()}`} onPress={requestClose} /></span>
              : <DialogCloseButton label={`${t('dialog.close', locale)} ${title.toLowerCase()}`} onPress={requestClose} />}
            </View>
          </View>
          <View style={styles.body}>
            {state.status === 'loading' ? (
              <Text testID="asset-pdf-preview-loading" style={[styles.message, { color: colors.textSecondary }]}>{t('assets.pdf.preview.loading', locale)}</Text>
            ) : state.status === 'error' ? (
              <Text testID="asset-pdf-preview-error" accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{state.message}</Text>
            ) : Platform.OS === 'web' ? (
              // Elemento DOM directo, no un primitivo de React Native: mismo patrón ya usado en
              // `BoardTabs.tsx`/`RichTextEditor.web.tsx` para capacidades exclusivas de web.
              <iframe data-testid="asset-pdf-preview-frame" title={title} src={state.url} style={{ flex: 1, width: '100%', height: '100%', border: 'none' }} />
            ) : (
              <Text style={[styles.message, { color: colors.textSecondary }]}>{t('assets.pdf.preview.unsupported', locale)}</Text>
            )}
            {state.status === 'ready' ? (
              <DocumentDiaryPanel key={state.ref} documentRef={state.ref} documentName={state.name} kind="pdf" compact={compact} workspace={workspace} run={run}
                expanded={panelExpanded} onExpandedChange={setPanelExpanded} onDirtyChange={setPanelDirty}
                // «Ver en el Diario» navega a otra pantalla por completo: cierra este visor primero —
                // de lo contrario el `Modal` (un portal propio, fuera de la jerarquía de pantallas)
                // seguiría interceptando toques sobre el Diario aunque ya no sea la vista activa.
                onOpenDiary={() => { onClose(); onOpenDiary(); }} testID="asset-pdf-diary" />
            ) : null}
            {confirmingClose ? (
              <View style={styles.confirmBackdrop}>
                <View testID="asset-pdf-discard-confirmation" style={[styles.confirmBox, { backgroundColor: colors.background, borderColor: colors.danger }]}>
                  <Text accessibilityRole="alert" style={[styles.confirmText, { color: colors.textPrimary }]}>{t('diary.entry.discard.confirm', locale)}</Text>
                  <View style={styles.row}>
                    <ActionButton label={t('diary.entry.keepEditing', locale)} tone="primary" onPress={() => setConfirmingClose(false)} />
                    <ActionButton testID="asset-pdf-discard-confirm" label={t('diary.entry.discard.confirmLabel', locale)} onPress={onClose} />
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 22, 18, 0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 960, height: '90%', borderWidth: 2, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  title: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: '900' },
  body: { flex: 1 },
  message: { flex: 1, padding: 16, fontSize: 14, lineHeight: 20, textAlign: 'center', textAlignVertical: 'center' },
  confirmBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20, 22, 18, 0.45)', padding: 16, zIndex: 3 },
  confirmBox: { width: '100%', maxWidth: 420, borderWidth: 2, padding: 16, gap: 12 },
  confirmText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 6 },
});
