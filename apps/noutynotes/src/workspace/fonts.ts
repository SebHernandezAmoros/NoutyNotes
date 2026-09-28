/**
 * Tipografía de las notas (ADR 0030): fuentes del sistema, que funcionan sin conexión y no se
 * descargan de ningún servidor. Cada pila termina en una familia genérica que el sistema siempre
 * resuelve. «Personalizada» (ADR 0041, E7c) es la única excepción: una fuente TTF/OTF importada al
 * workspace y activada con la API `FontFace` del navegador (ver `session/customFont.ts`, web-only);
 * su pila también termina en una fuente del sistema, así que si no está activada el texto sigue legible.
 */
export type NoteFont = 'system' | 'serif' | 'mono' | 'custom';

/** Valores fijos en orden; su texto sale de `i18n.ts` (`settings.font.*`) con el idioma de la interfaz.
 * «custom» no está aquí: solo se ofrece cuando el workspace abierto ya tiene una fuente activada. */
export const NOTE_FONT_VALUES: readonly Exclude<NoteFont, 'custom'>[] = ['system', 'serif', 'mono'];

const stacks: Record<'web' | 'android' | 'ios', Record<'serif' | 'mono', string>> = {
  web: { serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' },
  android: { serif: 'serif', mono: 'monospace' },
  ios: { serif: 'Georgia', mono: 'Menlo' },
};

/**
 * Familia para el texto de las notas; con «Sistema», ninguna (la de la app). Con «Personalizada»,
 * `customFamily` es el nombre ya registrado en el navegador (`customFontFamilyName`, web); sin él
 * (otra plataforma, o la fuente no llegó a activarse en este dispositivo) cae a la reserva del sistema.
 */
export function noteFontFamily(font: NoteFont, platform: string, customFamily?: string): string | undefined {
  if (font === 'system') return undefined;
  if (font === 'custom') return customFamily ? `${customFamily}, Georgia, serif` : undefined;
  const byPlatform = platform === 'android' || platform === 'ios' ? stacks[platform] : stacks.web;
  return byPlatform[font];
}

export function isNoteFont(value: unknown): value is NoteFont {
  return value === 'system' || value === 'serif' || value === 'mono' || value === 'custom';
}
