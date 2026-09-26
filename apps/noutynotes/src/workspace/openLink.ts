import { normalizeLinkUrl } from '@noutynotes/domain';
import { Linking } from 'react-native';

/**
 * Abre un enlace de tarjeta (ADR 0020) con el sistema: en Android, la app que lo gestione; en web, una
 * pestaña nueva con `noopener`. Solo se abren direcciones admitidas (`http(s)` o `mailto`), aunque el
 * archivo se haya editado a mano. Devuelve si el sistema aceptó abrirlo.
 */
export async function openLink(url: string): Promise<boolean> {
  const checked = normalizeLinkUrl(url);
  if (!checked.ok || checked.value !== url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
