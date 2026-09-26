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
