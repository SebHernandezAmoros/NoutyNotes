import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';

function subscribe(onChange: () => void): () => void {
  const subscription = Dimensions.addEventListener('change', onChange);
  return () => subscription.remove();
}

function getSnapshot(): number {
  return Dimensions.get('window').width;
}

function getServerSnapshot(): null {
  return null;
}

/**
 * Ancho de ventana apto para hidratar HTML estático. El render estático no conoce el
 * viewport y react-native-web informa 0; la hidratación de React no corrige atributos de
 * estilo distintos a los del HTML. Con el snapshot de servidor, cliente y HTML coinciden al
 * hidratar y React vuelve a renderizar con la medida real justo después.
 */
export function useWindowWidth(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
