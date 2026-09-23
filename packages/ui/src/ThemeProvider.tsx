import { createContext, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { resolveThemeMode, themeColors } from './theme';
import type { ThemeColors, ThemeMode, ThemePreference } from './theme';
import { useSystemTheme } from './useSystemTheme';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  theme: { mode: ThemeMode; colors: ThemeColors };
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const systemMode = useSystemTheme();
  const mode = resolveThemeMode(preference, systemMode);
  const value = useMemo(() => ({
    preference,
    setPreference,
    theme: { mode, colors: themeColors[mode] },
  }), [preference, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme requiere ThemeProvider.');
  return value;
}
