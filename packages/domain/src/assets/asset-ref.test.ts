import { describe, expect, it } from 'vitest';

import { problems } from '../__fixtures__/workspace';
import { isValidAssetRef, parseAssetRef } from './asset-ref';

describe('referencias a assets', () => {
  it.each(['assets/images/hero.png', 'assets/files/Informe final.pdf', 'README.md', 'assets/ñandú.webp'])(
    'acepta la ruta relativa %s sin modificarla',
    (value) => {
      const result = parseAssetRef(value);
      expect(result).toEqual({ ok: true, value });
    },
  );

  it.each([
    ['vacía', ''],
    ['absoluta', '/assets/a.png'],
    ['unidad Windows', 'C:/assets/a.png'],
    ['separador Windows', 'assets\\a.png'],
    ['sale del workspace', '../secret.txt'],
    ['subida intermedia', 'assets/../../x.png'],
    ['segmento actual', './assets/a.png'],
    ['segmento vacío', 'assets//a.png'],
    ['URL remota', 'https://example.com/a.png'],
    ['data URI', 'data:image/png;base64,AAAA'],
    ['file URI', 'file:///tmp/a.png'],
    ['caracter de control', 'assets/a\u0000.png'],
    ['espacios en segmento', 'assets/ a.png'],
    ['no texto', 7],
  ])('rechaza %s', (_case, value) => {
    expect(isValidAssetRef(value)).toBe(false);
    expect(problems(parseAssetRef(value))).toEqual(['invalid-asset-ref@assetRef']);
  });
});
