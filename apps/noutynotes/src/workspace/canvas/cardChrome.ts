/** Controles de la cabecera de las tarjetas y cara de la ficha minimizada (ADR 0016). Puro. */
import type { BaseCardKind, CardDisplayMode } from '@noutynotes/domain';

import type { Size } from './viewport';

/** Lado de cada control, en píxeles reales: fuera de la escala del zoom. */
export const CONTROL_SIZE = 44;
/** Separación entre los controles y el borde de la tarjeta o de la ficha. */
const INSET = 2;
const STRIP_GAP = 4;
/**
 * Franja de cabecera que se deja siempre libre para el tipo/número y para arrastrar (auditoría
 * visual, 2026-09-29): 44 px bastaban para agarrar la tarjeta, pero con el zoom alejado dejaban los
 * tres controles ocupando casi toda la cabecera, sin sitio legible para el tipo. Con más margen, una
 * tarjeta pequeña pasa antes al menú «⋯», que deja la cabecera legible en vez de tres botones apretados.
 */
const HEADER_FREE_SPACE = 80;

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
  /** Controles en la cabecera o un único menú «⋯» cuando no caben o la ficha está minimizada. */
  readonly kind: 'header' | 'menu';
  readonly left: number;
  readonly top: number;
  /** Botones que se dibujan. */
  readonly count: number;
}

/** Dónde van los controles de una tarjeta, o `null` si no lleva (ficha minimizada sin seleccionar). */
export function chromeFor(display: CardDisplayMode, box: ScreenBox, selected: boolean, viewport: Size): Chrome | null {
  const actions = cardActions(display);
  // Una ficha minimizada o demasiado pequeña conserva libre su cara. Al seleccionarla, solo aparece
  // «⋯» al lado: la tira anterior quedaba flotando con dos o tres acciones sobre el lienzo.
  const fitsInside = box.height >= CONTROL_SIZE + INSET * 2 && box.width >= CONTROL_SIZE + INSET * 2;
  if (display === 'minimized' || !fitsInside) {
    if (!selected) return null;
    const width = CONTROL_SIZE;
    const right = box.left + box.width + STRIP_GAP;
    const left = right + width <= viewport.width ? right : box.left - STRIP_GAP - width;
    return { kind: 'menu', left: Math.max(0, left), top: Math.max(0, Math.min(box.top, viewport.height - CONTROL_SIZE)), count: 1 };
  }
  // Los controles más una franja libre de cabecera por la que arrastrar y leer el tipo.
  const needed = actions.length * CONTROL_SIZE + INSET * 2 + HEADER_FREE_SPACE;
  if (box.width < needed) {
    return { kind: 'menu', left: box.left + box.width - CONTROL_SIZE - INSET, top: box.top + INSET, count: 1 };
  }
  return { kind: 'header', left: box.left + box.width - actions.length * CONTROL_SIZE - INSET, top: box.top + INSET, count: actions.length };
}

/** Icono propio de la ficha minimizada según la primitiva del tipo; sin él se muestra el título. */
export function miniIcon(base: BaseCardKind | undefined): 'note' | 'image' | null {
  return base === 'note' || base === 'image' ? base : null;
}

export interface EditChrome {
  readonly left: number;
  readonly top: number;
}

/**
 * Botón «Editar» adicional, solo con la tarjeta seleccionada (auditoría de interacción, 2026-09-29):
 * seleccionar ya no abre el editor por sí solo, así que hace falta una acción explícita y visible para
 * llegar a él. Esquina inferior izquierda, fuera de la escala del zoom: la superior ya se usa para
 * agarrar la tarjeta por la cabecera (a 20 px del borde, ADR 0016) y un primer intento ahí bloqueaba el
 * arrastre (reproducido el 2026-09-29, prueba táctil de arrastrar y redimensionar). Las asas de
 * redimensionar ocupan el borde derecho, el centro y la esquina inferior derecha, no la izquierda.
 * Solo en expandida/contraída: una ficha minimizada ya ofrece «Expandir» en su tira, y expandir dentro
 * del hueco actual antes de editar es su propio paso.
 */
export function editChromeFor(display: CardDisplayMode, box: ScreenBox, selected: boolean): EditChrome | null {
  if (!selected || display === 'minimized') return null;
  return { left: box.left + INSET, top: box.top + box.height - CONTROL_SIZE - INSET };
}
