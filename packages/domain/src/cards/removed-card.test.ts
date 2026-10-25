import { expect, it } from 'vitest';
import { asset, id, unsafe } from '../__fixtures__/workspace';
import type { CardId, CardTypeId } from '../ids';
import { validateCard } from './card';
import type { Card } from './card';
import type { CardTypeDefinition } from './card-type';

const imageType: CardTypeDefinition = { id: id<CardTypeId>('image'), label: 'Imagen', base: 'image', fields: [] };
const retired = (extra: Record<string, unknown> = {}): Card => unsafe<Card>({
  id: id<CardId>('retired'), typeId: imageType.id, title: 'Mapa conservado', fields: {},
  primaryResourceState: { kind: 'retired', resourceKind: 'image' }, ...extra,
});

it('una retirada deliberada no puede conservar una referencia primaria cargable', () => {
  expect(validateCard(retired({ assetRefs: [asset('assets/images/mapa.png')] }), imageType).ok).toBe(false);
});

it.each(['image', 'pdf'] as const)('acepta recurso %s normal y retirado sin inferir retirada por inaccesibilidad', (kind) => {
  const type: CardTypeDefinition = { ...imageType, base: kind === 'pdf' ? 'file' : 'image' };
  const card = retired({ primaryResourceState: { kind: 'retired', resourceKind: kind }, content: 'Texto independiente', fields: {} });
  const checked = validateCard(card, type);
  expect(checked).toEqual({ ok: true, value: card });
  const { primaryResourceState: _retired, ...normal } = card;
  const missing = { ...normal, assetRefs: [asset(`assets/${kind === 'pdf' ? 'documents/missing.pdf' : 'images/missing.png'}`)] };
  expect(validateCard(missing, type)).toEqual({ ok: true, value: missing });
  expect(missing).not.toHaveProperty('primaryResourceState');
});

it('rechaza discriminantes, tipos y claves incompatibles sin ampliar a Notas/audio', () => {
  for (const state of [null, { kind: 'missing', resourceKind: 'image' }, { kind: 'retired', resourceKind: 'audio' }, { kind: 'retired', resourceKind: 'image', assetRef: 'assets/a.png' }]) {
    expect(validateCard(retired({ primaryResourceState: state }), imageType).ok).toBe(false);
  }
  expect(validateCard(retired(), { ...imageType, base: 'note' }).ok).toBe(false);
  expect(validateCard(retired({ primaryResourceState: { kind: 'retired', resourceKind: 'pdf' } }), imageType).ok).toBe(false);
});

it('rechaza carriers en cuerpo o campos sin limpiarlos ni perder su contenido', () => {
  const markdown = retired({ content: '![imagen](assets/images/old.png)' });
  const rich = retired({ contentDocument: { schemaVersion: 1, blocks: [{ type: 'image', assetRef: 'assets/images/old.png', alt: 'Histórica' }] } });
  expect(validateCard(markdown, imageType).ok).toBe(false);
  expect(validateCard(rich, imageType).ok).toBe(false);
  const typed = { ...imageType, fields: [{ key: 'resource' as CardTypeDefinition['fields'][number]['key'], kind: 'asset' as const }] };
  const withField = retired({ fields: { resource: 'assets/images/old.png' } });
  const before = JSON.stringify(withField);
  expect(validateCard(withField, typed).ok).toBe(false);
  expect(JSON.stringify(withField)).toBe(before);
});
