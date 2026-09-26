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
