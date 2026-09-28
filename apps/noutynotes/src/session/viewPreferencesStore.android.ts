import { File, Paths } from 'expo-file-system';

/** Preferencias de vista en un JSON privado de la app (ADR 0014); nunca en el workspace. */
const file = () => new File(Paths.document, 'nouty-view-preferences.json');

export function loadViewPreferences(): string | null {
  try {
    const stored = file();
    return stored.exists ? stored.textSync() : null;
  } catch {
    return null;
  }
}

export function saveViewPreferences(serialized: string): void {
  try {
    file().write(serialized);
  } catch {
    // Sin almacenamiento, la preferencia dura la sesión.
  }
}

const themes = ['light', 'dark', 'system'] as const;
const themeFile = () => new File(Paths.document, 'nouty-theme.txt');

/** Tema del dispositivo (ADR 0029) en un archivo privado; solo un valor conocido. */
export function loadThemePreference(): (typeof themes)[number] | null {
  try {
    const stored = themeFile();
    const value = stored.exists ? stored.textSync().trim() : null;
    return themes.find((theme) => theme === value) ?? null;
  } catch {
    return null;
  }
}

export function saveThemePreference(preference: (typeof themes)[number]): void {
  try {
    themeFile().write(preference);
  } catch {
    // Sin almacenamiento, el tema dura la sesión.
  }
}

const locales = ['es', 'en'] as const;
const localeFile = () => new File(Paths.document, 'nouty-locale.txt');

/** Idioma de la interfaz (ADR 0032) en un archivo privado; solo un valor conocido. */
export function loadLocalePreference(): (typeof locales)[number] | null {
  try {
    const stored = localeFile();
    const value = stored.exists ? stored.textSync().trim() : null;
    return locales.find((locale) => locale === value) ?? null;
  } catch {
    return null;
  }
}

export function saveLocalePreference(locale: (typeof locales)[number]): void {
  try {
    localeFile().write(locale);
  } catch {
    // Sin almacenamiento, el idioma dura la sesión.
  }
}
