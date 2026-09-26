import type { CardId, Relation, RelationId, RelationTypeId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { connectTarget, connectTap } from './connect';

const card = (value: string) => value as CardId;
const relation = (id: string, from: string, to: string): Relation => ({
  id: id as RelationId, typeId: 'relacionada' as RelationTypeId, from: card(from), to: card(to),
});
const relations = [relation('relacion-1', 'a', 'b')];

describe('herramienta Conectar (ADR 0013)', () => {
  it('el primer toque elige el origen y no hace nada más', () => {
    expect(connectTap(null, card('a'), relations)).toEqual({ source: card('a'), action: null });
  });

  it('el segundo toque conecta si no existe la relación en ese sentido', () => {
    expect(connectTap(card('a'), card('c'), relations)).toEqual({ source: null, action: { kind: 'connect', from: 'a', to: 'c' } });
    // El sentido importa: b → a no existe aunque exista a → b.
    expect(connectTap(card('b'), card('a'), relations)).toEqual({ source: null, action: { kind: 'connect', from: 'b', to: 'a' } });
  });

  it('el segundo toque desconecta si la relación ya existe', () => {
    expect(connectTap(card('a'), card('b'), relations)).toEqual({ source: null, action: { kind: 'disconnect', relationId: 'relacion-1' } });
  });

  it('tocar de nuevo el origen cancela', () => {
    expect(connectTap(card('a'), card('a'), relations)).toEqual({ source: null, action: null });
  });

  it('marca cada tarjeta como origen, objetivo para conectar u objetivo para desconectar', () => {
    expect(connectTarget(null, card('b'), relations)).toBe('none');
    expect(connectTarget(card('a'), card('a'), relations)).toBe('source');
    expect(connectTarget(card('a'), card('b'), relations)).toBe('disconnect');
    expect(connectTarget(card('a'), card('c'), relations)).toBe('connect');
  });
});
