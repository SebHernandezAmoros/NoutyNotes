import { copyWorkspaceToStorage, verifyWorkspaceCopy } from '@noutynotes/application';
import type { WorkspaceSummary } from '@noutynotes/application';
import type { WorkspaceId } from '@noutynotes/domain';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text } from 'react-native';
import { Dialog } from '../components/Dialog';
import { ActionButton } from '../components/controls';
import { t } from '../i18n';
import { isEmptyFolder } from './folderAccess';
import type { BrowserDirectory } from './folderAccess';
import { describeFolderOpenFailure, FolderPickerError } from './folderOpenDiagnostics';
import { useWorkspaceSession } from './WorkspaceSession';

export function SaveProjectToFolder({ visible, id, beforeCopy, onActivate, onClose }: {
  visible: boolean; id: WorkspaceId; beforeCopy: () => Promise<boolean>; onActivate: (handle: BrowserDirectory, name: string, summary: WorkspaceSummary) => Promise<boolean>; onClose: () => void;
}) {
  const session = useWorkspaceSession(); const { locale } = useLocale(); const { theme } = useTheme();
  const compact = resolveLayoutMode(useWindowWidth()) === 'compact';
  const [phase, setPhase] = useState<'idle' | 'choose' | 'copy'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ handle: BrowserDirectory; name: string; summary: WorkspaceSummary; verify: () => Promise<boolean> } | null>(null);
  const guard = useRef(false);
  useEffect(() => {
    if (phase !== 'copy' || Platform.OS !== 'web') return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const keys = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keys, true);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keys, true); };
  }, [phase]);
  const start = async () => {
    if (guard.current) return; guard.current = true; setMessage(null);
    const source = session.storage;
    try {
      if (saved) {
        if (!await beforeCopy()) { setMessage(t('folder.copy.flush', locale)); return; }
        setPhase('copy');
        if (!await saved.verify()) { setMessage(t('folder.copy.verify.failed', locale)); return; }
        if (await onActivate(saved.handle, saved.name, saved.summary)) onClose();
        else setMessage(t('folder.copy.saved', locale));
        return;
      }
      if (!await beforeCopy()) { setMessage(t('folder.copy.flush', locale)); return; }
      setPhase('choose');
      const selected = await session.chooseWebFolder();
      if (!selected) { setMessage(t('folder.open.technical', locale)); return; }
      if (!await isEmptyFolder(selected.handle)) { setMessage(t('folder.copy.occupied', locale)); return; }
      setPhase('copy');
      const result = await copyWorkspaceToStorage(source, selected.storage, id);
      if (!result.ok) { setMessage(t(result.stage === 'prepare' ? 'folder.copy.prepare.failed' : result.stage === 'write' ? 'folder.copy.write.failed' : 'folder.copy.verify.failed', locale)); return; }
      const verified = { handle: selected.handle, name: selected.name, summary: result.summary, verify: () => verifyWorkspaceCopy(source, selected.storage, id) };
      setSaved(verified);
      if (await onActivate(verified.handle, verified.name, verified.summary)) onClose();
      else setMessage(t('folder.copy.saved', locale));
    } catch (error) {
      setMessage(error instanceof FolderPickerError ? describeFolderOpenFailure({ message: '', diagnostic: error.diagnostic }, locale) : t('folder.copy.failed', locale));
    } finally { setPhase('idle'); guard.current = false; }
  };
  return <Dialog visible={visible} compact={compact} title={t('folder.copy.action', locale)} onClose={() => { if (!guard.current) onClose(); }} testID="save-project-folder">
    <Text style={{ color: theme.colors.textSecondary }}>{t('folder.copy.explanation', locale)}</Text>
    {phase === 'copy' ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textPrimary }}>{t('folder.copy.pending', locale)}</Text> : null}
    {message ? <Text accessibilityRole="alert" style={{ color: theme.colors.textPrimary }}>{message}</Text> : null}
    <ActionButton label={t(saved ? 'folder.copy.activate' : 'folder.copy.action', locale)} disabled={phase !== 'idle'} onPress={() => void start()} />
    <ActionButton label={t('home.create.dialog.cancel', locale)} disabled={phase !== 'idle'} onPress={onClose} />
  </Dialog>;
}
