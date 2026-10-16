/**
 * Historial de recientes del dispositivo en el navegador (UX7-E1). Mismo patrón que
 * `viewPreferencesStore.ts`: solo local, nunca sincroniza; sin almacenamiento disponible (modo
 * privado, bloqueado, render estático) devuelve null y la app usa el registro vacío.
 */
const KEY = 'noutynotes.recents.v1';

export function loadRecentItems(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveRecentItems(serialized: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, serialized);
  } catch {
    // Sin almacenamiento, el historial dura la sesión.
  }
}
