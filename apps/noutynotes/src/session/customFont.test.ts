import { afterEach, expect, it, vi } from 'vitest';
import { activateCustomFont, customFontFamilyName } from './customFont';

afterEach(() => vi.unstubAllGlobals());
it('no reutiliza una familia homónima con bytes distintos', async () => {
  const faces = new Set();
  vi.stubGlobal('document', { fonts: faces });
  vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} async load() { return this; } });
  await activateCustomFont('assets/fonts/same.ttf', new Uint8Array([1]));
  const first = customFontFamilyName('assets/fonts/same.ttf');
  await activateCustomFont('assets/fonts/same.ttf', new Uint8Array([2]));
  expect(customFontFamilyName('assets/fonts/same.ttf')).not.toBe(first);
  expect(faces.size).toBe(2);
});

it('una carga antigua que termina tarde no sustituye la selección más reciente', async () => {
  const pending: (() => void)[] = [];
  vi.stubGlobal('document', { fonts: new Set() });
  vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} load() { return new Promise<void>((resolve) => pending.push(resolve)); } });
  const first = activateCustomFont('assets/fonts/race.ttf', new Uint8Array([1]));
  const second = activateCustomFont('assets/fonts/race.ttf', new Uint8Array([2]));
  pending[1]!(); await second;
  const selected = customFontFamilyName('assets/fonts/race.ttf');
  pending[0]!(); await first;
  expect(customFontFamilyName('assets/fonts/race.ttf')).toBe(selected);
});
