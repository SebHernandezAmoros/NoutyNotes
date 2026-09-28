import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Escape vuelve al tablero desde una vista de trabajo a pantalla completa (ADR 0036), igual que ya
 * hacía `Dialog` al cerrarse. Solo mientras la vista está activa: sigue montada (oculta) al salir, y
 * un Escape en otra vista activa no debe disparar este `onBack`.
 */
export function useEscapeBack(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onBack]);
}
