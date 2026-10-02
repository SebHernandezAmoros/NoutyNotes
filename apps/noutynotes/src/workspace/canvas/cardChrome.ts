/** Controles de la cabecera de las tarjetas y cara de la ficha minimizada (ADR 0016). Puro. */
import type { BaseCardKind, CardDisplayMode } from '@noutynotes/domain';
import type { Locale } from '@noutynotes/ui';

import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { Size } from './viewport';

/** Lado de cada control, en píxeles reales: fuera de la escala del zoom. */
export const CONTROL_SIZE = 44;
/** Separación entre los controles y el borde de la tarjeta o de la ficha. */
const INSET = 2;
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
  /** Clave i18n del verbo del nombre accesible: «Minimizar X», … La Papelera usa «Enviar X a la Papelera». */
  readonly verbKey: TranslationKey;
}

const MINIMIZE: CardAction = { kind: 'minimized', glyph: '−', verbKey: 'cardAction.minimize' };
const COLLAPSE: CardAction = { kind: 'collapsed', glyph: '▭', verbKey: 'cardAction.collapse' };
const EXPAND: CardAction = { kind: 'expanded', glyph: '□', verbKey: 'cardAction.expand' };
const TRASH: CardAction = { kind: 'trash', glyph: '×', verbKey: 'cardAction.trashVerb' };

/** Acciones de cada estado. «×» envía a la Papelera; eliminar definitivamente solo se hace desde ella. */
export function cardActions(display: CardDisplayMode): readonly CardAction[] {
  if (display === 'expanded') return [MINIMIZE, COLLAPSE, TRASH];
  if (display === 'collapsed') return [MINIMIZE, EXPAND, TRASH];
  return [EXPAND, TRASH];
}

export function actionVerb(action: CardAction, locale: Locale): string {
  return t(action.verbKey, locale);
}

export function actionLabel(action: CardAction, title: string, locale: Locale): string {
  return action.kind === 'trash' ? t('cardAction.trash.label', locale, { title }) : `${actionVerb(action, locale)} ${title}`;
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
  // La selección reduce siempre la cabecera a una sola entrada contextual. Evita tiras duplicadas
  // y mantiene las acciones, la edición y la organización en un lugar predecible (ADR 0047).
  if (selected) {
    // En una ficha minimizada o una barra muy baja, el control no debe cubrir el icono/título ni
    // interceptar el segundo toque. Se coloca junto a la ficha, en el lado que tenga espacio.
    if (display === 'minimized' || box.height < CONTROL_SIZE + INSET * 2) {
      const right = box.left + box.width + INSET;
      const left = right + CONTROL_SIZE <= viewport.width ? right : Math.max(0, box.left - CONTROL_SIZE - INSET);
      return { kind: 'menu', left, top: Math.max(0, Math.min(box.top + INSET, viewport.height - CONTROL_SIZE)), count: 1 };
    }
    const left = Math.max(0, Math.min(box.left + box.width - CONTROL_SIZE - INSET, viewport.width - CONTROL_SIZE));
    return { kind: 'menu', left, top: Math.max(0, Math.min(box.top + INSET, viewport.height - CONTROL_SIZE)), count: 1 };
  }
  // Una ficha minimizada o demasiado pequeña conserva libre su cara. Al seleccionarla, solo aparece
  // «⋯» al lado: la tira anterior quedaba flotando con dos o tres acciones sobre el lienzo.
  const fitsInside = box.height >= CONTROL_SIZE + INSET * 2 && box.width >= CONTROL_SIZE + INSET * 2;
  if (display === 'minimized' || !fitsInside) {
    return null;
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

