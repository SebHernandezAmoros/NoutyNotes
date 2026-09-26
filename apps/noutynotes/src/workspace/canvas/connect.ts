import type { CardId, Relation, RelationId } from '@noutynotes/domain';

/** Herramienta Conectar (ADR 0013): primer toque, origen; segundo, conectar o desconectar. Puro. */

export type ConnectAction =
  | { readonly kind: 'connect'; readonly from: CardId; readonly to: CardId }
  | { readonly kind: 'disconnect'; readonly relationId: RelationId };

const existing = (relations: readonly Relation[], from: CardId, to: CardId) =>
  relations.find((relation) => relation.from === from && relation.to === to);

export function connectTap(
  source: CardId | null, tapped: CardId, relations: readonly Relation[],
): { readonly source: CardId | null; readonly action: ConnectAction | null } {
  if (source === null) return { source: tapped, action: null };
  if (source === tapped) return { source: null, action: null };
  const found = existing(relations, source, tapped);
  return { source: null, action: found ? { kind: 'disconnect', relationId: found.id } : { kind: 'connect', from: source, to: tapped } };
}

export type ConnectRole = 'none' | 'source' | 'connect' | 'disconnect';

/** Cómo se marca una tarjeta mientras se conecta. */
export function connectTarget(source: CardId | null, card: CardId, relations: readonly Relation[]): ConnectRole {
  if (source === null) return 'none';
  if (source === card) return 'source';
  return existing(relations, source, card) ? 'disconnect' : 'connect';
}
