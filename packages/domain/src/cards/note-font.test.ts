import { expect, it } from 'vitest';
import type { Card } from './card';
import { ideaA, noteType, unsafe } from '../__fixtures__/workspace';
import { validateCard } from './card';

it('acepta fuentes enumeradas o Assets y rechaza familias CSS y referencias externas', () => {
  for (const noteFont of [{ kind: 'builtin', family: 'serif' }, { kind: 'asset', assetRef: 'assets/fonts/a.woff2' }]) expect(validateCard(unsafe<Card>({ ...ideaA, noteFont }), noteType).ok).toBe(true);
  for (const noteFont of [{ kind: 'builtin', family: 'arbitrary' }, { kind: 'asset', assetRef: 'https://example.com/a.ttf' }, { kind: 'asset', assetRef: 'assets/a.pdf' }, { kind: 'builtin', family: 'mono', style: 'url(x)' }]) expect(validateCard(unsafe<Card>({ ...ideaA, noteFont }), noteType).ok).toBe(false);
});
