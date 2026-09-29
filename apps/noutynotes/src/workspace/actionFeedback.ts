/**
 * Aviso de una acción de edición (ADR 0044, E7f): compone la etiqueta de deshacer/rehacer y el texto
 * del aviso a partir de una clave de traducción, no de una frase en español ya formada. Módulo puro,
 * sin `Platform` ni hooks: `useWorkspaceEditor.ts` le pasa `locale` (de `useLocale()`) y el modo.
 */
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { Locale } from '@noutynotes/ui';

export type StorageMode = 'memory' | 'folder';

export type ActionSuccess =
  | TranslationKey
  | { readonly key: TranslationKey; readonly params?: Readonly<Record<string, string>> }
  /** Ya resuelta por quien llama (p. ej. un plural con `unit()`): sin clave que buscar. */
  | { readonly label: string };

function resolveLabel(success: ActionSuccess, locale: Locale): string {
  if (typeof success === 'string') return t(success, locale);
  return 'label' in success ? success.label : t(success.key, locale, success.params);
}

/** «Guardado en memoria.» / «Guardado en la carpeta.» (o su inglés), ya traducido. */
export function savedSuffix(mode: StorageMode, locale: Locale): string {
  return t(mode === 'folder' ? 'workview.savedIn.folder' : 'workview.savedIn.memory', locale);
}

/** Aviso simple: «Etiqueta. Guardado en X.» a partir de una etiqueta sin punto final. */
export function composeSaved(label: string, mode: StorageMode, locale: Locale): string {
  return `${label}. ${savedSuffix(mode, locale)}`;
}

/** Aviso con notas ya formadas (cada una con su propio punto): «Etiqueta. nota1. nota2. Guardado en X.» */
export function composeSavedWithNotes(label: string, notes: readonly string[], mode: StorageMode, locale: Locale): string {
  const body = notes.length > 0 ? `${label}. ${notes.join(' ')}` : `${label}.`;
  return `${body} ${savedSuffix(mode, locale)}`;
}

/** Etiqueta (para deshacer/rehacer) y aviso completo, a partir de la `ActionSuccess` que recibe `run()`. */
export function resolveAction(success: ActionSuccess, mode: StorageMode, locale: Locale): { readonly label: string; readonly text: string } {
  const label = resolveLabel(success, locale);
  return { label, text: composeSaved(label, mode, locale) };
}
