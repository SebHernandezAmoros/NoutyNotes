import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` en el HTML estático y durante la hidratación; `true` cuando la app ya responde. Permite
 * bloquear campos que el render del cliente reemplazaría y cuyo texto se perdería.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
