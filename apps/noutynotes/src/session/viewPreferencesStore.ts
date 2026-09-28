/**
 * Preferencias de vista del dispositivo en el navegador (ADR 0014). Sin almacenamiento disponible
 * (modo privado, bloqueado, render estático) devuelve null y la app usa los valores por defecto.
 */
const KEY = 'noutynotes.view.v1';

export function loadViewPreferences(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveViewPreferences(serialized: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, serialized);
  } catch {
    // Sin almacenamiento, la preferencia dura la sesión.
  }
}

const THEME_KEY = 'noutynotes.theme.v1';
const themes = ['light', 'dark', 'system'] as const;

/** Tema del dispositivo (ADR 0029): solo un valor conocido; cualquier otro, ninguno. */
export function loadThemePreference(): (typeof themes)[number] | null {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_KEY);
    return themes.find((theme) => theme === stored) ?? null;
  } catch {
    return null;
  }
}

export function saveThemePreference(preference: (typeof themes)[number]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Sin almacenamiento, el tema dura la sesión.
  }
}

const LOCALE_KEY = 'noutynotes.locale.v1';
const locales = ['es', 'en'] as const;

/** Idioma de la interfaz (ADR 0032): solo un valor conocido; cualquier otro, ninguno. */
export function loadLocalePreference(): (typeof locales)[number] | null {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCALE_KEY);
    return locales.find((locale) => locale === stored) ?? null;
  } catch {
    return null;
  }
}

export function saveLocalePreference(locale: (typeof locales)[number]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Sin almacenamiento, el idioma dura la sesión.
  }
}
