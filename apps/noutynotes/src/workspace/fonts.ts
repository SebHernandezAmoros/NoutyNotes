/**
 * Tipografía de las notas (ADR 0030): solo fuentes del sistema, que funcionan sin conexión y no se
 * descargan de ningún servidor. Cada pila termina en una familia genérica que el sistema siempre resuelve.
 */
export type NoteFont = 'system' | 'serif' | 'mono';

/** Valores en orden fijo; su texto sale de `i18n.ts` (`settings.font.*`) con el idioma de la interfaz. */
export const NOTE_FONT_VALUES: readonly NoteFont[] = ['system', 'serif', 'mono'];

const stacks: Record<'web' | 'android' | 'ios', Record<Exclude<NoteFont, 'system'>, string>> = {
  web: { serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' },
  android: { serif: 'serif', mono: 'monospace' },
  ios: { serif: 'Georgia', mono: 'Menlo' },
};

/** Familia para el texto de las notas; con «Sistema», ninguna (la de la app). */
export function noteFontFamily(font: NoteFont, platform: string): string | undefined {
  if (font === 'system') return undefined;
  const byPlatform = platform === 'android' || platform === 'ios' ? stacks[platform] : stacks.web;
  return byPlatform[font];
}

export function isNoteFont(value: unknown): value is NoteFont {
  return value === 'system' || value === 'serif' || value === 'mono';
}
