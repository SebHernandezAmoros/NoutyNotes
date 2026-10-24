import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useLocale, useTheme } from '@noutynotes/ui';

import { useHydrated } from '../components/useHydrated';
import { ActionButton } from '../components/controls';
import { t } from '../i18n';
import { useWorkspaceSession } from './WorkspaceSession';
import type { ResumeState } from './sessionResume';

export function WorkspaceResumeGate({ id, children }: { readonly id: string | undefined; readonly children: ReactNode }) {
  const { beginResume, reconnectResume, cancelResume, leaveProject } = useWorkspaceSession();
  const hydrated = useHydrated();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const [state, setState] = useState<ResumeState | 'skip'>('resolving');
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void beginResume(id).then((next) => { if (active) setState(next); });
    return () => { active = false; cancelResume(); };
  }, [beginResume, cancelResume, hydrated, id]);
  if (state === 'ready' || state === 'skip') return children;
  const reconnect = () => {
    setState('resolving');
    void reconnectResume().then((next) => { if (next !== 'idle') setState(next); });
  };
  return (
    <View testID="workspace-resume" style={{ flex: 1, padding: 24, gap: 16, backgroundColor: theme.colors.background }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, color: theme.colors.textPrimary }}>{t('session.resume.title', locale)}</Text>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textPrimary }}>
        {t(state === 'resolving' || state === 'idle' ? 'session.resume.loading'
          : state === 'permission' ? 'session.resume.permission'
            : state === 'recovery' ? 'session.resume.recovery' : 'session.resume.unavailable', locale)}
      </Text>
      {state === 'permission' ? <ActionButton label={t('session.resume.reconnect', locale)} onPress={reconnect} /> : null}
      <ActionButton label={t('session.resume.leave', locale)} onPress={() => { leaveProject(); router.replace('/'); }} />
    </View>
  );
}
