import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import { Dialog } from '../components/Dialog';
import { ActionButton } from '../components/controls';
import { t } from '../i18n';
import { chooseFolder } from './folderAccess';
import type { BrowserDirectory } from './folderAccess';

/** Un handle pendiente, aún sin cambiar el backend. El permiso solo se solicita desde el botón. */
export function useFolderChoice() {
  const pending = useRef<{ handle: BrowserDirectory; finish: (granted: boolean) => void } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [denied, setDenied] = useState(false);
  const choosing = useRef(false);
  useEffect(() => () => { pending.current?.finish(false); pending.current = null; }, []);
  const finish = (granted: boolean) => {
    pending.current?.finish(granted); pending.current = null; setName(null); setBusy(false);
  };
  const choose = async () => {
    if (choosing.current) return null;
    choosing.current = true;
    try {
      return await chooseFolder((handle) => new Promise<boolean>((resolve) => {
        pending.current = { handle, finish: resolve }; setName(handle.name); setDenied(false);
      }));
    } finally { choosing.current = false; }
  };
  const authorize = () => {
    if (!pending.current || busy) return;
    const operation = pending.current;
    setBusy(true); setDenied(false);
    // No await antes de requestPermission: conserva la activación del gesto explícito.
    void operation.handle.requestPermission({ mode: 'readwrite' }).then((permission) => {
      if (pending.current !== operation) return;
      if (permission === 'granted') finish(true);
      else { setDenied(true); setBusy(false); }
    }, () => { if (pending.current === operation) { setDenied(true); setBusy(false); } });
  };
  return { choose, permissionDialog: name === null ? null : <FolderWritePrompt name={name} busy={busy} denied={denied} onAuthorize={authorize} onCancel={() => { if (!busy) finish(false); }} /> };
}

function FolderWritePrompt({ name, busy, denied, onAuthorize, onCancel }: { name: string; busy: boolean; denied: boolean; onAuthorize: () => void; onCancel: () => void }) {
  const { locale } = useLocale(); const { theme } = useTheme();
  const compact = resolveLayoutMode(useWindowWidth()) === 'compact';
  return (
    <Dialog visible compact={compact} title={t('folder.authorize.title', locale)} onClose={onCancel} testID="folder-write-permission">
      <Text style={{ color: theme.colors.textPrimary }}>{name}</Text>
      <Text style={{ color: theme.colors.textSecondary }}>{t('folder.authorize.explanation', locale)}</Text>
      {denied ? <Text accessibilityRole="alert" style={{ color: theme.colors.textPrimary }}>{t('folder.open.denied', locale)}</Text> : null}
      <ActionButton label={t('folder.authorize.action', locale)} disabled={busy} onPress={onAuthorize} />
      <ActionButton label={t('home.create.dialog.cancel', locale)} disabled={busy} onPress={onCancel} />
    </Dialog>
  );
}
