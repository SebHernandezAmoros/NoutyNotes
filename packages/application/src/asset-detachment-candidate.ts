import { validateWorkspace } from '@noutynotes/domain';
import type { Card, RichTextBlock, Workspace } from '@noutynotes/domain';
import { analyzeAssetReferences } from './asset-reference-analysis';
import { planAssetDetachment } from './asset-detachment-plan';
import type { AssetDetachmentPlan, AssetDetachmentPlanInput } from './asset-detachment-plan';

export type AssetDetachmentCandidate = {
  readonly plan: AssetDetachmentPlan;
  readonly executionAllowed: false;
} & (
  | { readonly status: 'blocked'; readonly reasons: readonly string[] }
  | { readonly status: 'prepared-copy'; readonly snapshot: Workspace }
);

/** In-memory rehearsal only. Never accepts a storage port or authorizes persistence/purge. */
export function prepareAssetDetachmentCandidate(input: AssetDetachmentPlanInput): AssetDetachmentCandidate {
  // Rebuild from source; never trust an edited plan or reuse positional keys on another snapshot.
  const plan = planAssetDetachment(input);
  const blocked = (reasons: readonly string[]): AssetDetachmentCandidate => ({ status: 'blocked', plan, executionAllowed: false, reasons });
  if (plan.status === 'stale' || plan.status === 'unresolved') return blocked(plan.blockers);
  if (plan.carriers.some((carrier) => carrier.proposal === 'unresolved')) return blocked(['Hay referencias auxiliares sin transformación.']);
  const copy = structuredClone(input.snapshot);
  const transform = (card: Card, collection: 'active' | 'archive' | 'trash'): Card => {
    const ownerId = JSON.stringify([copy.id, collection, card.id]);
    const entries = plan.entries.filter((entry) => entry.ownerId === ownerId);
    if (entries.length === 0) return card;
    const retained = entries.find((entry) => entry.proposal.kind === 'retire-card');
    const withoutTarget = { ...card, ...(card.assetRefs === undefined ? {} : { assetRefs: card.assetRefs.filter((ref) => ref !== input.assetRef) }) };
    if (retained?.proposal.kind === 'retire-card') return { ...withoutTarget, primaryResourceState: retained.proposal.state };
    if (!card.contentDocument) return card; // Validation below refuses any unhandled occurrence.
    const changes = new Map(entries.map((entry) => [entry.locator, entry.proposal]));
    const blocks = card.contentDocument.blocks.flatMap((block, index): readonly RichTextBlock[] => {
      const change = changes.get(`contentDocument.blocks:${index}`);
      if (change?.kind === 'keep-marker') return [change.marker];
      if (change?.kind === 'remove-block') return [];
      return [block];
    });
    return { ...withoutTarget, contentDocument: {
      ...card.contentDocument,
      schemaVersion: blocks.some((block) => block.type === 'retired-image') ? 3 : card.contentDocument.schemaVersion,
      blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', content: [] }],
    } };
  };
  const snapshot: Workspace = {
    ...copy, cards: copy.cards.map((card) => transform(card, 'active')),
    ...(copy.archive === undefined ? {} : { archive: copy.archive.map((entry) => ({ ...entry, card: transform(entry.card, 'archive') })) }),
    ...(copy.trash === undefined ? {} : { trash: copy.trash.map((entry) => ({ ...entry, card: transform(entry.card, 'trash') })) }),
  };
  if (!validateWorkspace(snapshot).ok) return blocked(['La copia propuesta no cumple el contrato del Workspace. No se aplicó ningún cambio.']);
  const residual = analyzeAssetReferences({ workspace: snapshot, ref: input.assetRef, unverified: [], dependencies: input.analysis.dependencies });
  if (residual.status !== 'complete-unused' || residual.carriers.length > 0) return blocked(['La copia conserva referencias o contenido sin verificar. No se aplicó ningún cambio.']);
  // complete-unused is only an assertion about this copy, never global coverage or a purge permit.
  return { status: 'prepared-copy', plan, executionAllowed: false, snapshot: structuredClone(snapshot) };
}
