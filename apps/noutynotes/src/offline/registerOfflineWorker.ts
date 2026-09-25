import { Platform } from 'react-native';

const BUNDLE_PATH = '_expo/static/js/web/';

/**
 * Registra el service worker del export web (ADR 0011) para permitir arrancar sin conexión tras
 * una primera visita con red. La base se deduce del bundle servido, así que funciona bajo
 * `/NoutyNotes/` y en la raíz. El servidor de desarrollo sirve otro bundle y no hay worker.
 */
export function registerOfflineWorker(): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const source = document.querySelector<HTMLScriptElement>(`script[src*="/${BUNDLE_PATH}"]`)?.getAttribute('src');
  if (!source) return;
  const base = source.slice(0, source.indexOf(BUNDLE_PATH));
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
    // Sin worker la app funciona igual con conexión; el arranque sin red no queda disponible.
  });
}
