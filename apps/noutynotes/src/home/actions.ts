/** Numeración «01», «02»… de las acciones visibles del inicio, en su orden. */
export function numberActions<K extends string>(visible: readonly K[]): Record<K, string> {
  return Object.fromEntries(visible.map((key, index) => [key, String(index + 1).padStart(2, '0')])) as Record<K, string>;
}

/**
 * Envuelve una operación asíncrona para que no se ejecute dos veces a la vez: mientras la primera
 * sigue en curso, otra llamada devuelve `null` sin hacer nada (evita crear dos espacios).
 */
export function singleFlight<A extends unknown[], T>(operation: (...args: A) => Promise<T>): ((...args: A) => Promise<T | null>) & { busy(): boolean } {
  let running = false;
  const run = async (...args: A): Promise<T | null> => {
    if (running) return null;
    running = true;
    try {
      return await operation(...args);
    } finally {
      running = false;
    }
  };
  return Object.assign(run, { busy: () => running });
}
