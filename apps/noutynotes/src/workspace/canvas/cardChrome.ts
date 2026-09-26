/** Controles de la cabecera de las tarjetas y cara de la ficha minimizada (ADR 0016). Puro. */
import type { BaseCardKind, CardDisplayMode } from '@noutynotes/domain';

import type { Size } from './viewport';

/** Lado de cada control, en píxeles reales: fuera de la escala del zoom. */
export const CONTROL_SIZE = 44;
/** Separación entre los controles y el borde de la tarjeta o de la ficha. */
const INSET = 2;
const STRIP_GAP = 4;

export interface CardAction {
  readonly kind: CardDisplayMode | 'trash';
  readonly glyph: string;
  /** Verbo del nombre accesible: «Minimizar X», … La Papelera usa «Enviar X a la Papelera». */
  readonly verb: string;
}

const MINIMIZE: CardAction = { kind: 'minimized', glyph: '−', verb: 'Minimizar' };
const COLLAPSE: CardAction = { kind: 'collapsed', glyph: '▭', verb: 'Contraer' };
const EXPAND: CardAction = { kind: 'expanded', glyph: '□', verb: 'Expandir' };
const TRASH: CardAction = { kind: 'trash', glyph: '×', verb: 'Enviar a la Papelera' };

/** Acciones de cada estado. «×» envía a la Papelera; eliminar definitivamente solo se hace desde ella. */
export function cardActions(display: CardDisplayMode): readonly CardAction[] {
  if (display === 'expanded') return [MINIMIZE, COLLAPSE, TRASH];
  if (display === 'collapsed') return [MINIMIZE, EXPAND, TRASH];
  return [EXPAND, TRASH];
}

export function actionLabel(action: CardAction, title: string): string {
  return action.kind === 'trash' ? `Enviar ${title} a la Papelera` : `${action.verb} ${title}`;
}

/** Rectángulo en píxeles de pantalla (ya con pan y zoom). */
export interface ScreenBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Chrome {
  /** Controles en la cabecera, un menú «⋯» si no caben, o una tira junto a la ficha minimizada. */
  readonly kind: 'header' | 'menu' | 'strip';
  readonly left: number;
  readonly top: number;
  /** Botones que se dibujan. */
  readonly count: number;
}

/** Dónde van los controles de una tarjeta, o `null` si no lleva (ficha minimizada sin seleccionar). */
export function chromeFor(display: CardDisplayMode, box: ScreenBox, selected: boolean, viewport: Size): Chrome | null {
  const actions = cardActions(display);
  // Ni siquiera un «⋯» cabe dentro (ficha minimizada, o barra/tarjeta pequeña con el zoom alejado):
  // los controles no se sacan encima de otras tarjetas; van en una tira al lado y solo seleccionada.
  const fitsInside = box.height >= CONTROL_SIZE + INSET * 2 && box.width >= CONTROL_SIZE + INSET * 2;
  if (display === 'minimized' || !fitsInside) {
    if (!selected) return null;
    const width = actions.length * CONTROL_SIZE;
    const right = box.left + box.width + STRIP_GAP;
    const left = right + width <= viewport.width ? right : box.left - STRIP_GAP - width;
    return { kind: 'strip', left, top: box.top, count: actions.length };
  }
  // Los tres controles más una franja libre de cabecera (44 px) por la que arrastrar la tarjeta.
  const needed = actions.length * CONTROL_SIZE + INSET * 2 + CONTROL_SIZE;
  if (box.width < needed) {
    return { kind: 'menu', left: box.left + box.width - CONTROL_SIZE - INSET, top: box.top + INSET, count: 1 };
  }
  return { kind: 'header', left: box.left + box.width - actions.length * CONTROL_SIZE - INSET, top: box.top + INSET, count: actions.length };
}

/** Icono propio de la ficha minimizada según la primitiva del tipo; sin él se muestra el título. */
export function miniIcon(base: BaseCardKind | undefined): 'note' | 'image' | null {
  return base === 'note' || base === 'image' ? base : null;
}
