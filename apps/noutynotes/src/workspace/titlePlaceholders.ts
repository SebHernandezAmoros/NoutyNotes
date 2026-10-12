import { PROTOTYPE_CARD_PRESETS } from '@noutynotes/application';

/**
 * UX7-REFINEMENT-A/CORRECTION: títulos de marcador de posición de `PROTOTYPE_CARD_PRESETS` («Nueva
 * nota», «Nuevo título», …), tratados como «sin título real» al decidir si un editor de título empieza
 * colapsado o expandido — compartido entre `CardInspector.tsx` e `InlineCardEditor.tsx` para no
 * duplicar la lista ni arriesgar que se desincronicen.
 */
export const PLACEHOLDER_TITLES = new Set(
  Object.values(PROTOTYPE_CARD_PRESETS).map((preset) => preset.title).filter((value): value is string => typeof value === 'string'),
);

export function isPlaceholderTitle(value: string): boolean {
  return PLACEHOLDER_TITLES.has(value.trim());
}
