import { Platform } from 'react-native';

/**
 * Imprimir en Android (ADR 0043): `expo-print` acepta el mismo HTML que ya genera `printHtml.ts` para
 * web, y el diálogo nativo del sistema incluye «Guardar como PDF» entre sus destinos — no exige una
 * impresora física. Documentado como compatible con Android por la documentación oficial de Expo;
 * sin emulador en esta sesión, queda «implementada, validada en web, APK pendiente» como el resto de
 * funciones nativas del proyecto.
 */
export function supportsNativePrint(): boolean {
  return Platform.OS === 'android';
}

/** Abre el diálogo nativo de impresión con el HTML dado. `true` si se pudo mostrar. */
export async function printHtmlNative(html: string): Promise<boolean> {
  if (!supportsNativePrint()) return false;
  try {
    const { printAsync } = await import('expo-print');
    await printAsync({ html });
    return true;
  } catch {
    return false;
  }
}
