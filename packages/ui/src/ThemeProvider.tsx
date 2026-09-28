import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';

import { createExternalPreference } from './externalPreference';
import { resolveThemeMode, themeColors } from './theme';
import type { ThemeColors, ThemeMode, ThemePreference } from './theme';
import { useSystemTheme } from './useSystemTheme';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  theme: { mode: ThemeMode; colors: ThemeColors };
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  /**
   * Preferencia guardada en el dispositivo (ADR 0029). Se lee después de montar: el export estático se
   * genera sin almacenamiento y leerla al renderizar rompería la hidratación.
   */
  readonly load?: () => ThemePreference | null;
  readonly save?: (preference: ThemePreference) => void;
}

export function ThemeProvider({ children, load, save }: PropsWithChildren<ThemeProviderProps>) {
  // Almacén externo: al hidratar vale «system» (la instantánea del servidor) y después, lo guardado.
  const [store] = useState(() => createExternalPreference<ThemePreference>('system', load, save));
  const preference = useSyncExternalStore(store.subscribe, store.get, () => 'system' as const);
  const setPreference = store.set;
  const systemMode = useSystemTheme();
  const mode = resolveThemeMode(preference, systemMode);
  const value = useMemo(() => ({
    preference,
    setPreference,
    theme: { mode, colors: themeColors[mode] },
  }), [preference, setPreference, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme requiere ThemeProvider.');
  return value;
}
