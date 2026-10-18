import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAssets } from '@noutynotes/application';
import type { AssetRef, WorkspaceId } from '@noutynotes/domain';

import { resolveImageResource, resolveImageResources } from './imageResources';

const id = 'demo' as WorkspaceId;
const asset = (value: string) => value as AssetRef;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fakeAssets(options: {
  readonly listed?: readonly string[];
  readonly listFails?: boolean;
  readonly bytes?: Readonly<Record<string, Uint8Array>>;
}): WorkspaceAssets & { readonly listCalls: number } {
  let listCalls = 0;
  return {
    get listCalls() { return listCalls; },
    writeAsset: vi.fn(),
    removeAsset: vi.fn(),
    async listAssets() {
      listCalls += 1;
      return options.listFails ? { ok: false, issues: [{ code: 'io-failure', path: 'id', message: 'fail' }] } : { ok: true, value: options.listed ?? [] };
    },
    async readAsset(_workspaceId: WorkspaceId, ref: AssetRef) {
      const bytes = options.bytes?.[ref];
      return bytes ? { ok: true, value: bytes } : { ok: false, issues: [{ code: 'io-failure', path: 'ref', message: 'no se pudo leer' }] };
    },
  } as unknown as WorkspaceAssets & { readonly listCalls: number };
}

describe('resolveImageResource (OBS-N2-IMAGE-FIT-F2)', () => {
  it('F2-02: bytes leídos y formato válido producen ready con una URI', async () => {
    const ref = asset('assets/images/a.png');
    const assets = fakeAssets({ listed: [ref], bytes: { [ref]: PNG } });
    const result = await resolveImageResource(assets, id, ref, new Set([ref]));
    expect(result).toEqual({ status: 'ready', uri: expect.stringContaining('data:image/png;base64,') });
  });

  it('F2-03: una referencia que listAssets no incluye produce missing/not-found, sin intentar leerla', async () => {
    const ref = asset('assets/images/ausente.png');
    const assets = fakeAssets({ listed: [] });
    const readSpy = vi.spyOn(assets, 'readAsset');
    const result = await resolveImageResource(assets, id, ref, new Set());
    expect(result).toEqual({ status: 'missing', reason: 'not-found' });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('F2-04: una referencia listada cuya lectura falla produce missing/unreadable, nunca not-found', async () => {
    const ref = asset('assets/images/sin-permiso.png');
    const assets = fakeAssets({ listed: [ref] });
    const result = await resolveImageResource(assets, id, ref, new Set([ref]));
    expect(result).toEqual({ status: 'missing', reason: 'unreadable' });
  });

  it('F2-05: bytes leídos pero con formato no decodificable producen missing/invalid-image', async () => {
    const ref = asset('assets/images/corrupto.png');
    const assets = fakeAssets({ listed: [ref], bytes: { [ref]: new Uint8Array([1, 2, 3]) } });
    const result = await resolveImageResource(assets, id, ref, new Set([ref]));
    expect(result).toEqual({ status: 'missing', reason: 'invalid-image' });
  });
});

describe('resolveImageResources — resolución por lote (OBS-N2-IMAGE-FIT-F2)', () => {
  it('F2-06: llama a listAssets exactamente una vez para todo el lote, no una vez por referencia', async () => {
    const refA = asset('assets/images/a.png');
    const refB = asset('assets/images/b.png');
    const refC = asset('assets/images/ausente.png');
    const assets = fakeAssets({ listed: [refA, refB], bytes: { [refA]: PNG, [refB]: PNG } });
    const resolved = await resolveImageResources(assets, id, [refA, refB, refC]);
    expect(assets.listCalls).toBe(1);
    expect(resolved.get(refA)).toMatchObject({ status: 'ready' });
    expect(resolved.get(refB)).toMatchObject({ status: 'ready' });
    expect(resolved.get(refC)).toEqual({ status: 'missing', reason: 'not-found' });
  });

  it('clasifica correctamente tres referencias con causas distintas en el mismo lote', async () => {
    const ready = asset('assets/images/a.png');
    const unreadable = asset('assets/images/b.png');
    const invalid = asset('assets/images/c.png');
    const notFound = asset('assets/images/d.png');
    const assets = fakeAssets({ listed: [ready, unreadable, invalid], bytes: { [ready]: PNG, [invalid]: new Uint8Array([9, 9]) } });
    const resolved = await resolveImageResources(assets, id, [ready, unreadable, invalid, notFound]);
    expect(resolved.get(ready)).toMatchObject({ status: 'ready' });
    expect(resolved.get(unreadable)).toEqual({ status: 'missing', reason: 'unreadable' });
    expect(resolved.get(invalid)).toEqual({ status: 'missing', reason: 'invalid-image' });
    expect(resolved.get(notFound)).toEqual({ status: 'missing', reason: 'not-found' });
  });

  it('si listAssets falla, ninguna referencia se marca not-found (no se afirma ausencia sin evidencia)', async () => {
    const ref = asset('assets/images/a.png');
    const assets = fakeAssets({ listFails: true });
    const resolved = await resolveImageResources(assets, id, [ref]);
    expect(resolved.get(ref)).toEqual({ status: 'missing', reason: 'unreadable' });
  });
});
