import { File, Paths } from 'expo-file-system';

/** Historial de recientes en un JSON privado de la app (UX7-E1); nunca en el workspace. */
const file = () => new File(Paths.document, 'nouty-recents.json');

export function loadRecentItems(): string | null {
  try {
    const stored = file();
    return stored.exists ? stored.textSync() : null;
  } catch {
    return null;
  }
}

export function saveRecentItems(serialized: string): void {
  try {
    file().write(serialized);
  } catch {
    // Sin almacenamiento, el historial dura la sesión.
  }
}
