export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeMode = Exclude<ThemePreference, 'system'>;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  gridLine: string;
  accent: string;
  accentText: string;
  selection: string;
  relationLine: string;
  note: string;
  noteText: string;
}

const light: ThemeColors = {
  background: '#F3EEE3',
  surface: '#FAF7EF',
  surfaceRaised: '#E9E3D5',
  textPrimary: '#23241F',
  textSecondary: '#615F55',
  border: '#34362F',
  gridLine: '#D9D3C5',
  accent: '#C7DE74',
  accentText: '#243016',
  selection: '#23756A',
  relationLine: '#51584A',
  note: '#E9C2B1',
  noteText: '#392D24',
};

const dark: ThemeColors = {
  background: '#20231F',
  surface: '#2A2E28',
  surfaceRaised: '#363D32',
  textPrimary: '#F3EEE3',
  textSecondary: '#C0C5B7',
  border: '#B0B99F',
  gridLine: '#424A3C',
  accent: '#C7DE74',
  accentText: '#243016',
  selection: '#93D7C9',
  relationLine: '#D9E3C3',
  note: '#E9C2B1',
  noteText: '#392D24',
};

export const themeColors = { light, dark } as const;

export function resolveThemeMode(
  preference: ThemePreference,
  systemMode: ThemeMode | 'unspecified' | null | undefined,
): ThemeMode {
  return preference === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : preference;
}
