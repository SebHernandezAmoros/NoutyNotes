import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';

import { createExternalPreference } from './externalPreference';

export type Locale = 'es' | 'en';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  /**
   * Preferencia guardada en el dispositivo (ADR 0032), como el tema. Se lee después de montar: el export
   * estático se genera sin almacenamiento y leerla al renderizar rompería la hidratación.
   */
  readonly load?: () => Locale | null;
  readonly save?: (locale: Locale) => void;
}

/** Idioma de la interfaz, del dispositivo (ADR 0032). El contenido de las notas nunca se traduce. */
export function LocaleProvider({ children, load, save }: PropsWithChildren<LocaleProviderProps>) {
  const [store] = useState(() => createExternalPreference<Locale>('es', load, save));
  const locale = useSyncExternalStore(store.subscribe, store.get, () => 'es' as const);
  const value = useMemo(() => ({ locale, setLocale: store.set }), [locale, store]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale requiere LocaleProvider.');
  return value;
}
