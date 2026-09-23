import { useSyncExternalStore } from 'react';

import type { ThemeMode } from './theme';

let colorSchemeQuery: MediaQueryList | undefined;

function getQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || !window.matchMedia) return undefined;
  colorSchemeQuery ??= window.matchMedia('(prefers-color-scheme: dark)');
  return colorSchemeQuery;
}

function subscribe(onChange: () => void): () => void {
  const query = getQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function getSnapshot(): ThemeMode {
  return getQuery()?.matches ? 'dark' : 'light';
}

function getServerSnapshot(): ThemeMode {
  return 'light';
}

export function useSystemTheme(): ThemeMode {
  // React vuelve a comprobar el valor al suscribirse y mantiene estable la hidratación.
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
