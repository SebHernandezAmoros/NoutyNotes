import { ThemeProvider, useTheme } from '@noutynotes/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

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
  return (
    <ThemeProvider>
      <AppNavigation />
    </ThemeProvider>
  );
}
