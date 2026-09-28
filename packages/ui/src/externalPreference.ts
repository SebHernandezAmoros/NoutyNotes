/**
 * Preferencia del dispositivo como almacén externo (ADR 0029, ADR 0032): apta para `useSyncExternalStore`,
 * así se lee después de montar y no rompe la hidratación del export estático. Sin React ni plataforma.
 */
export interface ExternalPreference<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createExternalPreference<T>(fallback: T, load?: () => T | null, save?: (value: T) => void): ExternalPreference<T> {
  let current: T | null = null;
  let read = false;
  const listeners = new Set<() => void>();
  return {
    get: () => {
      if (!read) {
        current = load?.() ?? fallback;
        read = true;
      }
      return current as T;
    },
    set: (next) => {
      current = next;
      read = true;
      save?.(next);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
