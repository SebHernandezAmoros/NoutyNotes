import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Dimensions, Keyboard, Platform, TextInput } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/**
 * Alto que tapa el teclado en pantalla, desde el borde inferior de la ventana (nativo). Con edge-to-edge (Android 15, RN 0.86) la ventana ya no se
 * redimensiona al abrirlo: sin reservar este alto, el teclado tapa la hoja del editor y su campo.
 * En web devuelve 0 (el navegador gestiona su propio teclado).
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      // Lo que tapa, medido desde su borde superior: `height` no incluye la barra del sistema.
      const covered = Dimensions.get('window').height - event.endCoordinates.screenY;
      setHeight(covered > 0 ? covered : event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/**
 * Tras reservar el alto del teclado, la hoja encoge después de que Android haya desplazado el campo
 * enfocado: se vuelve a llevar ese campo dentro de la parte visible del `ScrollView`.
 */
export function useRevealFocusedInput(keyboard: number, scroll: RefObject<ScrollView | null>) {
  const offset = useRef(0);
  useEffect(() => {
    if (keyboard === 0) return undefined;
    const timer = setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput();
      // La instancia de ScrollView no se mide: su nodo nativo sí.
      const view = scroll.current?.getNativeScrollRef();
      if (!input || !view) return;
      input.measureInWindow((_x, top, _width, height) => {
        view.measureInWindow((_sx, viewTop, _sw, viewHeight) => {
          const margin = 12;
          const below = top + height - (viewTop + viewHeight - margin);
          const above = viewTop + margin - top;
          if (below > 0) scroll.current?.scrollTo({ y: offset.current + below, animated: true });
          else if (above > 0) scroll.current?.scrollTo({ y: Math.max(0, offset.current - above), animated: true });
        });
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [keyboard, scroll]);
  /** Para el `onScroll` del `ScrollView`: recuerda el desplazamiento actual. */
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; };
}
