// Constructores deterministas de layouts para pruebas del motor de grilla.
import type { BoardId, CardId } from '../ids';
import type { BoardLayout, CardDisplayMode, CardPlacement } from '../layouts/layout';

export function place(cardId: string, x: number, y: number, w: number, h: number, display: CardDisplayMode = 'expanded'): CardPlacement {
  return { cardId: cardId as CardId, rect: { x, y, w, h }, display };
}

export function layoutOf(...placements: CardPlacement[]): BoardLayout {
  return { boardId: 'board' as BoardId, placements };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Generador congruencial con semilla: casos variados pero reproducibles, solo en pruebas. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
