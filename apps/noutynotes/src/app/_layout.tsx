import { ThemeProvider, useTheme } from '@noutynotes/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { registerOfflineWorker } from '../offline/registerOfflineWorker';

import { WorkspaceSessionProvider } from '../session/WorkspaceSession';

function AppNavigation() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  // Arranque sin conexión del export web (ADR 0011); después de hidratar, nunca en el HTML estático.
  useEffect(() => { registerOfflineWorker(); }, []);
  // El almacenamiento en memoria vive por encima del tema y de la navegación (ADR 0009).
  return (
    <WorkspaceSessionProvider>
      <ThemeProvider>
        <AppNavigation />
      </ThemeProvider>
    </WorkspaceSessionProvider>
  );
}
