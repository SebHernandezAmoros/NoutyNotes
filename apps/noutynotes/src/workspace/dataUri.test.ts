import { describe, expect, it } from 'vitest';

import { dataUri } from './dataUri';

describe('vista previa sin red: data URI', () => {
  it('codifica en base64 con relleno, igual que la codificación estándar', () => {
    expect(dataUri('image/png', new TextEncoder().encode('Man'))).toBe('data:image/png;base64,TWFu');
    expect(dataUri('image/gif', new TextEncoder().encode('Ma'))).toBe('data:image/gif;base64,TWE=');
    expect(dataUri('image/gif', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('data:image/gif;base64,/9j/AA==');
  });
});
