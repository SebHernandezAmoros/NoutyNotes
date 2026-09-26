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
  /** Marca NoutyNotes (verde bosque en claro, menta en oscuro) y texto sobre ella. */
  brand: string;
  brandText: string;
  /** Papel del lienzo, ficha de tarjeta y su texto. */
  canvas: string;
  cardSurface: string;
  cardText: string;
  /** Cabeceras por tipo de tarjeta y su texto; el color nunca es la única señal (hay etiqueta). */
  headerNote: string;
  headerImage: string;
  headerText: string;
  /** Error: colisión, fuera de límites o fallo al guardar. */
  danger: string;
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
  brand: '#0F3D2E',
  brandText: '#FBF8EE',
  canvas: '#F7F3E8',
  cardSurface: '#FFFDF6',
  cardText: '#23241F',
  headerNote: '#F2B3C6',
  headerImage: '#9DD6E2',
  headerText: '#1E1F1A',
  danger: '#B3261E',
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
  brand: '#DCEFD9',
  brandText: '#0A2A20',
  canvas: '#262A24',
  cardSurface: '#30352D',
  cardText: '#F3EEE3',
  headerNote: '#E9A3BB',
  headerImage: '#86C9D6',
  headerText: '#1E1F1A',
  danger: '#FF8A80',
};

export const themeColors = { light, dark } as const;

export function resolveThemeMode(
  preference: ThemePreference,
  systemMode: ThemeMode | 'unspecified' | null | undefined,
): ThemeMode {
  return preference === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : preference;
}
