import { useColorScheme } from 'react-native';

import type { ThemeMode } from './theme';

export function useSystemTheme(): ThemeMode {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
