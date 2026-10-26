import { expect, it } from 'vitest';
import { ideaA, unsafe, validWorkspace } from '../__fixtures__/workspace';
import { updateCardAppearance } from './operations';
import type { CardAppearanceChanges } from './operations';
import { resolveNoteBackground } from './card';

it('cambia solo el fondo explícito sin reescribir marco, título, cuerpo ni contenido histórico', () => {
  const source = validWorkspace();
  const before = structuredClone(source);
  const changed = updateCardAppearance(source, ideaA.id, unsafe<CardAppearanceChanges>({ noteBackground: 'transparent' }));
  expect(changed.ok).toBe(true);
  if (changed.ok) expect(changed.value.cards[0]).toEqual({ ...ideaA, noteBackground: 'transparent' });
  expect(source).toEqual(before);
});

it('preserva el aspecto heredado en ausencia del campo y separa marco y fondo cuando es explícito', () => {
  expect(resolveNoteBackground({}, 'note')).toBe('paper');
  expect(resolveNoteBackground({ frameOverride: 'hidden' }, 'note')).toBe('paper');
  const historical = { frameOverride: 'hidden' as const, titleVisibility: 'hidden' as const, bodyVisibility: 'visible' as const };
  expect(resolveNoteBackground(historical, 'note')).toBe('transparent');
  expect(resolveNoteBackground({ ...historical, noteBackground: 'paper' }, 'note')).toBe('paper');
  expect(resolveNoteBackground({ ...historical, frameOverride: 'visible', noteBackground: 'transparent' }, 'note')).toBe('transparent');
});

it('rechaza valores ajenos al contrato y permite volver a la representación heredada', () => {
  const source = validWorkspace();
  expect(updateCardAppearance(source, ideaA.id, unsafe<CardAppearanceChanges>({ noteBackground: 'red' })).ok).toBe(false);
  const explicit = updateCardAppearance(source, ideaA.id, { noteBackground: 'transparent' });
  if (!explicit.ok) throw new Error('No se aplicó el fondo');
  expect(updateCardAppearance(explicit.value, ideaA.id, { noteBackground: null })).toEqual({ ok: true, value: source });
});

it('mostrar marco en una Nota transparente histórica conserva el fondo sin cambiar su contenido', () => {
  const original = { ...ideaA, frameOverride: 'hidden' as const, titleVisibility: 'hidden' as const, bodyVisibility: 'visible' as const };
  const source = { ...validWorkspace(), cards: [original, validWorkspace().cards[1]!] };
  const changed = updateCardAppearance(source, ideaA.id, { frameOverride: 'visible' });
  expect(changed.ok).toBe(true);
  if (changed.ok) expect(changed.value.cards[0]).toEqual({ ...original, frameOverride: 'visible', noteBackground: 'transparent' });
});
